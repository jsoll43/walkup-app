import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildFinanceAiFacts,
  buildFinanceAiQuestionFacts,
  calculateFinanceAiNeuronsMilli,
  createFinanceAiInsight,
  FINANCE_AI_DAILY_NEURON_LIMIT_MILLI,
  getFinanceAiUsage,
  normalizeFinanceAiContent,
} from "../functions/lib/financeAi.js";

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
    batch(statements) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function dashboard(overrides = {}) {
  return {
    fiscalYear: { id: "fy_2025_2026", label: "October 2025 – September 2026", startsOn: "2025-10-01", endsOn: "2026-09-30" },
    overview: {
      ytdIncomeCents: 3257319,
      ytdExpensesCents: 2598245,
      ytdSurplusCents: 659074,
      bankBalancesCents: 1413172,
      availableCashCents: 1213172,
    },
    monthly: [
      { month: "2026-05", hasActual: true, incomeCents: 113426, expensesCents: 461690, netCents: -348264 },
      { month: "2026-06", hasActual: true, incomeCents: 105844, expensesCents: 293186, netCents: -187342 },
    ],
    spending: {
      routineCents: 1100745,
      oneTimeCents: 1497500,
      byCategory: [{ name: "Field maintenance", amountCents: 1600000 }],
    },
    income: { byCategory: [{ name: "Registration", amountCents: 2500000 }] },
    yearOverYear: {
      current: { transactionCount: 40, externalIncomeCents: 3257319, expensesCents: 2598245, surplusCents: 659074 },
      prior: { transactionCount: 38, externalIncomeCents: 3000000, expensesCents: 2100000, surplusCents: 900000 },
      incomeChangeCents: 257319,
      expenseChangeCents: 498245,
      surplusChangeCents: -240926,
      categoryChanges: [{ name: "Field maintenance", currentCents: 1600000, priorCents: 1200000, changeCents: 400000 }],
    },
    ai: {
      availableMonths: ["2026-05", "2026-06"],
      availableStartDate: "2025-10-01",
      availableEndDate: "2026-06-30",
      selectedRange: {
        startDate: "2026-05-15",
        endDate: "2026-06-30",
        priorStartDate: "2025-05-15",
        priorEndDate: "2025-06-30",
        current: { transactionCount: 8, externalIncomeCents: 219270, expensesCents: 754876, surplusCents: -535606 },
        prior: { transactionCount: 7, externalIncomeCents: 200000, expensesCents: 600000, surplusCents: -400000 },
        comparisonAvailable: true,
        incomeChangeCents: 19270,
        expenseChangeCents: 154876,
        surplusChangeCents: -135606,
        categoryChanges: [{ name: "Field maintenance", currentCents: 500000, priorCents: 400000, changeCents: 100000 }],
        topExpenseCategories: [{ name: "Field maintenance", amountCents: 500000 }],
        topIncomeCategories: [{ name: "Registration", amountCents: 219270 }],
        routineExpensesCents: 554876,
        oneTimeExpensesCents: 200000,
      },
    },
    reconciliations: [{ accountNumber: "PROMPT_SECRET_ACCOUNT" }],
    dataIssues: [{ description: "PROMPT_SECRET_TRANSACTION_DESCRIPTION" }],
    ...overrides,
  };
}

async function aiDatabase() {
  const sql = await readFile(new URL("../migrations/0010_finance_ai.sql", import.meta.url), "utf8");
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE finance_fiscal_years (id TEXT PRIMARY KEY)");
  database.exec("INSERT INTO finance_fiscal_years (id) VALUES ('fy_2025_2026')");
  database.exec(sql);
  return database;
}

test("AI facts contain calculated aggregates but exclude balances, accounts, and transaction details", () => {
  const facts = buildFinanceAiFacts(dashboard(), "treasurer_report");
  const serialized = JSON.stringify(facts);

  assert.match(serialized, /\$2,192\.70/);
  assert.match(serialized, /Field maintenance/);
  assert.doesNotMatch(serialized, /PROMPT_SECRET/);
  assert.doesNotMatch(serialized, /bankBalances|availableCash|reconciliation|accountNumber/i);

  const range = buildFinanceAiFacts(dashboard(), "explain_month");
  assert.deepEqual(range.selectedDateRange, { startDate: "2026-05-15", endDate: "2026-06-30" });
  assert.equal(range.selectedPeriodTotals.net, "-$5,356.06");
  assert.equal(range.appCalculatedChanges.expenses, "$1,548.76");

  const questionFacts = JSON.stringify(buildFinanceAiQuestionFacts(dashboard()));
  assert.match(questionFacts, /Registration/);
  assert.match(questionFacts, /largestAppCalculatedExpenseChanges/);
  assert.doesNotMatch(questionFacts, /PROMPT_SECRET|bankBalances|availableCash|accountNumber/i);
});

test("AI responses are normalized into concise bullet lines", () => {
  assert.equal(
    normalizeFinanceAiContent("Here are the changes: * Equipment: $4,300.16 * Insurance: $259.00"),
    "• Here are the changes:\n• Equipment: $4,300.16\n• Insurance: $259.00",
  );
  assert.equal(normalizeFinanceAiContent("Income exceeded expenses."), "• Income exceeded expenses.");
});

test("identical AI reports are cached and do not consume a second inference", async () => {
  const database = await aiDatabase();
  let calls = 0;
  let prompt = "";
  const env = {
    DB: d1(database),
    AI: {
      async run(model, input) {
        calls += 1;
        assert.equal(model, "@cf/meta/llama-3.2-3b-instruct");
        prompt = input.messages.map((message) => message.content).join("\n");
        return { response: "Income exceeded expenses for the reporting period.", usage: { prompt_tokens: 250, completion_tokens: 20, total_tokens: 270 } };
      },
    },
  };
  const input = { dashboard: dashboard(), fiscalYearId: "fy_2025_2026", reportType: "treasurer_report" };

  const first = await createFinanceAiInsight(env, input);
  const second = await createFinanceAiInsight(env, input);

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  assert.doesNotMatch(prompt, /PROMPT_SECRET/);
  assert.doesNotMatch(prompt, /bankBalances|availableCash|accountNumber/i);
  assert.equal(database.prepare("SELECT inference_count FROM finance_ai_daily_usage").get().inference_count, 1);
  assert.equal(database.prepare("SELECT estimated_neurons_milli FROM finance_ai_daily_usage").get().estimated_neurons_milli, 1766);
  assert.equal(first.usage.neuronsUsedMilli, 1766);
  assert.equal(second.usage.neuronsUsedMilli, 1766);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM finance_ai_insights").get().count, 1);
  database.close();
});

test("a Board member question is included without exposing transaction-level data", async () => {
  const database = await aiDatabase();
  let prompt = "";
  const env = {
    DB: d1(database),
    AI: {
      async run(model, input) {
        assert.equal(model, "@cf/meta/llama-3.2-3b-instruct");
        prompt = input.messages.map((message) => message.content).join("\n");
        return { response: "* Field maintenance was the largest expense. * Expenses increased.", usage: { prompt_tokens: 250, completion_tokens: 20 } };
      },
    },
  };

  const insight = await createFinanceAiInsight(env, {
    dashboard: dashboard(),
    fiscalYearId: "fy_2025_2026",
    reportType: "explain_month",
    question: "Where did we spend the most?",
  });

  assert.match(prompt, /Where did we spend the most\?/);
  assert.match(prompt, /Field maintenance/);
  assert.doesNotMatch(prompt, /PROMPT_SECRET|bankBalances|availableCash|accountNumber/i);
  assert.equal(insight.content, "• Field maintenance was the largest expense.\n• Expenses increased.");
  database.close();
});

test("converts model token usage to thousandths of a neuron", () => {
  assert.equal(calculateFinanceAiNeuronsMilli(250, 20), 1766);
});

test("reports daily neuron usage and blocks requests that could exceed the free allocation", async () => {
  const database = await aiDatabase();
  const today = new Date().toISOString().slice(0, 10);
  database.prepare(
    "INSERT INTO finance_ai_daily_usage (usage_date, inference_count, input_tokens, output_tokens, estimated_neurons_milli, updated_at) VALUES (?, 1, 0, 0, ?, ?)",
  ).run(today, FINANCE_AI_DAILY_NEURON_LIMIT_MILLI - 1, new Date().toISOString());
  let calls = 0;
  const env = { DB: d1(database), AI: { async run() { calls += 1; return { response: "should not run" }; } } };

  const usage = await getFinanceAiUsage(env);
  assert.equal(usage.neuronsUsedMilli, FINANCE_AI_DAILY_NEURON_LIMIT_MILLI - 1);
  assert.equal(usage.remainingNeuronsMilli, 1);

  await assert.rejects(
    createFinanceAiInsight(env, { dashboard: dashboard(), fiscalYearId: "fy_2025_2026", reportType: "explain_month" }),
    (error) => error.status === 429 && /daily allowance/i.test(error.message),
  );
  assert.equal(calls, 0);
  database.close();
});
