import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAvailableCash,
  calculateHistoricalBalances,
  calculateReconciliation,
  compareSamePeriod,
  deterministicInsights,
  findDuplicateGroups,
  fiscalYearForDate,
  labelProjection,
  parseAmountToCents,
  projectFiscalYear,
  summarizeTransactions,
} from "../shared/financeCore.js";
import { buildImportChecklist, inferImportMonth, parseBgslWorkbook, validateImportRows } from "../shared/financeImport.js";
import { requireFinanceAuth } from "../functions/lib/financeAuth.js";

function transaction(overrides = {}) {
  return {
    accountId: "operating",
    transactionDate: "2026-02-01",
    statementMonth: "2026-02",
    amountCents: 10000,
    classification: "income",
    description: "Registration deposit",
    reconciliationStatus: "cleared",
    isInternalTransfer: false,
    isOneTime: false,
    isCapital: false,
    ...overrides,
  };
}

test("assigns October through September fiscal years", () => {
  assert.equal(fiscalYearForDate("2024-10-01").id, "fy_2024_2025");
  assert.equal(fiscalYearForDate("2024-10-01").label, "October 2024 – September 2025");
  assert.equal(fiscalYearForDate("2025-09-30").id, "fy_2024_2025");
  assert.equal(fiscalYearForDate("2025-10-01").id, "fy_2025_2026");
  assert.equal(fiscalYearForDate("2026-09-30").id, "fy_2025_2026");
});

test("parses currency into integer cents without floating-point storage", () => {
  assert.equal(parseAmountToCents("$1,234.56"), 123456);
  assert.equal(parseAmountToCents("(12.05)"), -1205);
  assert.throws(() => parseAmountToCents("1.234"), /Invalid currency/);
});

test("excludes internal transfers from income and expenses", () => {
  const summary = summarizeTransactions([
    transaction({ amountCents: 20000 }),
    transaction({ classification: "expense", amountCents: -5000, description: "Equipment" }),
    transaction({ classification: "transfer", amountCents: 1084755, description: "Internal transfer", isInternalTransfer: true }),
    transaction({ classification: "income", amountCents: 30000, description: "Transfer miscoded as income", isInternalTransfer: true }),
  ]);
  assert.equal(summary.externalIncomeCents, 20000);
  assert.equal(summary.expensesCents, 5000);
  assert.equal(summary.surplusCents, 15000);
});

test("separates one-time expenses from normalized operating expenses", () => {
  const summary = summarizeTransactions([
    transaction({ classification: "expense", amountCents: -1497500, description: "Landscape project", isOneTime: true, isCapital: true }),
    transaction({ classification: "expense", amountCents: -3014286, description: "Operating expenses" }),
  ]);
  assert.equal(summary.expensesCents, 4511786);
  assert.equal(summary.oneTimeExpensesCents, 1497500);
  assert.equal(summary.normalizedExpensesCents, 3014286);
});

test("calls out a capital project as a year-over-year insight without splitting expense totals", () => {
  const insights = deterministicInsights({
    comparison: {
      current: { transactionCount: 2, externalIncomeCents: 2000000, expensesCents: 1000000 },
      prior: { transactionCount: 3, externalIncomeCents: 2000000, expensesCents: 2497500 },
      incomeChangeCents: 0,
      expenseChangeCents: -1497500,
    },
    categoryChanges: [{ name: "Field improvements", currentCents: 0, priorCents: 1497500, changeCents: -1497500, statementMonths: ["2025-05"] }],
    notableCapitalExpenses: [{ comparisonPeriod: "prior", statementMonth: "2025-05", description: "Landscape project", amountCents: -1497500 }],
  });
  const categoryInsight = insights.find((insight) => insight.type === "category_change");
  const capitalInsight = insights.find((insight) => insight.type === "capital_expense_difference");
  assert.equal(categoryInsight.text, "Field improvements [May 2025] changed by a decrease.");
  assert.match(capitalInsight.text, /last year's capital project \[May 2025\]: Landscape project/i);
  assert.equal(capitalInsight.amountCents, 1497500);
});

test("calculates unvalidated historical balances around official statement anchors", () => {
  const rows = calculateHistoricalBalances({
    months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"],
    officialBalances: [
      { statementMonth: "2026-03", balanceCents: 10000, status: "reconciled", source: "reconciliation" },
      { statementMonth: "2026-05", balanceCents: 15000, status: "control", source: "statement_control" },
    ],
    monthlyMovements: [
      { statementMonth: "2026-01", movementCents: -1000 },
      { statementMonth: "2026-02", movementCents: 2000 },
      { statementMonth: "2026-03", movementCents: 3000 },
      { statementMonth: "2026-04", movementCents: -500 },
      { statementMonth: "2026-05", movementCents: 1000 },
    ],
  });

  assert.deepEqual(rows.map((row) => row.balanceCents), [5000, 7000, 10000, 9500, 15000, null]);
  assert.deepEqual(rows.map((row) => row.status), ["calculated", "calculated", "reconciled", "calculated", "control", "missing"]);
  assert.equal(rows[0].calculationDirection, "backward");
  assert.equal(rows[3].calculationDirection, "forward");
  assert.equal(rows[4].rollforwardDifferenceCents, 4500);
});

test("compares the same completed fiscal months year over year", () => {
  const result = compareSamePeriod(
    [transaction({ statementMonth: "2025-10", amountCents: 30000 }), transaction({ statementMonth: "2025-11", amountCents: 99999 })],
    [transaction({ statementMonth: "2024-10", amountCents: 20000 }), transaction({ statementMonth: "2024-11", amountCents: 88888 })],
    ["10"],
  );
  assert.equal(result.current.externalIncomeCents, 30000);
  assert.equal(result.prior.externalIncomeCents, 20000);
  assert.equal(result.incomeChangeCents, 10000);
});

test("calculates available cash in the required order", () => {
  assert.equal(calculateAvailableCash({
    bankBalancesCents: 1000000,
    reconciledCashOnHandCents: 50000,
    restrictedFundsCents: 100000,
    outstandingObligationsCents: 200000,
    reserveCents: 150000,
  }), 600000);
});

test("flags deterministic duplicate fingerprints", () => {
  const rows = [
    transaction({ description: "Sports Connect #123" }),
    transaction({ description: " sports-connect 123 " }),
    transaction({ amountCents: 10001, description: "Sports Connect #123" }),
  ];
  const groups = findDuplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].entries.length, 2);
});

test("reconciles only when cleared transaction movement explains the statement", () => {
  const result = calculateReconciliation({
    openingBalanceCents: 100000,
    statementEndingBalanceCents: 107500,
    transactions: [
      transaction({ amountCents: 10000 }),
      transaction({ classification: "expense", amountCents: -2500, description: "Fee" }),
      transaction({ classification: "expense", amountCents: -3000, description: "Outstanding check", reconciliationStatus: "outstanding" }),
    ],
    outstandingItemsCents: 3000,
  });
  assert.equal(result.expectedEndingBalanceCents, 107500);
  assert.equal(result.differenceCents, 0);
  assert.equal(result.outstandingItemsCents, 3000);
  assert.equal(result.status, "reconciled");

  const unresolved = calculateReconciliation({
    openingBalanceCents: 100000,
    statementEndingBalanceCents: 100000,
    transactions: [transaction({ reconciliationStatus: "unreviewed" })],
  });
  assert.equal(unresolved.canReconcile, false);
});

test("labels actual and projected periods explicitly", () => {
  assert.deepEqual(labelProjection(1000, false), { valueCents: 1000, isProjected: false, label: "Actual" });
  assert.deepEqual(projectFiscalYear({
    currentBalanceCents: 100000,
    actualMonths: ["2025-10"],
    monthlyForecasts: [{ statementMonth: "2025-10", netCents: 5000 }, { statementMonth: "2025-11", netCents: -20000 }],
  }), { valueCents: 80000, isProjected: true, label: "Projected" });
});

test("parses underlying workbook transaction rows and rejects out-of-period dates", () => {
  const rows = parseBgslWorkbook([{ sheet: "Transactions", data: [
    [], [], [], [],
    [null, "2026-02-05", 10.25, "Equipment", "Debt", null, "2026-03-01", 20, "Sports Connect", "Income- Other"],
  ] }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amountCents, -1025);
  assert.equal(rows[1].amountCents, 2000);
  const validated = validateImportRows(rows, { statementMonth: "2026-02", fiscalYearId: "fy_2025_2026" });
  assert.equal(validated[0].errors.length, 0);
  assert.match(validated[1].errors.join(" "), /outside 2026-02/);
});

test("detects monthly import periods from filenames and rejects annual workbooks", () => {
  assert.equal(inferImportMonth("October 2024- BGSL.xlsx"), "2024-10");
  assert.equal(inferImportMonth("Sept 2025- BGSL.xlsx"), "2025-09");
  assert.equal(inferImportMonth("transactions-2026-06.csv"), "2026-06");
  assert.throws(() => inferImportMonth("BGSL Oct 2024-Sept 2025 Financials.xlsx"), /multi-month files are not accepted/i);
});

test("builds a fiscal-year checklist from confirmed and preview import batches", () => {
  const checklist = buildImportChecklist(
    { startsOn: "2025-10-01" },
    [
      { statementMonth: "2025-10", status: "imported", sourceFilename: "October 2025.xlsx", importedCount: 24 },
      { statementMonth: "2025-11", status: "preview", sourceFilename: "November 2025.xlsx", rowCount: 18 },
      { statementMonth: "2025-12", status: "rolled_back", sourceFilename: "December 2025.xlsx", rowCount: 20 },
    ],
  );
  assert.equal(checklist.length, 12);
  assert.deepEqual(checklist.map((item) => item.statementMonth), ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.equal(checklist[0].imported, true);
  assert.equal(checklist[0].rowCount, 24);
  assert.equal(checklist[1].status, "preview");
  assert.equal(checklist[2].status, "not_imported");
});

test("enforces Board viewer versus finance editor permissions", async () => {
  const localRequest = new Request("http://localhost/api/board/finance/dashboard");
  const viewer = await requireFinanceAuth(localRequest, { FINANCE_LOCAL_AUTH_BYPASS: "true", FINANCE_LOCAL_AUTH_ROLE: "viewer" });
  assert.equal(viewer.ok, true);
  const viewerWrite = await requireFinanceAuth(localRequest, { FINANCE_LOCAL_AUTH_BYPASS: "true", FINANCE_LOCAL_AUTH_ROLE: "viewer" }, { editor: true });
  assert.equal(viewerWrite.status, 403);
  const editorWrite = await requireFinanceAuth(localRequest, { FINANCE_LOCAL_AUTH_BYPASS: "true", FINANCE_LOCAL_AUTH_ROLE: "editor" }, { editor: true });
  assert.equal(editorWrite.ok, true);
  const productionBypassAttempt = await requireFinanceAuth(new Request("https://bgslwalkup.com/api/board/finance/dashboard"), { FINANCE_LOCAL_AUTH_BYPASS: "true", FINANCE_LOCAL_AUTH_ROLE: "editor" }, { editor: true });
  assert.equal(productionBypassAttempt.status, 401);
});
