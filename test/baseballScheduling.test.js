import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as baseball from "../functions/lib/baseballScheduling.js";
import * as softball from "../functions/lib/scheduling.js";
import * as client from "../src/baseball/scheduling/utils.js";
import { onRequestPost as submitRequest } from "../functions/api/baseball/scheduling/request.js";
import { onRequestPost as reviewRequest } from "../functions/api/baseball/scheduling/review.js";
import { onRequestPost as addReservation } from "../functions/api/baseball/scheduling/reservation.js";
import { onRequestGet as getState } from "../functions/api/baseball/scheduling/state.js";
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
  } };
  return {sqlite, statements, env:{DB, ADMIN_KEY:"local-test-admin"}};
}

function request(body, role = "coach", key = "baseball-coach", method = "POST") {
  return new Request("https://example.test/api/baseball/scheduling", {
    method,
    headers:{Authorization:`Bearer ${key}`, "x-scheduling-role":role, "Content-Type":"application/json"},
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
  for (const [role,password] of [["coach","baseball-coach"],["board","baseball-board"]]) {
    response=await setPassword({env,request:request({role,password},"",env.ADMIN_KEY)});
    assert.equal(response.status,200);
  }
  await baseball.createSchedulingTeam(env,"Little League Blue");
  response=await getState({env,request:request(null,"coach","softball-only","GET")});
  assert.equal(response.status,401);
  response=await getState({env,request:request(null,"coach","baseball-coach","GET")});
  let state=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(state.teams.map((team)=>team.name),["Little League Blue"]);
  assert.equal(state.reservations.length,0);

  const draft={requestType:"add",field:"tee-ball",team:"Little League Blue",title:"Tee Ball practice",date:"2027-04-10",startTime:"17:00"};
  response=await submitRequest({env,request:request(draft)});
  assert.equal(response.status,200);
  const pending=(await response.json()).request;
  assert.equal(pending.endTime,"19:00");
  response=await reviewRequest({env,request:request({requestId:pending.id,action:"approve"})});
  assert.equal(response.status,403);
  response=await reviewRequest({env,request:request({requestId:pending.id,action:"approve"},"board","baseball-board")});
  assert.equal(response.status,200);
  assert.equal((await response.json()).request.status,"approved");

  response=await submitRequest({env,request:request({...draft,startTime:"18:45"})});
  const conflicting=(await response.json()).request;
  assert.equal(conflicting.hasConflict,true);
  assert.match(conflicting.conflictDetails.join(" "),/Tee Ball Field/);
  response=await reviewRequest({env,request:request({requestId:conflicting.id,action:"deny"},"board","baseball-board")});
  assert.equal((await response.json()).request.status,"denied");
  response=await addReservation({env,request:request({...draft,field:"major"},"board","baseball-board")});
  assert.equal(response.status,200);
  const result=await baseball.importSchedulingCsv(env,"date,field,team,startTime\n2027-04-12,minor,Little League Blue,17:00\n2027-04-12,tee-ball,Little League Blue,17:00");
  assert.equal(result.importedCount,2);
  state=await baseball.loadSchedulingState(env);
  assert.equal(state.reservations.length,4);
  assert.ok(state.reservations.every((entry)=>entry.endTime==="19:00"));
  assert.equal((await baseball.getSchedulingNotificationSettings(env)).email,"");
  assert.deepEqual(snapshot(),before,"BGSL data, passwords, teams and history must not change");
  assert.ok(statements.every((sql)=>!/(?<!baseball_)\b(scheduling_settings|scheduling_teams|field_reservations|field_requests)\b/.test(sql)),"baseball SQL must reference only its own tables");
  sqlite.close();
});
