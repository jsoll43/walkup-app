import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  confirmFinanceImport,
  getFinanceDashboard,
  getFinanceTransactions,
  previewFinanceImport,
  saveFinanceReconciliation,
  setFinancePeriodPublication,
} from "../functions/lib/financeData.js";

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

test("historical import needs neither account selection nor statement balances", async () => {
  const [financeSql, backfillSql] = await Promise.all([
    readFile(new URL("../migrations/0008_finance.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0009_finance_backfill.sql", import.meta.url), "utf8"),
  ]);
  const database = new DatabaseSync(":memory:");
  database.exec(financeSql);
  database.exec(backfillSql);
  const env = { DB: d1(database) };
  const session = { actor: "test editor", role: "editor" };
  const row = {
    sourceRow: 5,
    transactionDate: "2025-10-03",
    postedDate: "",
    amountCents: 12500,
    classification: "income",
    description: "Registration deposit",
    sourceCategory: "Income- Other",
    reconciliationStatus: "cleared",
    duplicateDecision: "",
    errors: [],
  };

  const preview = await previewFinanceImport(env, session, {
    fiscalYearId: "fy_2025_2026",
    statementMonth: "2025-10",
    sourceFilename: "October 2025- BGSL.xlsx",
    sourceSha256: "abc123",
    openingBalanceCents: null,
    statementEndingBalanceCents: null,
    rows: [row],
  });

  assert.equal(preview.accountName, "Consolidated historical source");
  assert.equal(preview.balancesPending, true);
  assert.equal(preview.reconciliation, null);

  const result = await confirmFinanceImport(env, session, preview.batchId, { confirm: true, rows: preview.rows });
  assert.equal(result.balancesPending, true);
  assert.equal(database.prepare("SELECT account_id FROM finance_transactions").get().account_id, "finance_account_historical");
  const pending = database.prepare("SELECT statement_month, account_id FROM finance_pending_statement_balances").get();
  assert.equal(pending.statement_month, "2025-10");
  assert.equal(pending.account_id, "finance_account_historical");
  const reconciliation = database.prepare("SELECT status, deposits_cents, opening_balance_cents, statement_ending_balance_cents FROM finance_reconciliations").get();
  assert.equal(reconciliation.status, "unreconciled");
  assert.equal(reconciliation.deposits_cents, 12500);
  assert.equal(reconciliation.opening_balance_cents, 0);
  assert.equal(reconciliation.statement_ending_balance_cents, 0);

  const viewer = { actor: "test board viewer", role: "viewer" };
  const draftDashboard = await getFinanceDashboard(env, viewer, "fy_2025_2026");
  const october = draftDashboard.monthly.find((month) => month.month === "2025-10");
  assert.equal(october.incomeCents, 12500);
  assert.equal(october.isPreliminary, true);
  const preliminaryTransactions = await getFinanceTransactions(env, viewer, "fy_2025_2026", {});
  assert.equal(preliminaryTransactions.length, 1);
  assert.equal(preliminaryTransactions[0].periodStatus, "draft");

  const partialRange = await getFinanceDashboard(env, viewer, "fy_2025_2026", {
    aiDateRange: { startDate: "2025-10-02", endDate: "2025-10-03" },
  });
  assert.deepEqual(
    { startDate: partialRange.ai.selectedRange.startDate, endDate: partialRange.ai.selectedRange.endDate },
    { startDate: "2025-10-02", endDate: "2025-10-03" },
  );
  assert.equal(partialRange.ai.selectedRange.current.externalIncomeCents, 12500);
  const emptyPartialRange = await getFinanceDashboard(env, viewer, "fy_2025_2026", {
    aiDateRange: { startDate: "2025-10-04", endDate: "2025-10-15" },
  });
  assert.equal(emptyPartialRange.ai.selectedRange.current.externalIncomeCents, 0);
  await assert.rejects(
    getFinanceDashboard(env, viewer, "fy_2025_2026", { aiDateRange: { startDate: "2025-09-30", endDate: "2025-10-03" } }),
    /within the reporting period/i,
  );

  await assert.rejects(
    setFinancePeriodPublication(env, session, "2025-10", true),
    /must be reconciled/i,
  );
  const saved = await saveFinanceReconciliation(env, session, "2025-10", {
    accountId: "finance_account_historical",
    openingBalanceCents: 0,
    statementEndingBalanceCents: 12500,
    outstandingItemsCents: 0,
    status: "reconciled",
  });
  assert.equal(saved.balancesKnown, true);
  assert.equal(saved.differenceCents, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM finance_pending_statement_balances").get().count, 0);
  const reconciledDraftDashboard = await getFinanceDashboard(env, viewer, "fy_2025_2026");
  assert.equal(reconciledDraftDashboard.overview.bankBalancesCents, 12500);
  assert.equal(reconciledDraftDashboard.overview.availableCashCents, 12500);
  assert.equal(reconciledDraftDashboard.overview.projectedEndingBalance.valueCents, 12500);
  assert.equal(reconciledDraftDashboard.overview.hasReconciledBalances, true);
  assert.equal(reconciledDraftDashboard.overview.balanceIsPreliminary, true);
  assert.equal((await setFinancePeriodPublication(env, session, "2025-10", true)).status, "published");
  const publishedDashboard = await getFinanceDashboard(env, viewer, "fy_2025_2026");
  assert.equal(publishedDashboard.overview.bankBalancesCents, 12500);
  assert.equal(publishedDashboard.overview.balanceIsPreliminary, false);
  assert.equal((await getFinanceTransactions(env, viewer, "fy_2025_2026", {})).length, 1);

  const priorPreview = await previewFinanceImport(env, session, {
    fiscalYearId: "fy_2024_2025",
    statementMonth: "2024-10",
    sourceFilename: "October 2024- BGSL.xlsx",
    sourceSha256: "prior123",
    openingBalanceCents: null,
    statementEndingBalanceCents: null,
    rows: [
      { ...row, transactionDate: "2024-10-03", amountCents: 7500, description: "Prior registration deposit" },
      { ...row, sourceRow: 6, transactionDate: "2024-10-04", amountCents: -1497500, classification: "expense", categoryId: "finance_expense_field_improvements", sourceCategory: "Debt", description: "Landscape project", isOneTime: true, isCapital: true },
    ],
  });
  await confirmFinanceImport(env, session, priorPreview.batchId, { confirm: true, rows: priorPreview.rows });
  const dashboardWithPriorCashFlow = await getFinanceDashboard(env, viewer, "fy_2025_2026");
  assert.equal(dashboardWithPriorCashFlow.cashFlowHistory[0].month, "2024-10");
  assert.equal(dashboardWithPriorCashFlow.cashFlowHistory.at(-1).month, "2026-09");
  assert.equal(dashboardWithPriorCashFlow.cashFlowHistory.find((month) => month.month === "2024-10").incomeCents, 7500);
  assert.equal(dashboardWithPriorCashFlow.cashFlowHistory.find((month) => month.month === "2024-10").expensesCents, 1497500);
  assert.equal(dashboardWithPriorCashFlow.monthly[0].month, "2025-10");
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fiscalYearToDate.current.externalIncomeCents, 12500);
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fiscalYearToDate.prior.externalIncomeCents, 7500);
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fiscalYearToDate.currentEndMonth, "2025-10");
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fiscalYearToDate.priorEndMonth, "2024-10");
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fullFiscalYear.current.externalIncomeCents, 12500);
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fullFiscalYear.prior.expensesCents, 1497500);
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fullFiscalYear.priorEndMonth, "2024-10");
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fullFiscalYear.currentIsComplete, false);
  assert.equal(dashboardWithPriorCashFlow.yearOverYear.fullFiscalYear.priorIsComplete, false);
  assert.match(dashboardWithPriorCashFlow.insights.find((insight) => insight.type === "category_change").text, /Field improvements \[Oct 2024\]/);
  database.close();
});
