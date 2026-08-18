import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readExcelFile from "read-excel-file/node";
import {
  findDuplicateGroups,
  summarizeTransactions,
} from "../shared/financeCore.js";
import { parseBgslWorkbook } from "../shared/financeImport.js";

const SOURCE_DIR = path.resolve("private/finance-source");
const OUTPUT_DIR = path.resolve("private/finance-analysis");
const ACCOUNT_ID = "finance_account_operating";

const CONTROL_VALUES = {
  fy_2024_2025: {
    annual: { externalIncomeCents: 3497370, expensesCents: 4511786, oneTimeExpensesCents: 1497500, normalizedExpensesCents: 3014286, beginningCashCents: 1830612, endingCashCents: 811097 },
    months: {},
  },
  fy_2025_2026: {
    annual: { externalIncomeCents: 3257319, expensesCents: 2655244, surplusCents: 602075, endingCashCents: 1413172 },
    months: {
      "2026-02": { openingBalanceCents: 1130189, incomeCents: 1168355, expensesCents: 164842, endingBalanceCents: 2133702 },
      "2026-03": { openingBalanceCents: 2133702, incomeCents: 857023, expensesCents: 762720, endingBalanceCents: 2228005 },
      "2026-04": { openingBalanceCents: 2228005, incomeCents: 164154, expensesCents: 443381, endingBalanceCents: 1948778 },
      "2026-05": { openingBalanceCents: 1948778, incomeCents: 113426, expensesCents: 461690, endingBalanceCents: 1600514 },
      "2026-06": { openingBalanceCents: 1600514, incomeCents: 105844, expensesCents: 293186, endingBalanceCents: 1413172 },
    },
  },
};

const MONTH_NAMES = new Map([
  ["january", "01"], ["february", "02"], ["march", "03"], ["april", "04"], ["may", "05"], ["june", "06"],
  ["july", "07"], ["august", "08"], ["september", "09"], ["sept", "09"], ["october", "10"], ["november", "11"], ["december", "12"],
]);

function monthFromFilename(filename) {
  const match = /^([A-Za-z]+)\s+(\d{4})/.exec(filename);
  if (!match) return "";
  const month = MONTH_NAMES.get(match[1].toLowerCase());
  return month ? `${match[2]}-${month}` : "";
}

function fiscalYearId(month) {
  const [year, numericMonth] = month.split("-").map(Number);
  const start = numericMonth >= 10 ? year : year - 1;
  return `fy_${start}_${start + 1}`;
}

function sourceRows(transactions) {
  return transactions.map((transaction) => ({
    sourceFilename: transaction.sourceFilename,
    sourceRow: transaction.sourceRow,
    classification: transaction.classification,
    amountCents: transaction.amountCents,
  }));
}

function comparison(metric, actualCents, expectedCents, transactions) {
  return {
    metric,
    actualCents,
    expectedCents,
    differenceCents: actualCents - expectedCents,
    status: actualCents === expectedCents ? "matched" : "mismatch",
    sourceRows: actualCents === expectedCents ? [] : sourceRows(transactions),
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });
const filenames = (await readdir(SOURCE_DIR))
  .filter((filename) => filename.toLowerCase().endsWith(".xlsx"))
  .filter((filename) => !filename.startsWith("BGSL Oct"))
  .sort((left, right) => left.localeCompare(right));

const allTransactions = [];
const fileResults = [];

for (const filename of filenames) {
  const statementMonth = monthFromFilename(filename);
  if (!statementMonth) continue;
  const sheets = await readExcelFile(path.join(SOURCE_DIR, filename));
  const parsed = parseBgslWorkbook(sheets).map((transaction) => ({
    ...transaction,
    accountId: ACCOUNT_ID,
    statementMonth,
    fiscalYearId: fiscalYearId(statementMonth),
    sourceFilename: filename,
  }));
  const valid = parsed.filter((transaction) => transaction.errors.length === 0);
  const invalid = parsed.filter((transaction) => transaction.errors.length > 0);
  allTransactions.push(...valid);
  fileResults.push({ filename, statementMonth, fiscalYearId: fiscalYearId(statementMonth), validRows: valid.length, invalidRows: invalid.map((transaction) => ({ sourceRow: transaction.sourceRow, errors: transaction.errors })) });
  await writeFile(path.join(OUTPUT_DIR, `${statementMonth}.json`), `${JSON.stringify({ sourceFilename: filename, statementMonth, fiscalYearId: fiscalYearId(statementMonth), accountId: ACCOUNT_ID, transactions: parsed }, null, 2)}\n`);
}

const duplicateGroups = findDuplicateGroups(allTransactions).map((group) => ({
  fingerprint: group.fingerprint,
  rows: group.entries.map(({ transaction }) => ({ sourceFilename: transaction.sourceFilename, sourceRow: transaction.sourceRow, statementMonth: transaction.statementMonth, amountCents: transaction.amountCents, classification: transaction.classification })),
}));

const report = { generatedAt: new Date().toISOString(), sourceFileCount: filenames.length, sourceFiles: fileResults, duplicateGroups, fiscalYears: {}, unresolvedIssues: [] };

for (const [yearId, controls] of Object.entries(CONTROL_VALUES)) {
  const transactions = allTransactions.filter((transaction) => transaction.fiscalYearId === yearId);
  const summary = summarizeTransactions(transactions);
  const annualComparisons = [];
  for (const metric of ["externalIncomeCents", "expensesCents", "oneTimeExpensesCents", "normalizedExpensesCents", "surplusCents"]) {
    if (Number.isSafeInteger(controls.annual[metric])) annualComparisons.push(comparison(metric, summary[metric], controls.annual[metric], transactions));
  }
  const monthlyComparisons = [];
  for (const [month, monthControls] of Object.entries(controls.months)) {
    const monthTransactions = transactions.filter((transaction) => transaction.statementMonth === month);
    const monthSummary = summarizeTransactions(monthTransactions);
    const checks = [
      comparison("incomeCents", monthSummary.externalIncomeCents, monthControls.incomeCents, monthTransactions.filter((transaction) => transaction.classification === "income" && !transaction.isInternalTransfer)),
      comparison("expensesCents", monthSummary.expensesCents, monthControls.expensesCents, monthTransactions.filter((transaction) => transaction.classification === "expense" && !transaction.isInternalTransfer)),
    ];
    const expectedEndingFromSourceCents = monthControls.openingBalanceCents + monthSummary.surplusCents;
    checks.push({ metric: "endingBalanceCents", actualCents: expectedEndingFromSourceCents, expectedCents: monthControls.endingBalanceCents, differenceCents: expectedEndingFromSourceCents - monthControls.endingBalanceCents, status: expectedEndingFromSourceCents === monthControls.endingBalanceCents ? "matched" : "mismatch", sourceRows: expectedEndingFromSourceCents === monthControls.endingBalanceCents ? [] : sourceRows(monthTransactions) });
    monthlyComparisons.push({ month, openingBalanceCents: monthControls.openingBalanceCents, checks });
  }
  report.fiscalYears[yearId] = { transactionCount: transactions.length, sourceSummary: summary, controls: controls.annual, annualComparisons, monthlyComparisons };
}

const prior = report.fiscalYears.fy_2024_2025;
if (prior) {
  const expectedEndingFromActivityCents = CONTROL_VALUES.fy_2024_2025.annual.beginningCashCents + prior.sourceSummary.surplusCents;
  prior.endingCashRollforward = {
    beginningCashCents: CONTROL_VALUES.fy_2024_2025.annual.beginningCashCents,
    sourceNetActivityCents: prior.sourceSummary.surplusCents,
    expectedEndingFromActivityCents,
    statementControlEndingCents: CONTROL_VALUES.fy_2024_2025.annual.endingCashCents,
    differenceCents: expectedEndingFromActivityCents - CONTROL_VALUES.fy_2024_2025.annual.endingCashCents,
  };
  prior.invalidSourceRowsScenario = {
    disclosure: "Control comparison only. These source rows remain invalid and are not imported automatically.",
    incomeCorrectionCents: 9565,
    expenseCorrectionCents: 10000,
    adjustedExternalIncomeCents: prior.sourceSummary.externalIncomeCents + 9565,
    adjustedExpensesCents: prior.sourceSummary.expensesCents + 10000,
    adjustedSurplusCents: prior.sourceSummary.surplusCents + 9565 - 10000,
    annualControlsMatched: prior.sourceSummary.externalIncomeCents + 9565 === CONTROL_VALUES.fy_2024_2025.annual.externalIncomeCents && prior.sourceSummary.expensesCents + 10000 === CONTROL_VALUES.fy_2024_2025.annual.expensesCents,
  };
}

const current = report.fiscalYears.fy_2025_2026;
if (current) {
  current.knownStatementCorrectionScenario = {
    disclosure: "Validation scenario only. Corrections are not inserted as balancing transactions.",
    adjustments: [
      { statementMonth: "2026-02", metric: "externalIncomeCents", amountCents: -27435, reason: "Remove one duplicated $275 sponsorship and correct $120.00 to $120.65." },
      { statementMonth: "2026-05", metric: "expensesCents", amountCents: 56999, reason: "The current workbook remains $569.99 below the statement-backed withdrawal control and requires actual statement rows." },
    ],
    adjustedExternalIncomeCents: current.sourceSummary.externalIncomeCents - 27435,
    adjustedExpensesCents: current.sourceSummary.expensesCents + 59519,
    adjustedSurplusCents: current.sourceSummary.surplusCents - 27435 - 59519,
  };
  current.knownStatementCorrectionScenario.controlsMatched =
    current.knownStatementCorrectionScenario.adjustedExternalIncomeCents === CONTROL_VALUES.fy_2025_2026.annual.externalIncomeCents &&
    current.knownStatementCorrectionScenario.adjustedExpensesCents === CONTROL_VALUES.fy_2025_2026.annual.expensesCents &&
    current.knownStatementCorrectionScenario.adjustedSurplusCents === CONTROL_VALUES.fy_2025_2026.annual.surplusCents;
}

report.unresolvedIssues.push(
  { fiscalYearId: "fy_2024_2025", type: "unreconciled_snack_cash", amountCents: 331800, status: "open", message: "Snack-stand cash lacks a clear deposit trail in the supplied spreadsheets." },
  { fiscalYearId: "fy_2025_2026", statementMonth: "2026-02", type: "source_amount_error", amountCents: 65, status: "open", message: "The source row is $120.00; the statement-backed control is $120.65." },
  { fiscalYearId: "fy_2025_2026", statementMonth: "2026-05", type: "missing_statement_transactions", amountCents: 56999, status: "open", message: "The current workbook remains $569.99 below the statement-backed withdrawal control; no balancing entries were created." },
);

await writeFile(path.join(OUTPUT_DIR, "reconciliation-report.json"), `${JSON.stringify(report, null, 2)}\n`);

for (const [yearId, result] of Object.entries(report.fiscalYears)) {
  console.log(`${yearId}: ${result.transactionCount} valid transaction rows, income ${(result.sourceSummary.externalIncomeCents / 100).toFixed(2)}, expenses ${(result.sourceSummary.expensesCents / 100).toFixed(2)}, net ${(result.sourceSummary.surplusCents / 100).toFixed(2)}`);
  result.annualComparisons.filter((check) => check.status !== "matched").forEach((check) => console.log(`  ${check.metric}: difference ${(check.differenceCents / 100).toFixed(2)}`));
  result.monthlyComparisons.forEach(({ month, checks }) => checks.filter((check) => check.status !== "matched").forEach((check) => console.log(`  ${month} ${check.metric}: difference ${(check.differenceCents / 100).toFixed(2)}`)));
}
console.log(`Possible duplicate groups: ${duplicateGroups.length}`);
console.log(`Local-only report: ${path.relative(process.cwd(), path.join(OUTPUT_DIR, "reconciliation-report.json"))}`);
