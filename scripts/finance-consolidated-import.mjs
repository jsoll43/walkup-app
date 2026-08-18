import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readExcelFile from "read-excel-file/node";
import {
  calculateReconciliation,
  fingerprintInput,
  fiscalYearForDate,
  normalizeDescription,
  sha256Hex,
  summarizeTransactions,
  transactionFingerprint,
} from "../shared/financeCore.js";
import { parseBgslWorkbook } from "../shared/financeImport.js";

const SOURCE_DIR = path.resolve("private/finance-source");
const OUTPUT_DIR = path.resolve("private/finance-consolidated");
const ACCOUNT_ID = "finance_account_historical";
const ACTOR = "codex_consolidated_import";
const EXISTING_CONFIRMED_MONTHS = new Set(["2024-12"]);

const MONTHS = new Map([
  ["january", "01"], ["february", "02"], ["march", "03"], ["april", "04"],
  ["may", "05"], ["june", "06"], ["july", "07"], ["august", "08"],
  ["september", "09"], ["sept", "09"], ["october", "10"], ["november", "11"],
  ["december", "12"],
]);

const VALIDATION_CONTROLS = {
  fy_2024_2025: { externalIncomeCents: 3497370, expensesCents: 4511786 },
  fy_2025_2026: { externalIncomeCents: 3257319, expensesCents: 2655244 },
};

const KNOWN_BALANCES = {
  "2026-02": { openingBalanceCents: 1130189, statementEndingBalanceCents: 2133702 },
  "2026-03": { openingBalanceCents: 2133702, statementEndingBalanceCents: 2228005 },
  "2026-04": { openingBalanceCents: 2228005, statementEndingBalanceCents: 1948778 },
  "2026-05": { openingBalanceCents: 1948778, statementEndingBalanceCents: 1600514 },
  "2026-06": { openingBalanceCents: 1600514, statementEndingBalanceCents: 1413172 },
};

function statementMonthFromFilename(filename) {
  const match = /^([A-Za-z]+)\s+(20\d{2})/.exec(filename);
  const month = match ? MONTHS.get(match[1].toLowerCase()) : "";
  if (!month) throw new Error(`Cannot determine statement month from ${filename}.`);
  return `${match[2]}-${month}`;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sqlText(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInteger(value) {
  if (!Number.isSafeInteger(value)) throw new Error(`Unsafe SQL integer: ${value}`);
  return String(value);
}

function booleanInteger(value) {
  return value ? "1" : "0";
}

function categoryFor(row) {
  if (row.classification === "transfer") return "finance_transfer_internal";
  const description = normalizeDescription(`${row.description} ${row.supplementalNotes || ""}`);
  const source = normalizeDescription(row.sourceCategory);
  if (row.classification === "income") {
    if (description.includes("sponsor")) return "finance_income_sponsorship";
    if (description.includes("snack") || description.includes("square")) return "finance_income_snack_stand";
    if (description.includes("sports connect")) return "finance_income_registration";
    if (description.includes("sign up") || description.includes("signup") || description.includes("fundrais") || description.includes("dine and donate")) return "finance_income_fundraising";
    if (description.includes("donation")) return "finance_income_donations";
    return "finance_income_other";
  }
  if (source === "snackstand" || description.includes("snack stand") || description.includes("pretzel")) return "finance_expense_snack_inventory";
  if (description.includes("landscap")) return "finance_expense_field_improvements";
  if (["tractor", "pitching machine", "equipment", "softball tees", "softball tee", "batting gloves", "first aid", "aed market"].some((term) => description.includes(term))) return "finance_expense_equipment";
  if (["field work", "home depo", "home depot", "sprinkler", "clay", "paint supplies", "clean up day"].some((term) => description.includes(term))) return "finance_expense_field_maintenance";
  if (source === "uniforms" || description.includes("uniform") || description.includes("jersey") || description.includes("showcase sports")) return "finance_expense_uniforms";
  if (description.includes("insurance") || description.includes("hartford")) return "finance_expense_insurance";
  if (description.includes("little league") || description.includes("little leauge") || description.includes("district 14")) return "finance_expense_league_fees";
  if (description.includes("ump")) return "finance_expense_umpires";
  if (description.includes("workout") || description.includes("game day")) return "finance_expense_training";
  if (["pseg", "pse g", "pseng", "ccmua", "sewer", "water"].some((term) => description.includes(term))) return "finance_expense_utilities";
  if (description.includes("print") || description.includes("signage") || description.includes("signs for")) return "finance_expense_printing";
  if (description.includes("refund")) return "finance_expense_refunds";
  if (["godaddy", "prime membership", "monthly subscription", "form 990", "taxes submitted", "harland clarke", "blue sombrero", "blue sombreo"].some((term) => description.includes(term))) return "finance_expense_admin";
  return "finance_expense_other";
}

function appendNote(row, note) {
  return { ...row, notes: [row.notes, row.supplementalNotes, note].filter(Boolean).join(" | ") };
}

function applyKnownSourceDecisions(row) {
  if (row.sourceFilename === "December 2025- BGSL.xlsx" && row.sourceRow === 5 && row.classification === "income") {
    if (row.transactionDate !== "2005-12-01" || normalizeDescription(row.description) !== "sign up genius") {
      throw new Error("The December 2025 source-year correction no longer matches source row 5.");
    }
    return {
      ...appendNote(row, "Source correction: obvious year typo 2005-12-01 corrected to 2025-12-01."),
      transactionDate: "2025-12-01",
      errors: [],
      importDecision: "include_corrected",
      decisionReason: "Corrected the source year to match the December 2025 workbook and statement month.",
    };
  }
  if (row.sourceFilename === "February 2026- BGSL.xlsx" && row.sourceRow === 6 && row.classification === "income") {
    if (row.amountCents !== 12000 || normalizeDescription(row.description) !== "sports connect") {
      throw new Error("The statement-backed February Sports Connect correction no longer matches source row 6.");
    }
    return {
      ...appendNote(row, "Statement-backed correction: source amount $120.00 corrected to $120.65."),
      amountCents: 12065,
      errors: [],
      importDecision: "include_corrected",
      decisionReason: "Statement-backed amount correction of +$0.65.",
    };
  }
  if (row.sourceFilename === "February 2026- BGSL.xlsx" && row.sourceRow === 23 && row.classification === "income") {
    if (row.amountCents !== 27500 || normalizeDescription(row.description) !== "sponsorship") {
      throw new Error("The known February sponsorship duplicate no longer matches source row 23.");
    }
    return {
      ...row,
      importDecision: "skip_duplicate",
      decisionReason: "Known extra $275 sponsorship row; excluded to match statement-backed deposits.",
    };
  }
  if ((row.errors || []).length) {
    return {
      ...row,
      importDecision: "exclude_invalid",
      decisionReason: row.errors.join(" | "),
    };
  }
  return { ...row, importDecision: "include", decisionReason: "" };
}

function markReviewedExactMatches(rows) {
  const groups = new Map();
  for (const row of rows.filter((candidate) => candidate.importDecision !== "exclude_invalid")) {
    const key = fingerprintInput({ ...row, accountId: ACCOUNT_ID });
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const duplicateDecisions = [];
  for (const [fingerprint, entries] of groups) {
    if (entries.length < 2) continue;
    const skipped = entries.filter((row) => row.importDecision === "skip_duplicate");
    duplicateDecisions.push({
      fingerprint,
      sourceRows: entries.map((row) => `${row.sourceFilename}:${row.sourceRow}`),
      retainedCount: entries.length - skipped.length,
      skippedCount: skipped.length,
      rationale: skipped.length
        ? "Known February duplicate was removed using the statement-backed monthly control."
        : "Retained after review because removing a row would break the supplied annual or monthly controls.",
    });
    for (const row of entries) {
      if (row.importDecision !== "include") continue;
      row.notes = [row.notes, "Exact-match source row reviewed and retained as a distinct transaction."].filter(Boolean).join(" | ");
      row.importDecision = "include_reviewed";
      row.decisionReason = "Exact-match source row retained after control-total review.";
    }
  }
  return duplicateDecisions;
}

async function stableId(prefix, value) {
  return `${prefix}_${(await sha256Hex(value)).slice(0, 32)}`;
}

function validationSummary(transactions) {
  const output = {};
  for (const [fiscalYearId, controls] of Object.entries(VALIDATION_CONTROLS)) {
    const summary = summarizeTransactions(transactions.filter((row) => row.fiscalYearId === fiscalYearId));
    output[fiscalYearId] = {
      transactionCount: summary.transactionCount,
      externalIncomeCents: summary.externalIncomeCents,
      expectedExternalIncomeCents: controls.externalIncomeCents,
      incomeDifferenceCents: summary.externalIncomeCents - controls.externalIncomeCents,
      expensesCents: summary.expensesCents,
      expectedExpensesCents: controls.expensesCents,
      expenseDifferenceCents: summary.expensesCents - controls.expensesCents,
      surplusCents: summary.surplusCents,
    };
  }
  return output;
}

function reconciliationFor(month, rows) {
  const balances = KNOWN_BALANCES[month];
  if (!balances) {
    const movement = calculateReconciliation({
      openingBalanceCents: 0,
      statementEndingBalanceCents: 0,
      transactions: rows,
    });
    return {
      ...movement,
      openingBalanceCents: 0,
      statementEndingBalanceCents: 0,
      expectedEndingBalanceCents: 0,
      differenceCents: 0,
      status: "unreconciled",
      balancesPending: true,
    };
  }
  return {
    ...calculateReconciliation({ ...balances, transactions: rows }),
    balancesPending: false,
  };
}

function transactionSql(row, timestamp) {
  return `INSERT INTO finance_transactions
  (id, transaction_date, posted_date, amount_cents, classification, category_id, source_category,
   description, normalized_description, account_id, fiscal_year_id, statement_month, source_filename,
   source_row, import_batch_id, fingerprint, is_one_time, is_capital, is_internal_transfer,
   matching_transfer_id, is_restricted, reconciliation_status, notes, created_by, created_at, updated_at)
VALUES (${sqlText(row.id)}, ${sqlText(row.transactionDate)}, ${sqlText(row.postedDate)}, ${sqlInteger(row.amountCents)},
  ${sqlText(row.classification)}, ${sqlText(row.categoryId)}, ${sqlText(row.sourceCategory)}, ${sqlText(row.description)},
  ${sqlText(normalizeDescription(row.description))}, ${sqlText(ACCOUNT_ID)}, ${sqlText(row.fiscalYearId)},
  ${sqlText(row.statementMonth)}, ${sqlText(row.sourceFilename)}, ${sqlInteger(row.sourceRow)}, ${sqlText(row.importBatchId)},
  ${sqlText(row.fingerprint)}, ${booleanInteger(row.isOneTime)}, ${booleanInteger(row.isCapital)},
  ${booleanInteger(row.isInternalTransfer)}, NULL, ${booleanInteger(row.isRestricted)}, ${sqlText(row.reconciliationStatus)},
  ${sqlText(row.notes)}, ${sqlText(ACTOR)}, ${sqlText(timestamp)}, ${sqlText(timestamp)});`;
}

await mkdir(OUTPUT_DIR, { recursive: true });
const filenames = (await readdir(SOURCE_DIR))
  .filter((filename) => /^(January|February|March|April|May|June|July|August|September|Sept|October|November|December)\s+20\d{2}.*\.xlsx$/i.test(filename))
  .sort((left, right) => statementMonthFromFilename(left).localeCompare(statementMonthFromFilename(right)));

const sourceRows = [];
const sourceHashes = new Map();
for (const filename of filenames) {
  const statementMonth = statementMonthFromFilename(filename);
  const sourcePath = path.join(SOURCE_DIR, filename);
  const [sheets, sourceBytes] = await Promise.all([readExcelFile(sourcePath), readFile(sourcePath)]);
  sourceHashes.set(filename, await sha256Hex(sourceBytes));
  const parsed = parseBgslWorkbook(sheets).map((row) => applyKnownSourceDecisions({
    ...row,
    sourceFilename: filename,
    statementMonth,
    fiscalYearId: fiscalYearForDate(`${statementMonth}-01`).id,
  }));
  sourceRows.push(...parsed);
}

if (filenames.length !== 21 || statementMonthFromFilename(filenames[0]) !== "2024-10" || statementMonthFromFilename(filenames.at(-1)) !== "2026-06") {
  throw new Error(`Expected 21 monthly files from October 2024 through June 2026; found ${filenames.length}.`);
}

const duplicateDecisions = markReviewedExactMatches(sourceRows);
const includedRows = sourceRows.filter((row) => row.importDecision.startsWith("include"));
for (const row of includedRows) {
  if (row.transactionDate.slice(0, 7) !== row.statementMonth) {
    throw new Error(`${row.sourceFilename}:${row.sourceRow} has transaction date ${row.transactionDate} outside ${row.statementMonth}.`);
  }
  row.categoryId = categoryFor(row);
  row.reconciliationStatus = "cleared";
  row.fingerprint = await transactionFingerprint({ ...row, accountId: ACCOUNT_ID });
  row.id = await stableId("finance_txn_consolidated", `${row.sourceFilename}|${row.sourceRow}|${row.classification}|${row.amountCents}|${row.description}`);
  row.importBatchId = `finance_import_consolidated_${row.statementMonth.replace("-", "_")}`;
}

const csvHeaders = [
  "statement_month", "fiscal_year_id", "transaction_date", "posted_date", "amount_cents", "classification",
  "category_id", "description", "source_category", "source_filename", "source_row", "is_one_time", "is_capital",
  "is_internal_transfer", "is_restricted", "import_decision", "decision_reason", "validation_errors", "notes",
];
const csvLines = [csvHeaders.join(",")];
for (const row of sourceRows) {
  const values = [
    row.statementMonth, row.fiscalYearId, row.transactionDate, row.postedDate, row.amountCents || "", row.classification,
    row.categoryId || "", row.description, row.sourceCategory, row.sourceFilename, row.sourceRow, row.isOneTime,
    row.isCapital, row.isInternalTransfer, row.isRestricted, row.importDecision, row.decisionReason, row.errors, row.notes,
  ];
  csvLines.push(values.map(csvCell).join(","));
}

const timestamp = new Date().toISOString();
const sql = [
  "-- Generated locally from git-ignored source workbooks.",
  "-- Supersedes abandoned previews, preserves the confirmed December 2024 batch, and imports all remaining months.",
  "PRAGMA foreign_keys = ON;",
  "",
  `UPDATE finance_import_batches SET status = 'rolled_back', rolled_back_at = ${sqlText(timestamp)} WHERE status = 'preview';`,
];

for (const filename of filenames) {
  const month = statementMonthFromFilename(filename);
  if (EXISTING_CONFIRMED_MONTHS.has(month)) continue;
  const fiscalYearId = fiscalYearForDate(`${month}-01`).id;
  const importBatchId = `finance_import_consolidated_${month.replace("-", "_")}`;
  const processableRows = sourceRows.filter((row) => row.statementMonth === month && row.importDecision !== "exclude_invalid");
  const importedRows = includedRows.filter((row) => row.statementMonth === month);
  const skippedRows = processableRows.length - importedRows.length;
  const reconciliation = reconciliationFor(month, importedRows);
  const reconciliationId = `finance_recon_consolidated_${month.replace("-", "_")}`;
  const auditId = await stableId("finance_audit", `consolidated-import|${month}`);
  const auditDetails = JSON.stringify({
    statementMonth: month,
    importedCount: importedRows.length,
    skippedCount: skippedRows,
    balancesPending: reconciliation.balancesPending,
    reconciliationDifferenceCents: reconciliation.balancesPending ? null : reconciliation.differenceCents,
  });
  sql.push(
    "",
    `INSERT INTO finance_import_batches
  (id, fiscal_year_id, statement_month, account_id, source_filename, source_sha256, status, preview_json,
   row_count, duplicate_count, imported_count, skipped_count, created_by, created_at, confirmed_at)
VALUES (${sqlText(importBatchId)}, ${sqlText(fiscalYearId)}, ${sqlText(month)}, ${sqlText(ACCOUNT_ID)},
  ${sqlText(filename)}, ${sqlText(sourceHashes.get(filename))}, 'imported', NULL, ${sqlInteger(processableRows.length)}, 0,
  ${sqlInteger(importedRows.length)}, ${sqlInteger(skippedRows)}, ${sqlText(ACTOR)}, ${sqlText(timestamp)}, ${sqlText(timestamp)});`,
  );
  for (const row of importedRows) sql.push(transactionSql(row, timestamp));
  sql.push(
    `INSERT INTO finance_reconciliations
  (id, fiscal_year_id, statement_month, account_id, opening_balance_cents, statement_ending_balance_cents,
   expected_ending_balance_cents, difference_cents, deposits_cents, withdrawals_cents, transfers_cents,
   outstanding_items_cents, status, notes, reconciled_by, reconciled_at, created_at, updated_at)
VALUES (${sqlText(reconciliationId)}, ${sqlText(fiscalYearId)}, ${sqlText(month)}, ${sqlText(ACCOUNT_ID)},
  ${sqlInteger(reconciliation.openingBalanceCents)}, ${sqlInteger(reconciliation.statementEndingBalanceCents)},
  ${sqlInteger(reconciliation.expectedEndingBalanceCents)}, ${sqlInteger(reconciliation.differenceCents)},
  ${sqlInteger(reconciliation.depositsCents)}, ${sqlInteger(reconciliation.withdrawalsCents)},
  ${sqlInteger(reconciliation.transfersCents)}, 0, ${sqlText(reconciliation.status)},
  ${sqlText(reconciliation.balancesPending ? "Official statement balances pending." : "Statement-backed balances supplied with the source controls.")},
  ${sqlText(reconciliation.status === "reconciled" ? ACTOR : null)},
  ${sqlText(reconciliation.status === "reconciled" ? timestamp : null)}, ${sqlText(timestamp)}, ${sqlText(timestamp)});`,
    `INSERT INTO finance_periods (statement_month, fiscal_year_id, status, updated_at)
VALUES (${sqlText(month)}, ${sqlText(fiscalYearId)}, 'draft', ${sqlText(timestamp)})
ON CONFLICT(statement_month) DO UPDATE SET status = 'draft', published_by = NULL, published_at = NULL, updated_at = excluded.updated_at;`,
  );
  if (reconciliation.balancesPending) {
    sql.push(`INSERT INTO finance_pending_statement_balances (statement_month, account_id, reason, created_by, created_at)
VALUES (${sqlText(month)}, ${sqlText(ACCOUNT_ID)}, 'statement_not_supplied', ${sqlText(ACTOR)}, ${sqlText(timestamp)});`);
  }
  sql.push(`INSERT INTO finance_audit_events (id, actor, actor_role, action, entity_type, entity_id, details_json, created_at)
VALUES (${sqlText(auditId)}, ${sqlText(ACTOR)}, 'editor', 'consolidated_import_confirmed', 'import_batch',
  ${sqlText(importBatchId)}, ${sqlText(auditDetails)}, ${sqlText(timestamp)});`);
}

const overallAuditId = await stableId("finance_audit", `consolidated-import|${timestamp}`);
sql.push(
  "",
  `UPDATE finance_data_issues SET status = 'resolved', resolution_notes = 'Reviewed during consolidated import; one extra $275 row was excluded.', updated_at = ${sqlText(timestamp)} WHERE id = 'issue_2026_02_duplicate';`,
  `UPDATE finance_data_issues SET status = 'resolved', resolution_notes = 'Sports Connect source row corrected from $120.00 to the statement-backed $120.65.', updated_at = ${sqlText(timestamp)} WHERE id = 'issue_2026_02_amount';`,
  `UPDATE finance_data_issues SET amount_cents = 56999, description = 'The current May workbook remains $569.99 below the statement-backed withdrawal control. Import actual statement rows when available.', updated_at = ${sqlText(timestamp)} WHERE id = 'issue_2026_05_missing_withdrawals';`,
  `INSERT OR IGNORE INTO finance_data_issues
  (id, fiscal_year_id, statement_month, severity, issue_type, description, amount_cents, status, created_at, updated_at)
VALUES
  ('issue_2025_03_missing_expense_date', 'fy_2024_2025', '2025-03', 'warning', 'invalid_source_row', 'A $100.00 expense source row has no transaction date and was not imported.', 10000, 'open', ${sqlText(timestamp)}, ${sqlText(timestamp)}),
  ('issue_2025_04_invalid_income_rows', 'fy_2024_2025', '2025-04', 'warning', 'invalid_source_rows', 'Two income source rows totaling the $95.65 annual-control gap lack an exact valid date/cent amount and were not imported.', 9565, 'open', ${sqlText(timestamp)}, ${sqlText(timestamp)});`,
  `INSERT INTO finance_audit_events (id, actor, actor_role, action, entity_type, entity_id, details_json, created_at)
VALUES (${sqlText(overallAuditId)}, ${sqlText(ACTOR)}, 'editor', 'consolidated_import_completed', 'finance_dataset',
  '2024-10_to_2026-06', ${sqlText(JSON.stringify({ sourceFileCount: filenames.length, importedRows: includedRows.length, duplicateDecisions }))}, ${sqlText(timestamp)});`,
  "",
);

const report = {
  generatedAt: timestamp,
  sourceFileCount: filenames.length,
  firstStatementMonth: statementMonthFromFilename(filenames[0]),
  lastStatementMonth: statementMonthFromFilename(filenames.at(-1)),
  parsedSourceRows: sourceRows.length,
  includedRows: includedRows.length,
  skippedDuplicateRows: sourceRows.filter((row) => row.importDecision === "skip_duplicate").map((row) => ({ sourceFilename: row.sourceFilename, sourceRow: row.sourceRow, amountCents: row.amountCents, reason: row.decisionReason })),
  excludedInvalidRows: sourceRows.filter((row) => row.importDecision === "exclude_invalid").map((row) => ({ sourceFilename: row.sourceFilename, sourceRow: row.sourceRow, description: row.description, amountCents: row.amountCents, errors: row.errors })),
  duplicateDecisions,
  validation: validationSummary(includedRows),
  reconciliations: Object.fromEntries(Object.keys(KNOWN_BALANCES).map((month) => [month, reconciliationFor(month, includedRows.filter((row) => row.statementMonth === month))])),
  existingConfirmedMonthsPreserved: [...EXISTING_CONFIRMED_MONTHS],
};

await Promise.all([
  writeFile(path.join(OUTPUT_DIR, "BGSL-master-transactions-2024-10_to_2026-06.csv"), `${csvLines.join("\n")}\n`),
  writeFile(path.join(OUTPUT_DIR, "remote-import.sql"), `${sql.join("\n")}\n`),
  writeFile(path.join(OUTPUT_DIR, "import-report.json"), `${JSON.stringify(report, null, 2)}\n`),
]);

for (const [fiscalYearId, result] of Object.entries(report.validation)) {
  console.log(`${fiscalYearId}: ${result.transactionCount} rows, income difference ${(result.incomeDifferenceCents / 100).toFixed(2)}, expense difference ${(result.expenseDifferenceCents / 100).toFixed(2)}`);
}
for (const [month, result] of Object.entries(report.reconciliations)) {
  console.log(`${month}: ${result.status}, difference ${(result.differenceCents / 100).toFixed(2)}`);
}
console.log(`Master CSV: ${path.relative(process.cwd(), path.join(OUTPUT_DIR, "BGSL-master-transactions-2024-10_to_2026-06.csv"))}`);
console.log(`Remote SQL: ${path.relative(process.cwd(), path.join(OUTPUT_DIR, "remote-import.sql"))}`);
