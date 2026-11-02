import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as baseball from "../functions/lib/baseballScheduling.js";
import * as softball from "../functions/lib/scheduling.js";
import { buildBaseballSampleReservations, ensureBaseballSampleData } from "../functions/lib/baseballSampleData.js";
import * as client from "../src/baseball/scheduling/utils.js";
import { onRequestPost as submitRequest } from "../functions/api/baseball/scheduling/request.js";
import { onRequestPost as reviewRequest } from "../functions/api/baseball/scheduling/review.js";
import { onRequestPost as addReservation } from "../functions/api/baseball/scheduling/reservation.js";
import { onRequestGet as getState } from "../functions/api/baseball/scheduling/state.js";
import { onRequestPost as createTeam } from "../functions/api/baseball/admin/scheduling-teams.js";
import { onRequestGet as adminSettings } from "../functions/api/baseball/admin/scheduling-settings.js";
import { onRequestDelete as cancelRequest } from "../functions/api/baseball/scheduling/request.js";
import { onRequestPost as setPassword } from "../functions/api/baseball/admin/scheduling-settings.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  const statements = [];
  const DB = { prepare(sql) {
    statements.push(sql);
    function statement(values = []) {
      return {
        bind: (...args) => statement(args),
        run: async () => { sqlite.prepare(sql).run(...values); return {success:true}; },
        first: async () => sqlite.prepare(sql).get(...values) || null,
        all: async () => ({results: sqlite.prepare(sql).all(...values)}),
      };
    }
    return statement();
  }, async batch(items) {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const item of items) results.push(await item.run());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  return {sqlite, statements, env:{DB, ADMIN_KEY:"local-test-admin", BASEBALL_SAMPLE_DATA:"off"}};
}

function request(body, role = "requester", key = "", method = "POST", owner = "local-request-owner-00000001") {
  return new Request("https://example.test/api/baseball/scheduling", {
    method,
    headers:{...(key ? {Authorization:`Bearer ${key}`} : {}), "x-scheduling-role":role, "x-baseball-requester":owner, "Content-Type":"application/json"},
    ...(method !== "GET" ? {body:JSON.stringify(body)} : {}),
  });
}

test("three baseball fields have two-hour slots in server and client, including midnight boundary", () => {
  assert.equal(baseball.RESERVATION_DURATION_MINUTES, 120);
  assert.equal(client.RESERVATION_DURATION_MINUTES, 120);
  assert.equal(softball.RESERVATION_DURATION_MINUTES, 90);
  assert.deepEqual(client.FIELD_OPTIONS.map((field) => field.value), ["major","minor","tee-ball"]);
  for (const field of client.FIELD_OPTIONS) {
    const draft = baseball.normalizeScheduleDraft({field:field.value,date:"2027-04-10",startTime:"17:00",team:"Blue"});
    assert.equal(draft.value.endTime,"19:00");
    assert.equal(baseball.fieldLabel(field.value),field.label);
    assert.equal(client.deriveReservationEndTime("17:00"),"19:00");
  }
  assert.equal(baseball.normalizeField("unknown"),"");
  assert.equal(baseball.deriveReservationEndTime("22:00"),"24:00");
  assert.equal(client.deriveReservationEndTime("22:00"),"24:00");
  assert.match(baseball.normalizeScheduleDraft({field:"tee-ball",date:"2027-04-10",startTime:"22:01",team:"Blue"}).error,/2-hour/);
  const event = {field:"tee-ball",date:"2027-04-10",startTime:"17:00",endTime:"19:00",team:"Blue"};
  assert.equal(baseball.scheduleEntriesOverlap(event,{...event,startTime:"18:45"}),true);
  assert.equal(baseball.scheduleEntriesOverlap(event,{...event,startTime:"19:00"}),false);
  assert.equal(baseball.scheduleEntriesOverlap(event,{...event,field:"minor"}),false);
  assert.match(client.getConflictsForDraft({...event,startTime:"18:45"},[event])[0],/Tee Ball Field/);
});

test("sample data fills the next 30 days once, respects existing reservations, and preserves sample deletions", async () => {
  const {sqlite,env} = database();
  env.BASEBALL_SAMPLE_DATA = "on";
  await softball.ensureSchedulingTables(env);
  await softball.createSchedulingTeam(env,"BGSL unchanged");
  const original = sqlite.prepare("SELECT * FROM scheduling_teams").all();
  await baseball.ensureSchedulingTables(env);
  await baseball.createReservation(env,{id:"real-reservation",field:"major",team:"Actual Team",title:"Existing reservation",date:"2026-11-02",startTime:"17:00",endTime:"19:00",reservationType:"practice",status:"approved",createdByRole:"admin"});
  const planned = buildBaseballSampleReservations();
  assert.equal(planned.length,65);
  assert.equal(planned.filter(event=>event.reservationType==="game").length,20);
  assert.equal(planned.filter(event=>event.reservationType==="practice").length,45);
  assert.ok(planned.every(event=>event.date>="2026-11-02" && event.date<="2026-12-01"));
  assert.deepEqual([...new Set(planned.map(event=>event.field))].sort(),["major","minor","tee-ball"]);
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_scheduling_teams").get().count,5);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_reservations WHERE created_by_role = 'sample_data'").get().count,64);
  assert.equal(sqlite.prepare("SELECT title FROM baseball_field_reservations WHERE id = 'real-reservation'").get().title,"Existing reservation");
  const entries = sqlite.prepare("SELECT * FROM baseball_field_reservations").all();
  for (const a of entries) for (const b of entries) {
    if (a.id===b.id || a.date!==b.date || a.field!==b.field) continue;
    assert.equal(a.start_time < b.end_time && a.end_time > b.start_time,false);
  }
  const removed = entries.find(event=>event.created_by_role==="sample_data");
  sqlite.prepare("DELETE FROM baseball_field_reservations WHERE id = ?").run(removed.id);
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_reservations WHERE created_by_role = 'sample_data'").get().count,63);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_requests WHERE requested_by <> 'Admin'").get().count,0);
  assert.deepEqual(sqlite.prepare("SELECT * FROM scheduling_teams").all(),original);
  sqlite.close();
});

test("baseball setup, requests, approvals, imports and passwords leave every BGSL table unchanged", async () => {
  const {sqlite,statements,env} = database();
  await softball.ensureSchedulingTables(env);
  await softball.setSchedulingPassword(env,"coach","softball-only");
  await softball.createSchedulingTeam(env,"BGSL Gold");
  await softball.createReservation(env,{field:"major",team:"BGSL Gold",title:"Softball practice",date:"2027-04-10",startTime:"17:00",endTime:"18:30",reservationType:"practice",status:"approved",createdByRole:"board"});
  const tables=["scheduling_settings","scheduling_teams","field_requests","field_reservations"];
  const snapshot = () => tables.map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  const before=snapshot();
  statements.length=0;

  let response=await setPassword({env,request:request({role:"coach",password:"baseball-coach"},"", "wrong-admin")});
  assert.equal(response.status,401);
  for (const [role,password] of [["admin","baseball-admin"]]) {
    response=await setPassword({env,request:request({role,password},"",env.ADMIN_KEY)});
    assert.equal(response.status,200);
  }
  response = await createTeam({env,request:request({name:"Little League Blue"},"admin","baseball-admin")});
  assert.equal(response.status,200);
  response = await adminSettings({env,request:request(null,"admin","baseball-admin","GET")});
  assert.equal(response.status,200);
  assert.equal((await response.json()).settings.adminPasswordConfigured,true);
  response=await getState({env,request:request(null,"requester","softball-only","GET")});
  assert.equal(response.status,401);
  response=await getState({env,request:request(null,"requester","","GET")});
  let state=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(state.teams.map((team)=>team.name),["Little League Blue"]);
  assert.equal(state.reservations.length,0);

  const draft={requestType:"add",field:"tee-ball",team:"Little League Blue",title:"Tee Ball practice",date:"2027-04-10",startTime:"17:00"};
  response=await submitRequest({env,request:request(draft)});
  assert.equal(response.status,200);
  const pending=(await response.json()).request;
  response=await getState({env,request:request(null,"requester","","GET")});
  let ownState=await response.json();
  assert.equal(ownState.requests.find(item => item.id === pending.id).canCancel,true);
  response=await getState({env,request:request(null,"requester","","GET","other-request-owner-000002")});
  ownState=await response.json();
  assert.equal(ownState.requests.find(item => item.id === pending.id).canCancel,false);
  assert.equal(JSON.stringify(ownState).includes("requester_key_hash"),false);
  response=await cancelRequest({env,request:request({requestId:pending.id},"requester","","DELETE","other-request-owner-000002")});
  assert.equal(response.status,403);
  assert.equal(pending.endTime,"19:00");
  response=await reviewRequest({env,request:request({requestId:pending.id,action:"approve"})});
  assert.equal(response.status,401);
  response=await reviewRequest({env,request:request({requestId:pending.id,action:"approve"},"admin","baseball-admin")});
  assert.equal(response.status,200);
  assert.equal((await response.json()).request.status,"approved");

  response=await submitRequest({env,request:request({...draft,startTime:"18:45"})});
  const conflicting=(await response.json()).request;
  assert.equal(conflicting.hasConflict,true);
  assert.match(conflicting.conflictDetails.join(" "),/Tee Ball Field/);
  response=await reviewRequest({env,request:request({requestId:conflicting.id,action:"deny"},"admin","baseball-admin")});
  assert.equal((await response.json()).request.status,"denied");
  response=await addReservation({env,request:request({...draft,field:"major"},"admin","baseball-admin")});
  assert.equal(response.status,200);
  const result=await baseball.importSchedulingCsv(env,"date,field,team,startTime\n2027-04-12,minor,Little League Blue,17:00\n2027-04-12,tee-ball,Little League Blue,17:00");
  assert.equal(result.importedCount,2);
  state=await baseball.loadSchedulingState(env);
  assert.equal(state.reservations.length,4);
  response=await submitRequest({env,request:request({...draft,date:"2027-04-14"})});
  const cancelable=(await response.json()).request;
  response=await cancelRequest({env,request:request({requestId:cancelable.id},"requester","","DELETE")});
  assert.equal(response.status,200);
  assert.equal((await response.json()).request.status,"canceled");
  assert.ok(state.reservations.every((entry)=>entry.endTime==="19:00"));
  assert.equal((await baseball.getSchedulingNotificationSettings(env)).email,"");
  assert.deepEqual(snapshot(),before,"BGSL data, passwords, teams and history must not change");
  assert.ok(statements.every((sql)=>!/(?<!baseball_)\b(scheduling_settings|scheduling_teams|field_reservations|field_requests)\b/.test(sql)),"baseball SQL must reference only its own tables");
  sqlite.close();
});
