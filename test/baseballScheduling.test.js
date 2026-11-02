import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as baseball from "../functions/lib/baseballScheduling.js";
import * as softball from "../functions/lib/scheduling.js";
import { buildBaseballSampleReservations, buildBubbleSampleReservations, buildLegacyBaseballSampleReservations, ensureBaseballSampleData, buildBaseballSampleRequests, FIELD_REQUEST_SAMPLE_VERSION, BASEBALL_SAMPLE_VERSION, BUBBLE_SAMPLE_VERSION } from "../functions/lib/baseballSampleData.js";
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

test("compact labels remove repeated text while complete details remain in the data", () => {
  const event = {team:"Barrington 12U",title:"[SAMPLE] 12U Practice"};
  assert.equal(client.compactEventTitle(event),"12U Practice");
  assert.equal(event.title,"[SAMPLE] 12U Practice");
  assert.equal(client.compactEventTitle({team:"Barrington 8U",title:"[SAMPLE] 8U vs Audubon"}),"8U vs Audubon");
  assert.equal(client.compactEventTitle({team:"Barrington 10U",title:"Skills Clinic"}),"10U · Skills Clinic");
  assert.equal(client.compactTimeLabel("17:00"),"5 PM");
  assert.equal(client.compactTimeLabel("17:30"),"5:30 PM");
  assert.equal(client.FIELD_OPTIONS.length,3);
  assert.deepEqual(client.getSchedulingFields("bubble").map(item=>item.value),["bubble"]);
});

test("bubble bookings use the same approval flow but do not conflict with or enter the field calendar", async () => {
  const {sqlite,env}=database();
  await baseball.setSchedulingPassword(env,"admin","baseball-admin");
  const draft={requestType:"add",field:"bubble",team:"Barrington 10U",title:"Indoor practice",date:"2027-04-10",startTime:"17:00"};
  assert.equal(baseball.normalizeField("bubble"),"bubble");
  assert.equal(baseball.fieldLabel("bubble"),"Bubble");
  assert.equal(baseball.normalizeScheduleDraft(draft).value.endTime,"19:00");
  let response=await addReservation({env,request:request({...draft,field:"major"},"admin","baseball-admin")});
  assert.equal(response.status,200);
  response=await submitRequest({env,request:request(draft)});
  assert.equal(response.status,200);
  const pending=(await response.json()).request;
  assert.equal(pending.hasConflict,false);
  let state=await baseball.loadSchedulingState(env);
  assert.equal(client.scopeSchedulingData(state,"field").summary.approvedReservations,1);
  assert.equal(client.scopeSchedulingData(state,"field").summary.pendingAddRequests,0);
  assert.equal(client.scopeSchedulingData(state,"bubble").summary.approvedReservations,0);
  assert.equal(client.scopeSchedulingData(state,"bubble").summary.pendingAddRequests,1);
  response=await reviewRequest({env,request:request({requestId:pending.id,action:"approve"},"admin","baseball-admin")});
  assert.equal(response.status,200);
  response=await submitRequest({env,request:request({...draft,startTime:"18:00"})});
  const conflict=(await response.json()).request;
  assert.equal(conflict.hasConflict,true);
  assert.match(conflict.conflictDetails.join(" "),/Bubble/);
  state=await baseball.loadSchedulingState(env);
  const fieldState=client.scopeSchedulingData(state,"field");
  const bubbleState=client.scopeSchedulingData(state,"bubble");
  assert.equal(fieldState.reservations.length,1);
  assert.equal(bubbleState.reservations.length,1);
  assert.ok(fieldState.requests.every(item=>item.field!=="bubble"));
  assert.ok(bubbleState.requests.every(item=>item.field==="bubble"));
  assert.equal(fieldState.summary.conflicts,0);
  assert.ok(bubbleState.summary.conflicts>0);
  assert.equal(client.getConflictsForDraft({...draft,startTime:"18:00"},bubbleState.reservations).length,1);
  sqlite.close();
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
  assert.equal(planned.length,55);
  assert.equal(planned.filter(event=>event.reservationType==="game").length,29);
  assert.equal(planned.filter(event=>event.reservationType==="practice").length,26);
  assert.ok(planned.every(event=>event.date>="2026-11-02" && event.date<="2026-12-01"));
  assert.deepEqual([...new Set(planned.map(event=>event.field))].sort(),["major","minor","tee-ball"]);
  const bubble = buildBubbleSampleReservations();
  assert.equal(bubble.length,17);
  assert.equal(bubble[0].date,"2026-11-02");
  assert.equal(bubble.at(-1).date,"2026-11-30");
  assert.ok(bubble.every(item=>item.date <= "2026-12-01" && !client.bubbleBookingError(item.field,item.date)));
  assert.ok(bubble.every(item=>!item.title.includes("Scrimmage") && item.reservationType !== "game"));
  assert.ok(bubble.every(item=>item.field==="bubble" && Number(item.endTime.slice(0,2))-Number(item.startTime.slice(0,2))===2));
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_scheduling_teams").get().count,5);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_reservations WHERE created_by_role = 'sample_data'").get().count,71);
  assert.equal(sqlite.prepare("SELECT title FROM baseball_field_reservations WHERE id = 'real-reservation'").get().title,"Existing reservation");
  const entries = sqlite.prepare("SELECT * FROM baseball_field_reservations").all();
  for (const a of entries) for (const b of entries) {
    if (a.id===b.id || a.date!==b.date || a.field!==b.field) continue;
    assert.equal(a.start_time < b.end_time && a.end_time > b.start_time,false);
  }
  const removed = entries.find(event=>event.created_by_role==="sample_data");
  sqlite.prepare("DELETE FROM baseball_field_reservations WHERE id = ?").run(removed.id);
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_reservations WHERE created_by_role = 'sample_data'").get().count,70);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_requests WHERE requested_by NOT IN ('Admin','Sample requester')").get().count,0);
  assert.deepEqual(sqlite.prepare("SELECT * FROM scheduling_teams").all(),original);
  sqlite.close();
});

test("revising the original 65 samples produces 55 field events and 30 days of bubble examples without changing real data", async () => {
  const {sqlite,env}=database();
  env.BASEBALL_SAMPLE_DATA="on";
  await baseball.ensureSchedulingTables(env);
  const legacy=buildLegacyBaseballSampleReservations();
  assert.equal(legacy.length,65);
  for (const item of legacy) await baseball.createReservation(env,{...item,status:"approved",createdByRole:"sample_data"});
  await baseball.createReservation(env,{id:"actual-booking",field:"major",team:"Actual Team",title:"Actual reservation",date:"2027-04-01",startTime:"17:00",endTime:"19:00",reservationType:"game",status:"approved",createdByRole:"admin"});
  await baseball.createFieldRequest(env,{id:"actual-request",requestType:"add",field:"minor",team:"Actual Team",title:"Actual pending request",date:"2027-04-02",startTime:"17:00",endTime:"19:00",reservationType:"practice",status:"pending",requestedBy:"Real requester"});
  const realBooking=sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE id='actual-booking'").get();
  const realRequest=sqlite.prepare("SELECT * FROM baseball_field_requests WHERE id='actual-request'").get();
  sqlite.exec("CREATE TABLE baseball_sample_seed_versions (id TEXT PRIMARY KEY, completed_at TEXT NOT NULL)");
  sqlite.prepare("INSERT INTO baseball_sample_seed_versions VALUES (?,?)").run("bll-sample-20261102-30days-v1","2026-11-01T00:00:00Z");
  await ensureBaseballSampleData(env);
  const field=sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE created_by_role='sample_data' AND field<>'bubble'").all();
  const bubble=sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE created_by_role='sample_data' AND field='bubble'").all();
  assert.equal(field.length,55);
  assert.equal(field.filter(item=>item.reservation_type==="game").length,29);
  assert.equal(field.filter(item=>item.reservation_type==="practice").length,26);
  assert.equal(bubble.length,17);
  assert.deepEqual(sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE id='actual-booking'").get(),realBooking);
  assert.deepEqual(sqlite.prepare("SELECT * FROM baseball_field_requests WHERE id='actual-request'").get(),realRequest);
  const byId=new Map(buildBaseballSampleReservations().map(item=>[item.id,item]));
  assert.ok(field.every(item=>item.title===byId.get(item.id).title));
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM baseball_field_reservations WHERE created_by_role='sample_data'").get().count,72);
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


test("softball blocks the Bubble all day every Tuesday/Thursday indefinitely, with no field restriction", async () => {
  const {sqlite,env}=database();
  await baseball.setSchedulingPassword(env,"admin","baseball-admin");
  for (const date of ["2026-11-03","2026-11-05","2026-12-01","2027-04-08","2027-04-13"]) {
    const draft={requestType:"add",field:"bubble",date,startTime:"00:00",team:"Barrington 10U"};
    assert.match(baseball.normalizeScheduleDraft(draft).error,/softball/);
    assert.match(client.bubbleBookingError("bubble",date),/softball/);
    for (const startTime of ["00:00","10:00","17:00","22:00"]) {
      const response=await submitRequest({env,request:request({...draft,startTime})});
      assert.equal(response.status,400);
      assert.match((await response.json()).error,/softball/);
    }
    const response=await addReservation({env,request:request(draft,"admin","baseball-admin")});
    assert.equal(response.status,400);
    await assert.rejects(baseball.createReservation(env,{...draft,endTime:"02:00"}),/softball/);
    for (const field of ["major","minor","tee-ball"]) {
      assert.ok(baseball.normalizeScheduleDraft({...draft,field}).value);
      assert.equal(client.bubbleBookingError(field,date),"");
    }
  }
  for (const date of ["2026-11-02","2026-11-04","2026-11-06","2026-11-07","2026-11-08"]) {
    assert.ok(baseball.normalizeScheduleDraft({field:"bubble",date,startTime:"17:00",team:"10U"}).value);
  }
  const result=await baseball.importSchedulingCsv(env,"date,field,team,startTime\n2027-04-13,bubble,10U,17:00\n2027-04-15,bubble,12U,17:00\n2027-04-14,bubble,14U,17:00\n2027-04-13,major,10U,17:00");
  assert.equal(result.importedCount,2);
  assert.equal(result.errorCount,2);
  assert.ok(result.errors.every(error=>error.includes("softball")));
  // Simulate a pending request submitted before the standing restriction existed.
  sqlite.prepare(`INSERT INTO baseball_field_requests
    (id, request_type, field, team, title, reservation_type, date, start_time, end_time, status, requested_by, requested_at)
    VALUES ('old-request','add','bubble','10U','Practice','practice','2027-04-13','17:00','19:00','pending','Requester','2026-11-01')`).run();
  const response=await reviewRequest({env,request:request({requestId:"old-request",action:"approve"},"admin","baseball-admin")});
  assert.equal(response.status,400);
  assert.equal(sqlite.prepare("SELECT status FROM baseball_field_requests WHERE id='old-request'").get().status,"pending");
  assert.equal(sqlite.prepare("SELECT count(*) count FROM baseball_field_reservations WHERE field='bubble' AND date='2027-04-13'").get().count,0);
  sqlite.close();
});

test("Bubble closures render for any selected week without counting as baseball bookings", () => {
  const dates=client.getWeekDates("2027-04-13");
  const blocks=client.buildBubbleSoftballBlocks(dates);
  assert.deepEqual(blocks.map(item=>item.date),["2027-04-13","2027-04-15"]);
  assert.ok(blocks.every(item=>item.kind==="closure" && item.allDay && item.startTime==="00:00" && item.endTime==="24:00" && item.displayStatus==="maintenance"));
  assert.equal(client.scopeSchedulingData({reservations:[],requests:[]},"bubble").summary.approvedReservations,0);
});

test("Bubble-only revision fixes the old Thursday and scrimmage examples without restoring deleted field samples", async () => {
  const {sqlite,env}=database();
  env.BASEBALL_SAMPLE_DATA="on";
  await baseball.ensureSchedulingTables(env);
  await ensureBaseballSampleData(env);
  const deleted=buildBaseballSampleReservations()[0].id;
  sqlite.prepare("DELETE FROM baseball_field_reservations WHERE id=?").run(deleted);
  sqlite.prepare("DELETE FROM baseball_sample_seed_versions WHERE id=?").run(BUBBLE_SAMPLE_VERSION);
  sqlite.prepare("DELETE FROM baseball_field_reservations WHERE field='bubble'").run();
  const oldBubble=[
    {id:"bll_sample_20261102_bubble_2026-11-12_12u",date:"2026-11-12",team:"Barrington 12U",title:"[SAMPLE] 12U Hitting Session",reservationType:"practice",startTime:"19:00",endTime:"21:00"},
    {id:"bll_sample_20261102_bubble_2026-11-14_10u",date:"2026-11-14",team:"Barrington 10U",title:"[SAMPLE] 10U Indoor Scrimmage",reservationType:"game",startTime:"12:00",endTime:"14:00"},
  ];
  const insert=sqlite.prepare(`INSERT INTO baseball_field_reservations
    (id,field,team,title,reservation_type,date,start_time,end_time,status,notes,created_by_role,created_at,updated_at)
    VALUES (?,'bubble',?,?,?,?,?,?,'approved','','sample_data','2026-11-01','2026-11-01')`);
  for (const item of oldBubble) insert.run(item.id,item.team,item.title,item.reservationType,item.date,item.startTime,item.endTime);
  await baseball.createReservation(env,{id:"real-bubble",field:"bubble",team:"Actual Team",title:"Actual booking",date:"2027-04-14",startTime:"17:00",endTime:"19:00",reservationType:"practice",createdByRole:"admin"});
  const real=sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE id='real-bubble'").get();
  const fields=sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE field<>'bubble' ORDER BY id").all();
  assert.ok(sqlite.prepare("SELECT id FROM baseball_sample_seed_versions WHERE id=?").get(BASEBALL_SAMPLE_VERSION));
  await ensureBaseballSampleData(env);
  assert.deepEqual(sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE field<>'bubble' ORDER BY id").all(),fields);
  assert.deepEqual(sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE id='real-bubble'").get(),real);
  const bubbles=sqlite.prepare("SELECT * FROM baseball_field_reservations WHERE field='bubble' AND created_by_role='sample_data'").all();
  assert.equal(bubbles.length,17);
  assert.ok(bubbles.every(item=>!client.bubbleBookingError(item.field,item.date) && !item.title.includes("Scrimmage")));
  assert.equal(bubbles.find(item=>item.date==="2026-11-14").reservation_type,"practice");
  sqlite.prepare("DELETE FROM baseball_field_reservations WHERE id=?").run(bubbles[0].id);
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT count(*) count FROM baseball_field_reservations WHERE field='bubble' AND created_by_role='sample_data'").get().count,16);
  sqlite.close();
});


test("field samples have two pending requests and one actual overlap in each of the five calendar weeks", async () => {
  const {sqlite,env}=database();
  env.BASEBALL_SAMPLE_DATA="on";
  await baseball.ensureSchedulingTables(env);
  await softball.ensureSchedulingTables(env);
  await softball.createSchedulingTeam(env,"Untouched BGSL");
  const snapshot=sqlite.prepare("SELECT * FROM scheduling_teams").all();
  const state=await baseball.loadSchedulingState(env);
  const samples=state.requests.filter(item=>item.id.startsWith("bll_sample_request_"));
  assert.equal(samples.length,10);
  assert.equal(state.reservations.filter(item=>item.field!=="bubble").length,55);
  assert.equal(state.reservations.filter(item=>item.field==="bubble").length,17);
  for (const week of ["2026-11-01","2026-11-08","2026-11-15","2026-11-22","2026-11-29"]) {
    const requests=samples.filter(item=>client.getWeekStart(item.date)===week);
    assert.equal(requests.length,2);
    assert.ok(requests.every(item=>item.status==="pending" && item.field!=="bubble" && item.title.startsWith("[SAMPLE]") && item.endTime===client.deriveReservationEndTime(item.startTime)));
    assert.equal(requests.filter(item=>item.displayStatus==="pending").length,1);
    const conflicting=requests.filter(item=>item.displayStatus==="conflict");
    assert.equal(conflicting.length,1);
    assert.ok(conflicting[0].conflictDetails.some(detail=>detail.includes("reservation")));
    assert.equal(state.reservations.filter(item=>client.getWeekStart(item.date)===week && item.hasConflict).length,1);
  }
  // An admin decision or deletion is not undone by later page loads.
  const denied=samples[0].id, removed=samples[1].id;
  sqlite.prepare("UPDATE baseball_field_requests SET status='denied', reviewed_by='Admin' WHERE id=?").run(denied);
  sqlite.prepare("DELETE FROM baseball_field_requests WHERE id=?").run(removed);
  await ensureBaseballSampleData(env);
  assert.equal(sqlite.prepare("SELECT status FROM baseball_field_requests WHERE id=?").get(denied).status,"denied");
  assert.equal(sqlite.prepare("SELECT id FROM baseball_field_requests WHERE id=?").get(removed),undefined);
  assert.deepEqual(sqlite.prepare("SELECT * FROM scheduling_teams").all(),snapshot);
  sqlite.close();
});

test("adding sample requests preserves existing data and does not restore deleted reservations", async () => {
  const {sqlite,env}=database();
  env.BASEBALL_SAMPLE_DATA="on";
  await baseball.ensureSchedulingTables(env);
  await ensureBaseballSampleData(env);
  sqlite.prepare("DELETE FROM baseball_field_requests WHERE id LIKE 'bll_sample_request_%'").run();
  sqlite.prepare("DELETE FROM baseball_sample_seed_versions WHERE id=?").run(FIELD_REQUEST_SAMPLE_VERSION);
  const first=buildBaseballSampleReservations()[0].id;
  sqlite.prepare("DELETE FROM baseball_field_reservations WHERE id=?").run(first);
  await baseball.createFieldRequest(env,{id:"real-request",requestType:"add",field:"minor",team:"Real Team",title:"Actual request",reservationType:"practice",date:"2026-11-02",startTime:"08:00",endTime:"10:00",requestedBy:"Actual requester"});
  const real=sqlite.prepare("SELECT * FROM baseball_field_requests WHERE id='real-request'").get();
  const reservations=sqlite.prepare("SELECT * FROM baseball_field_reservations ORDER BY id").all();
  const state=await baseball.loadSchedulingState(env);
  assert.deepEqual(sqlite.prepare("SELECT * FROM baseball_field_requests WHERE id='real-request'").get(),real);
  assert.deepEqual(sqlite.prepare("SELECT * FROM baseball_field_reservations ORDER BY id").all(),reservations);
  const examples=state.requests.filter(item=>item.id.startsWith("bll_sample_request_"));
  assert.equal(examples.length,10);
  assert.equal(examples.filter(item=>item.displayStatus==="conflict").length,5);
  assert.equal(examples.find(item=>item.id==="bll_sample_request_2026-11-01_pending").startTime,"10:00");
  assert.equal(buildBaseballSampleRequests().length,10);
  sqlite.close();
});
