import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createFinanceSession, getFinanceSession } from "../functions/lib/financeAuth.js";
import { createFinanceBoardMember, getFinanceAdmin, removeFinanceBoardMember, updateFinanceBoardMember } from "../functions/lib/financeData.js";

function d1(database) {
  return {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...nextValues) { values = nextValues; return statement; },
        all() { return { results: database.prepare(sql).all(...values) }; },
        first() { return database.prepare(sql).get(...values) || null; },
        run() { return database.prepare(sql).run(...values); },
      };
      return statement;
    },
  };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie").split(";")[0];
}

test("named Board PINs create attributable sessions and remain viewable only through the admin response", async () => {
  const [financeSql, boardMemberSql, viewablePinSql] = await Promise.all([
    readFile(new URL("../migrations/0008_finance.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0011_finance_board_members.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0012_finance_viewable_pins.sql", import.meta.url), "utf8"),
  ]);
  const database = new DatabaseSync(":memory:");
  database.exec(financeSql);
  database.exec(boardMemberSql);
  database.exec(viewablePinSql);
  const env = { DB: d1(database), FINANCE_PIN_ENCRYPTION_KEY: "test-only-pin-encryption-key" };
  const editor = { actor: "Test finance editor", role: "editor" };

  const member = await createFinanceBoardMember(env, editor, { name: "Alex Board", pin: "274913" });
  const stored = database.prepare("SELECT pin_hash, pin_ciphertext FROM finance_board_members WHERE id = ?").get(member.id);
  assert.notEqual(stored.pin_hash, "274913");
  assert.match(stored.pin_hash, /^pbkdf2\$sha256\$/);
  assert.notEqual(stored.pin_ciphertext, "274913");
  assert.match(stored.pin_ciphertext, /^aesgcm\$v1\$/);
  const admin = await getFinanceAdmin(env, "fy_2025_2026");
  assert.deepEqual(admin.boardMembers.map(({ name, pin, isActive, pinConfigured }) => ({ name, pin, isActive, pinConfigured })), [
    { name: "Alex Board", pin: "274913", isActive: true, pinConfigured: true },
  ]);
  assert.equal("pinHash" in admin.boardMembers[0], false);

  const loginRequest = new Request("https://bgslwalkup.com/api/board/finance/session/login", {
    method: "POST",
    headers: { origin: "https://bgslwalkup.com", "CF-Connecting-IP": "192.0.2.8" },
  });
  const login = await createFinanceSession(loginRequest, env, { role: "viewer", pin: "274913" });
  assert.equal(login.status, 200);
  assert.equal((await login.clone().json()).session.actor, "Alex Board");
  const activeSession = await getFinanceSession(new Request("https://bgslwalkup.com/api/board/finance/session", { headers: { cookie: cookieFrom(login) } }), env);
  assert.equal(activeSession.actor, "Alex Board");
  assert.equal(activeSession.boardMemberId, member.id);

  await updateFinanceBoardMember(env, editor, member.id, { pin: "830641" });
  assert.equal((await getFinanceAdmin(env, "fy_2025_2026")).boardMembers[0].pin, "830641");
  assert.equal((await getFinanceSession(new Request("https://bgslwalkup.com/api/board/finance/session", { headers: { cookie: cookieFrom(login) } }), env)).ok, false);
  const relogin = await createFinanceSession(loginRequest, env, { role: "viewer", pin: "830641" });
  assert.equal(relogin.status, 200);

  await removeFinanceBoardMember(env, editor, member.id);
  assert.equal((await getFinanceSession(new Request("https://bgslwalkup.com/api/board/finance/session", { headers: { cookie: cookieFrom(relogin) } }), env)).ok, false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM finance_audit_events WHERE actor = 'Alex Board' AND action = 'session_created'").get().count, 2);

  const failedRequest = new Request("https://bgslwalkup.com/api/board/finance/session/login", {
    method: "POST",
    headers: { origin: "https://bgslwalkup.com", "CF-Connecting-IP": "192.0.2.9" },
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await createFinanceSession(failedRequest, env, { role: "viewer", pin: "000000" })).status, 401);
  }
  assert.equal((await createFinanceSession(failedRequest, env, { role: "viewer", pin: "000000" })).status, 429);
  database.close();
});
