import {
  calculateAvailableCash,
  calculateHistoricalBalances,
  calculateReconciliation,
  compareSamePeriod,
  deterministicInsights,
  fiscalMonths,
  fiscalYearForDate,
  fiscalYearRangeLabel,
  normalizeDate,
  normalizeDescription,
  projectFiscalYear,
  signedAmountFor,
  summarizeTransactions,
  transactionFingerprint,
} from "../../shared/financeCore.js";

const HISTORICAL_IMPORT_ACCOUNT_ID = "finance_account_historical";

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function all(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  const result = binds.length ? await statement.bind(...binds).all() : await statement.all();
  return result?.results || [];
}

async function first(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  return binds.length ? statement.bind(...binds).first() : statement.first();
}

async function run(env, sql, binds = []) {
  const statement = env.DB.prepare(sql);
  return binds.length ? statement.bind(...binds).run() : statement.run();
}

function bool(value) {
  return Number(value) === 1;
}

function mapTransaction(row) {
  return {
    id: row.id,
    transactionDate: row.transaction_date,
    postedDate: row.posted_date || "",
    amountCents: Number(row.amount_cents),
    classification: row.classification,
    categoryId: row.category_id || "",
    categoryName: row.category_name || "Uncategorized",
    sourceCategory: row.source_category || "",
    description: row.description,
    normalizedDescription: row.normalized_description,
    accountId: row.account_id,
    accountName: row.account_name || "",
    fiscalYearId: row.fiscal_year_id,
    statementMonth: row.statement_month,
    sourceFilename: row.source_filename || "",
    sourceRow: row.source_row == null ? null : Number(row.source_row),
    importBatchId: row.import_batch_id || "",
    fingerprint: row.fingerprint,
    isOneTime: bool(row.is_one_time),
    isCapital: bool(row.is_capital),
    isInternalTransfer: bool(row.is_internal_transfer),
    matchingTransferId: row.matching_transfer_id || "",
    isRestricted: bool(row.is_restricted),
    reconciliationStatus: row.reconciliation_status,
    notes: row.notes || "",
    periodStatus: row.period_status || "draft",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || "",
  };
}

function mapReconciliation(row) {
  return {
    id: row.id,
    fiscalYearId: row.fiscal_year_id,
    statementMonth: row.statement_month,
    accountId: row.account_id,
    accountName: row.account_name || "",
    accountType: row.account_type || "bank",
    openingBalanceCents: Number(row.opening_balance_cents),
    statementEndingBalanceCents: Number(row.statement_ending_balance_cents),
    expectedEndingBalanceCents: Number(row.expected_ending_balance_cents),
    differenceCents: Number(row.difference_cents),
    depositsCents: Number(row.deposits_cents),
    withdrawalsCents: Number(row.withdrawals_cents),
    transfersCents: Number(row.transfers_cents),
    outstandingItemsCents: Number(row.outstanding_items_cents),
    status: row.status,
    documentId: row.document_id || "",
    notes: row.notes || "",
    reconciledBy: row.reconciled_by || "",
    reconciledAt: row.reconciled_at || "",
    periodStatus: row.period_status || "draft",
    balancesKnown: !row.pending_balance_month,
    updatedAt: row.updated_at,
  };
}

export async function auditFinance(env, session, action, entityType, entityId, details = {}) {
  await run(
    env,
    `INSERT INTO finance_audit_events
       (id, actor, actor_role, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id("finance_audit"), session.actor, session.role, action, entityType, entityId, JSON.stringify(details), nowIso()],
  );
}

export async function getFinanceBootstrap(env, session) {
  const [fiscalYears, accounts, categories] = await Promise.all([
    all(env, `SELECT id, label, starts_on, ends_on, status FROM finance_fiscal_years ORDER BY starts_on DESC`),
    all(env, `SELECT id, name, account_type, last_four, is_active FROM finance_accounts WHERE is_active = 1 ORDER BY account_type, name`),
    all(env, `SELECT id, name, classification, display_order, is_active FROM finance_categories WHERE is_active = 1 ORDER BY display_order, name`),
  ]);
  return {
    session: { role: session.role, actor: session.actor, expiresAt: session.expiresAt || "" },
    fiscalYears: fiscalYears.map((row) => ({ id: row.id, label: fiscalYearRangeLabel(row.starts_on, row.ends_on), startsOn: row.starts_on, endsOn: row.ends_on, status: row.status })),
    accounts: accounts.map((row) => ({ id: row.id, name: row.name, accountType: row.account_type, lastFour: row.last_four || "", isActive: bool(row.is_active) })),
    categories: categories.map((row) => ({ id: row.id, name: row.name, classification: row.classification, displayOrder: Number(row.display_order), isActive: bool(row.is_active) })),
  };
}

async function loadTransactions(env, { fiscalYearId, session, filters = {}, includePrior = false, includeDraft = false }) {
  const where = [`t.deleted_at IS NULL`];
  const binds = [];
  if (fiscalYearId && !includePrior) {
    where.push(`t.fiscal_year_id = ?`);
    binds.push(fiscalYearId);
  }
  if (filters.month) { where.push(`t.statement_month = ?`); binds.push(filters.month); }
  if (filters.accountId) { where.push(`t.account_id = ?`); binds.push(filters.accountId); }
  if (filters.categoryId) { where.push(`t.category_id = ?`); binds.push(filters.categoryId); }
  if (filters.classification) { where.push(`t.classification = ?`); binds.push(filters.classification); }
  if (filters.oneTime === "true") where.push(`(t.is_one_time = 1 OR t.is_capital = 1)`);
  if (filters.oneTime === "false") where.push(`t.is_one_time = 0 AND t.is_capital = 0`);
  if (filters.search) {
    where.push(`(lower(t.description) LIKE ? OR lower(t.source_category) LIKE ? OR lower(t.notes) LIKE ?)`);
    const value = `%${String(filters.search).toLowerCase().slice(0, 100)}%`;
    binds.push(value, value, value);
  }
  if (session.role !== "editor" && !includeDraft) where.push(`p.status = 'published'`);
  const rows = await all(
    env,
    `SELECT t.*, c.name AS category_name, a.name AS account_name, COALESCE(p.status, 'draft') AS period_status
     FROM finance_transactions t
     LEFT JOIN finance_categories c ON c.id = t.category_id
     JOIN finance_accounts a ON a.id = t.account_id
     LEFT JOIN finance_periods p ON p.statement_month = t.statement_month
     WHERE ${where.join(" AND ")}
     ORDER BY t.transaction_date DESC, t.source_row DESC, t.id DESC
     LIMIT 5000`,
    binds,
  );
  return rows.map(mapTransaction);
}

export async function getFinanceTransactions(env, session, fiscalYearId, filters) {
  return loadTransactions(env, { fiscalYearId, session, filters });
}

function groupBy(items, keyFn) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return groups;
}

function categoryTotals(transactions, classification) {
  const groups = groupBy(
    transactions.filter((transaction) => transaction.classification === classification && !transaction.isInternalTransfer),
    (transaction) => transaction.categoryName || "Uncategorized",
  );
  return [...groups.entries()]
    .map(([name, rows]) => ({ name, amountCents: rows.reduce((sum, row) => sum + Math.abs(row.amountCents), 0), transactionCount: rows.length }))
    .sort((left, right) => right.amountCents - left.amountCents);
}

function vendorTotals(transactions) {
  const groups = groupBy(
    transactions.filter((transaction) => transaction.classification === "expense" && !transaction.isInternalTransfer),
    (transaction) => transaction.description,
  );
  return [...groups.entries()]
    .map(([name, rows]) => ({ name, amountCents: rows.reduce((sum, row) => sum + Math.abs(row.amountCents), 0), transactionCount: rows.length }))
    .sort((left, right) => right.amountCents - left.amountCents)
    .slice(0, 10);
}

function monthlyCashFlow(transactions, months, forecasts) {
  const transactionsByMonth = groupBy(transactions, (transaction) => transaction.statementMonth);
  const forecastsByMonth = groupBy(forecasts, (forecast) => forecast.statement_month);
  let runningNetCents = 0;
  return months.map((month) => {
    const rows = transactionsByMonth.get(month) || [];
    const summary = summarizeTransactions(rows);
    const forecastRows = forecastsByMonth.get(month) || [];
    const forecastIncomeCents = forecastRows.filter((row) => row.classification === "income").reduce((sum, row) => sum + Number(row.amount_cents), 0);
    const forecastExpensesCents = forecastRows.filter((row) => row.classification === "expense").reduce((sum, row) => sum + Math.abs(Number(row.amount_cents)), 0);
    runningNetCents += summary.surplusCents;
    return {
      month,
      hasActual: rows.length > 0,
      isPreliminary: rows.some((row) => row.periodStatus !== "published"),
      transactionCount: rows.length,
      incomeCents: summary.externalIncomeCents,
      expensesCents: summary.expensesCents,
      netCents: summary.surplusCents,
      runningNetCents,
      forecastIncomeCents,
      forecastExpensesCents,
      forecastNetCents: forecastIncomeCents - forecastExpensesCents,
      hasForecast: forecastRows.length > 0,
    };
  });
}

async function loadReconciliations(env, fiscalYearId) {
  const rows = await all(
    env,
    `SELECT r.*, a.name AS account_name, a.account_type, COALESCE(p.status, 'draft') AS period_status,
            pending.statement_month AS pending_balance_month
     FROM finance_reconciliations r
     JOIN finance_accounts a ON a.id = r.account_id
     LEFT JOIN finance_periods p ON p.statement_month = r.statement_month
     LEFT JOIN finance_pending_statement_balances pending
       ON pending.statement_month = r.statement_month AND pending.account_id = r.account_id
     WHERE r.fiscal_year_id = ?
     ORDER BY r.statement_month, a.name`,
    [fiscalYearId],
  );
  return rows.map(mapReconciliation);
}

function monthRange(firstMonth, lastMonth) {
  if (!/^\d{4}-\d{2}$/.test(firstMonth) || !/^\d{4}-\d{2}$/.test(lastMonth) || firstMonth > lastMonth) return [];
  const months = [];
  let [year, month] = firstMonth.split("-").map(Number);
  while (`${year}-${String(month).padStart(2, "0")}` <= lastMonth) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) { year += 1; month = 1; }
  }
  return months;
}

async function loadHistoricalBalances(env) {
  const [boundary, controls, reconciliations, movements] = await Promise.all([
    first(env, `SELECT MIN(substr(starts_on, 1, 7)) AS first_month FROM finance_fiscal_years`),
    all(env, `SELECT statement_month, expected_cents
              FROM finance_validation_controls
              WHERE metric = 'ending_cash' AND statement_month IS NOT NULL
              ORDER BY statement_month`),
    all(env, `SELECT r.statement_month, SUM(r.statement_ending_balance_cents) AS balance_cents,
                     CASE WHEN SUM(CASE WHEN r.status = 'reconciled' THEN 0 ELSE 1 END) = 0
                          THEN 'reconciled' ELSE 'unreconciled' END AS status
              FROM finance_reconciliations r
              LEFT JOIN finance_pending_statement_balances pending
                ON pending.statement_month = r.statement_month AND pending.account_id = r.account_id
              WHERE pending.statement_month IS NULL
              GROUP BY r.statement_month
              ORDER BY r.statement_month`),
    all(env, `SELECT t.statement_month,
                     SUM(CASE
                           WHEN t.classification = 'income' AND t.is_internal_transfer = 0 THEN ABS(t.amount_cents)
                           WHEN t.classification = 'expense' AND t.is_internal_transfer = 0 THEN -ABS(t.amount_cents)
                           ELSE 0
                         END) AS movement_cents
              FROM finance_transactions t
              WHERE t.deleted_at IS NULL AND t.reconciliation_status != 'void'
              GROUP BY t.statement_month
              ORDER BY t.statement_month`),
  ]);
  const knownByMonth = new Map(controls.map((row) => [row.statement_month, {
    balanceCents: Number(row.expected_cents),
    status: "control",
    source: "statement_control",
  }]));
  reconciliations.forEach((row) => knownByMonth.set(row.statement_month, {
    balanceCents: Number(row.balance_cents),
    status: row.status,
    source: "reconciliation",
  }));
  const knownMonths = [...knownByMonth.keys()].sort();
  const movementMonths = movements.map((row) => row.statement_month).sort();
  const lastMonth = [...knownMonths, ...movementMonths].sort().at(-1);
  if (!lastMonth) return [];
  const earliestDataMonth = [...knownMonths, ...movementMonths].sort()[0];
  const firstMonth = boundary?.first_month && boundary.first_month <= lastMonth ? boundary.first_month : earliestDataMonth;
  return calculateHistoricalBalances({
    months: monthRange(firstMonth, lastMonth),
    officialBalances: [...knownByMonth.entries()].map(([statementMonth, row]) => ({ statementMonth, ...row })),
    monthlyMovements: movements.map((row) => ({ statementMonth: row.statement_month, movementCents: Number(row.movement_cents) })),
  });
}

function latestReconciledBalances(reconciliations) {
  const byAccount = new Map();
  reconciliations
    .filter((item) => item.status === "reconciled" && item.balancesKnown)
    .forEach((item) => {
      const current = byAccount.get(item.accountId);
      if (!current || item.statementMonth > current.statementMonth) byAccount.set(item.accountId, item);
    });
  return [...byAccount.values()];
}

function categoryChanges(current, prior) {
  const currentMap = new Map(categoryTotals(current, "expense").map((row) => [row.name, row.amountCents]));
  const priorMap = new Map(categoryTotals(prior, "expense").map((row) => [row.name, row.amountCents]));
  return [...new Set([...currentMap.keys(), ...priorMap.keys()])]
    .map((name) => ({ name, currentCents: currentMap.get(name) || 0, priorCents: priorMap.get(name) || 0, changeCents: (currentMap.get(name) || 0) - (priorMap.get(name) || 0) }))
    .sort((left, right) => Math.abs(right.changeCents) - Math.abs(left.changeCents));
}

function controlsActuals(controls, transactions, reconciliations) {
  const result = {};
  controls.forEach((control) => {
    const isYtd = control.metric.endsWith("_ytd");
    const scoped = control.statement_month
      ? transactions.filter((transaction) => isYtd ? transaction.statementMonth <= control.statement_month : transaction.statementMonth === control.statement_month)
      : transactions;
    const summary = summarizeTransactions(scoped);
    if (["external_income", "external_income_ytd", "income"].includes(control.metric)) result[control.id] = summary.externalIncomeCents;
    if (["expenses", "expenses_ytd"].includes(control.metric)) result[control.id] = summary.expensesCents;
    if (control.metric === "one_time_expenses") result[control.id] = summary.oneTimeExpensesCents;
    if (control.metric === "normalized_expenses") result[control.id] = summary.normalizedExpensesCents;
    if (["net", "net_ytd"].includes(control.metric)) result[control.id] = summary.surplusCents;
    if (control.metric === "ending_cash") {
      const rows = reconciliations.filter((item) => item.statementMonth === control.statement_month && item.balancesKnown);
      if (rows.length) result[control.id] = rows.reduce((sum, item) => sum + item.statementEndingBalanceCents, 0);
    }
    if (control.metric === "beginning_cash") {
      const rows = reconciliations.filter((item) => item.statementMonth === control.statement_month && item.balancesKnown);
      if (rows.length) result[control.id] = rows.reduce((sum, item) => sum + item.openingBalanceCents, 0);
    }
  });
  return result;
}

function discrepancyRows(control, transactions) {
  const isYtd = control.metric.endsWith("_ytd");
  const scoped = control.statement_month
    ? transactions.filter((transaction) => isYtd ? transaction.statementMonth <= control.statement_month : transaction.statementMonth === control.statement_month)
    : transactions;
  return scoped.map((transaction) => ({
    transactionId: transaction.id,
    statementMonth: transaction.statementMonth,
    sourceFilename: transaction.sourceFilename,
    sourceRow: transaction.sourceRow,
    amountCents: transaction.amountCents,
    classification: transaction.classification,
  }));
}

export async function getFinanceDashboard(env, session, fiscalYearId) {
  const fiscalYear = await first(env, `SELECT * FROM finance_fiscal_years WHERE id = ?`, [fiscalYearId]);
  if (!fiscalYear) throw Object.assign(new Error("Fiscal year not found."), { status: 404 });
  const priorStartYear = Number(fiscalYear.starts_on.slice(0, 4)) - 1;
  const priorFiscalYearId = `fy_${priorStartYear}_${priorStartYear + 1}`;
  const [transactions, priorTransactions, reconciliations, restrictedFunds, commitments, settings, forecasts, issues, controls, imports, historicalBalances] = await Promise.all([
    loadTransactions(env, { fiscalYearId, session, includeDraft: true }),
    loadTransactions(env, { fiscalYearId: priorFiscalYearId, session, includeDraft: true }),
    loadReconciliations(env, fiscalYearId),
    all(env, `SELECT * FROM finance_restricted_funds WHERE is_active = 1 AND (fiscal_year_id = ? OR fiscal_year_id IS NULL)`, [fiscalYearId]),
    all(env, `SELECT * FROM finance_commitments WHERE status = 'outstanding' AND (fiscal_year_id = ? OR fiscal_year_id IS NULL)`, [fiscalYearId]),
    first(env, `SELECT reserve_cents FROM finance_settings WHERE fiscal_year_id = ?`, [fiscalYearId]),
    all(env, `SELECT * FROM finance_forecasts WHERE fiscal_year_id = ?`, [fiscalYearId]),
    all(env, `SELECT * FROM finance_data_issues WHERE status = 'open' AND (fiscal_year_id = ? OR fiscal_year_id IS NULL) ORDER BY severity DESC, statement_month`, [fiscalYearId]),
    all(env, `SELECT * FROM finance_validation_controls WHERE fiscal_year_id = ? ORDER BY statement_month, id`, [fiscalYearId]),
    all(env, `SELECT duplicate_count, status FROM finance_import_batches WHERE fiscal_year_id = ? AND status != 'rolled_back'`, [fiscalYearId]),
    loadHistoricalBalances(env),
  ]);
  const months = fiscalMonths(Number(fiscalYear.starts_on.slice(0, 4)));
  const summary = summarizeTransactions(transactions);
  const balanceReconciliations = session.role === "editor"
    ? reconciliations
    : reconciliations.filter((item) => item.periodStatus === "published");
  const latestBalances = latestReconciledBalances(balanceReconciliations);
  const bankBalancesCents = latestBalances.filter((item) => item.accountType === "bank").reduce((sum, item) => sum + item.statementEndingBalanceCents, 0);
  const reconciledCashOnHandCents = latestBalances.filter((item) => item.accountType === "cash").reduce((sum, item) => sum + item.statementEndingBalanceCents, 0);
  const restrictedFundsCents = restrictedFunds.reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const outstandingObligationsCents = commitments.reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const reserveCents = Number(settings?.reserve_cents || 0);
  const latestReconciledMonth = reconciliations.filter((item) => item.status === "reconciled" && item.balancesKnown).map((item) => item.statementMonth).sort().at(-1) || "";
  const actualMonths = [...new Set(transactions.map((transaction) => transaction.statementMonth))].sort();
  const forecastMonthly = months.map((month) => ({
    statementMonth: month,
    netCents: forecasts.filter((forecast) => forecast.statement_month === month).reduce((sum, forecast) => sum + (forecast.classification === "income" ? Number(forecast.amount_cents) : -Math.abs(Number(forecast.amount_cents))), 0),
  }));
  const projection = projectFiscalYear({ currentBalanceCents: bankBalancesCents + reconciledCashOnHandCents, actualMonths, monthlyForecasts: forecastMonthly });
  const completedMonthNumbers = actualMonths.map((month) => month.slice(5, 7));
  const comparison = compareSamePeriod(transactions, priorTransactions, completedMonthNumbers);
  const completedMonthSet = new Set(completedMonthNumbers);
  const currentComparisonTransactions = transactions.filter((transaction) => completedMonthSet.has(transaction.statementMonth?.slice(5, 7)));
  const priorComparisonTransactions = priorTransactions.filter((transaction) => completedMonthSet.has(transaction.statementMonth?.slice(5, 7)));
  const changes = categoryChanges(currentComparisonTransactions, priorComparisonTransactions);
  const monthly = monthlyCashFlow(transactions, months, forecasts);
  const missingMonths = months.filter((month) => month <= (actualMonths.at(-1) || "") && !reconciliations.some((item) => item.statementMonth === month));
  const duplicateCount = imports.reduce((sum, batch) => sum + Number(batch.duplicate_count || 0), 0);
  const mappedIssues = issues.map((issue) => ({ issueType: issue.issue_type, severity: issue.severity, description: issue.description, amountCents: issue.amount_cents == null ? null : Number(issue.amount_cents), status: issue.status }));
  const mappedControls = controls.map((control) => ({ ...control, expectedCents: Number(control.expected_cents) }));
  const actuals = controlsActuals(controls, transactions, reconciliations);
  const discrepancies = mappedControls.map((control) => {
    const actualCents = actuals[control.id];
    const status = Number.isSafeInteger(actualCents) ? (actualCents === control.expectedCents ? "matched" : "mismatch") : "missing";
    return {
      id: control.id,
      statementMonth: control.statement_month || "",
      metric: control.metric,
      expectedCents: control.expectedCents,
      actualCents: Number.isSafeInteger(actualCents) ? actualCents : null,
      differenceCents: Number.isSafeInteger(actualCents) ? actualCents - control.expectedCents : null,
      status,
      notes: control.notes,
      sourceRows: status === "mismatch" ? discrepancyRows(control, transactions) : [],
    };
  });
  return {
    fiscalYear: { id: fiscalYear.id, label: fiscalYearRangeLabel(fiscalYear.starts_on, fiscalYear.ends_on), startsOn: fiscalYear.starts_on, endsOn: fiscalYear.ends_on },
    overview: {
      bankBalancesCents,
      reconciledCashOnHandCents,
      restrictedFundsCents,
      outstandingObligationsCents,
      reserveCents,
      availableCashCents: calculateAvailableCash({ bankBalancesCents, reconciledCashOnHandCents, restrictedFundsCents, outstandingObligationsCents, reserveCents }),
      ytdIncomeCents: summary.externalIncomeCents,
      ytdExpensesCents: summary.expensesCents,
      ytdSurplusCents: summary.surplusCents,
      projectedEndingBalance: projection,
      latestReconciledMonth,
      hasUnreconciled: reconciliations.length === 0 || reconciliations.some((item) => item.status !== "reconciled" || !item.balancesKnown) || missingMonths.length > 0,
    },
    monthly,
    historicalBalances,
    spending: {
      byCategory: categoryTotals(transactions, "expense"),
      routineCents: summary.normalizedExpensesCents,
      oneTimeCents: summary.oneTimeExpensesCents,
      categoryChanges: changes,
      topVendors: vendorTotals(transactions),
    },
    income: { byCategory: categoryTotals(transactions, "income") },
    yearOverYear: { ...comparison, categoryChanges: changes },
    ai: { availableMonths: actualMonths, comparedMonths: completedMonthNumbers },
    reconciliations,
    insights: deterministicInsights({ comparison, categoryChanges: changes.filter((change) => change.changeCents !== 0), oneTimeExpenses: transactions.filter((transaction) => transaction.isOneTime || transaction.isCapital).sort((left, right) => Math.abs(right.amountCents) - Math.abs(left.amountCents)), reconciliations, missingMonths, duplicateCount, projection, dataIssues: mappedIssues }),
    discrepancies,
    dataIssues: mappedIssues,
  };
}

async function applyCategoryMappings(env, rows) {
  const [mappings, categories] = await Promise.all([
    all(env, `SELECT * FROM finance_category_mappings ORDER BY priority DESC, id`),
    all(env, `SELECT id, classification FROM finance_categories WHERE is_active = 1`),
  ]);
  const fallback = new Map([
    ["income", "finance_income_other"],
    ["expense", "finance_expense_other"],
    ["transfer", "finance_transfer_internal"],
  ]);
  const categoryClassifications = new Map(categories.map((category) => [category.id, category.classification]));
  return rows.map((row) => {
    const sourceCategory = normalizeDescription(row.sourceCategory);
    const description = normalizeDescription(`${row.description} ${row.supplementalNotes || ""}`);
    const explicitCategoryValid = row.categoryId && categoryClassifications.get(row.categoryId) === row.classification;
    const mapping = mappings.find((candidate) => {
      if (candidate.classification !== row.classification) return false;
      const sourceMatches = !candidate.source_category || normalizeDescription(candidate.source_category) === sourceCategory;
      const descriptionMatches = !candidate.description_contains || description.includes(normalizeDescription(candidate.description_contains));
      return sourceMatches && descriptionMatches;
    });
    return { ...row, categoryId: explicitCategoryValid ? row.categoryId : (mapping?.category_id || fallback.get(row.classification)) };
  });
}

function validatePreviewRow(row, batch) {
  const errors = [];
  const transactionDate = normalizeDate(row.transactionDate);
  if (!transactionDate) errors.push("Invalid or missing transaction date.");
  if (transactionDate && transactionDate.slice(0, 7) !== batch.statementMonth) errors.push(`Transaction date is outside ${batch.statementMonth}.`);
  if (transactionDate && fiscalYearForDate(transactionDate).id !== batch.fiscalYearId) errors.push("Transaction date is outside the selected fiscal year.");
  if (!Number.isSafeInteger(Number(row.amountCents)) || Number(row.amountCents) === 0) errors.push("Amount must be a non-zero integer number of cents.");
  if (!['income', 'expense', 'transfer'].includes(row.classification)) errors.push("Invalid classification.");
  if (!String(row.description || "").trim()) errors.push("Description is required.");
  const classification = String(row.classification || "");
  const normalizedAmountCents = Number.isSafeInteger(Number(row.amountCents)) && ['income', 'expense', 'transfer'].includes(classification)
    ? signedAmountFor(classification, Number(row.amountCents))
    : Number(row.amountCents);
  return {
    ...row,
    transactionDate,
    postedDate: normalizeDate(row.postedDate) || "",
    amountCents: normalizedAmountCents,
    description: String(row.description || "").trim().slice(0, 500),
    sourceCategory: String(row.sourceCategory || "").trim().slice(0, 200),
    notes: [row.supplementalNotes, row.notes].filter(Boolean).join(" | ").slice(0, 1000),
    isOneTime: Boolean(row.isOneTime),
    isCapital: Boolean(row.isCapital),
    isInternalTransfer: row.classification === "transfer" || Boolean(row.isInternalTransfer),
    isRestricted: Boolean(row.isRestricted),
    reconciliationStatus: ['cleared', 'outstanding', 'unreviewed', 'void'].includes(row.reconciliationStatus) ? row.reconciliationStatus : "unreviewed",
    errors,
  };
}

async function detectDuplicates(env, rows, accountId) {
  const fingerprints = await Promise.all(rows.map((row) => transactionFingerprint({ ...row, accountId })));
  const existing = new Map();
  for (let offset = 0; offset < fingerprints.length; offset += 80) {
    const chunk = fingerprints.slice(offset, offset + 80);
    if (!chunk.length) continue;
    const matches = await all(env, `SELECT id, fingerprint FROM finance_transactions WHERE deleted_at IS NULL AND fingerprint IN (${chunk.map(() => "?").join(",")})`, chunk);
    matches.forEach((match) => existing.set(match.fingerprint, [...(existing.get(match.fingerprint) || []), match.id]));
  }
  const seen = new Map();
  return rows.map((row, index) => {
    const fingerprint = fingerprints[index];
    const earlierRows = seen.get(fingerprint) || [];
    seen.set(fingerprint, [...earlierRows, index]);
    const possibleDuplicate = (existing.get(fingerprint)?.length || 0) > 0 || earlierRows.length > 0;
    return {
      ...row,
      fingerprint,
      possibleDuplicate,
      duplicateMatches: existing.get(fingerprint) || [],
      duplicatePreviewRows: earlierRows.map((rowIndex) => rowIndex + 1),
    };
  });
}

export async function previewFinanceImport(env, session, body) {
  const batch = {
    fiscalYearId: String(body.fiscalYearId || ""),
    statementMonth: String(body.statementMonth || ""),
    accountId: HISTORICAL_IMPORT_ACCOUNT_ID,
  };
  if (!/^\d{4}-\d{2}$/.test(batch.statementMonth)) throw Object.assign(new Error("A statement month is required."), { status: 400 });
  if (fiscalYearForDate(`${batch.statementMonth}-01`).id !== batch.fiscalYearId) throw Object.assign(new Error("Statement month is outside the selected fiscal year."), { status: 400 });
  const [fiscalYear, account] = await Promise.all([
    first(env, `SELECT id FROM finance_fiscal_years WHERE id = ?`, [batch.fiscalYearId]),
    first(env, `SELECT id, name FROM finance_accounts WHERE id = ? AND is_active = 1`, [batch.accountId]),
  ]);
  if (!fiscalYear || !account) throw Object.assign(new Error("The historical import account is unavailable. Apply migration 0009 before importing."), { status: 409 });
  if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 2000) throw Object.assign(new Error("Import must contain between 1 and 2,000 transaction rows."), { status: 400 });
  let rows = body.rows.map((row) => validatePreviewRow(row, batch));
  rows = await applyCategoryMappings(env, rows);
  rows = await detectDuplicates(env, rows, batch.accountId);
  const importBatchId = id("finance_import");
  const hasOpeningBalance = body.openingBalanceCents !== null && body.openingBalanceCents !== undefined && body.openingBalanceCents !== "";
  const hasEndingBalance = body.statementEndingBalanceCents !== null && body.statementEndingBalanceCents !== undefined && body.statementEndingBalanceCents !== "";
  if (hasOpeningBalance !== hasEndingBalance) throw Object.assign(new Error("Provide both statement balances or leave both pending."), { status: 400 });
  const balancesPending = !hasOpeningBalance;
  const openingBalanceCents = balancesPending ? null : Number(body.openingBalanceCents);
  const statementEndingBalanceCents = balancesPending ? null : Number(body.statementEndingBalanceCents);
  if (!balancesPending && (!Number.isSafeInteger(openingBalanceCents) || !Number.isSafeInteger(statementEndingBalanceCents))) {
    throw Object.assign(new Error("Opening and ending balances must be integer cents."), { status: 400 });
  }
  const reconciliation = balancesPending
    ? null
    : calculateReconciliation({ openingBalanceCents, statementEndingBalanceCents, transactions: rows, outstandingItemsCents: 0 });
  const preview = { rows, openingBalanceCents, statementEndingBalanceCents, balancesPending, reconciliation };
  const duplicateCount = rows.filter((row) => row.possibleDuplicate).length;
  await run(
    env,
    `INSERT INTO finance_import_batches
       (id, fiscal_year_id, statement_month, account_id, source_filename, source_sha256, status, preview_json,
        row_count, duplicate_count, imported_count, skipped_count, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'preview', ?, ?, ?, 0, 0, ?, ?)`,
    [importBatchId, batch.fiscalYearId, batch.statementMonth, batch.accountId, String(body.sourceFilename || "upload").split(/[\\/]/).at(-1).slice(0, 240), String(body.sourceSha256 || "").slice(0, 64), JSON.stringify(preview), rows.length, duplicateCount, session.actor, nowIso()],
  );
  await auditFinance(env, session, "import_preview_created", "import_batch", importBatchId, { statementMonth: batch.statementMonth, accountId: batch.accountId, balancesPending, rowCount: rows.length, duplicateCount });
  return { batchId: importBatchId, statementMonth: batch.statementMonth, fiscalYearId: batch.fiscalYearId, accountName: account.name, ...preview, duplicateCount };
}

export async function confirmFinanceImport(env, session, batchId, body) {
  if (body.confirm !== true) throw Object.assign(new Error("Explicit import confirmation is required."), { status: 400 });
  const batch = await first(env, `SELECT * FROM finance_import_batches WHERE id = ?`, [batchId]);
  if (!batch) throw Object.assign(new Error("Import batch not found."), { status: 404 });
  if (batch.status !== "preview") throw Object.assign(new Error(`Import batch is already ${batch.status}.`), { status: 409 });
  const original = JSON.parse(batch.preview_json || "{}");
  const inputRows = Array.isArray(body.rows) ? body.rows : original.rows;
  const batchInput = { fiscalYearId: batch.fiscal_year_id, statementMonth: batch.statement_month };
  let rows = inputRows.map((row) => validatePreviewRow(row, batchInput));
  rows = await applyCategoryMappings(env, rows);
  rows = await detectDuplicates(env, rows, batch.account_id);
  const invalid = rows.filter((row) => row.errors.length > 0);
  if (invalid.length) throw Object.assign(new Error(`${invalid.length} transaction row(s) still contain validation errors.`), { status: 400, details: invalid.map((row) => ({ sourceRow: row.sourceRow, errors: row.errors })) });
  const undecidedDuplicates = rows.filter((row) => row.possibleDuplicate && !['include', 'skip'].includes(row.duplicateDecision));
  if (undecidedDuplicates.length) throw Object.assign(new Error("Every possible duplicate requires an explicit include or skip decision."), { status: 409 });
  const included = rows.filter((row) => !row.possibleDuplicate || row.duplicateDecision === "include");
  const skipped = rows.length - included.length;
  const timestamp = nowIso();
  const statements = included.map((row) => {
    const transactionId = id("finance_txn");
    return env.DB.prepare(
      `INSERT INTO finance_transactions
         (id, transaction_date, posted_date, amount_cents, classification, category_id, source_category,
          description, normalized_description, account_id, fiscal_year_id, statement_month, source_filename,
          source_row, import_batch_id, fingerprint, is_one_time, is_capital, is_internal_transfer,
          matching_transfer_id, is_restricted, reconciliation_status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      transactionId, row.transactionDate, row.postedDate || null, row.amountCents, row.classification, row.categoryId || null,
      row.sourceCategory, row.description, normalizeDescription(row.description), batch.account_id, batch.fiscal_year_id,
      batch.statement_month, batch.source_filename, row.sourceRow || null, batch.id, row.fingerprint, row.isOneTime ? 1 : 0,
      row.isCapital ? 1 : 0, row.isInternalTransfer ? 1 : 0, row.isRestricted ? 1 : 0, row.reconciliationStatus,
      row.notes || "", session.actor, timestamp, timestamp,
    );
  });
  const hasStoredBalances = Number.isSafeInteger(original.openingBalanceCents) && Number.isSafeInteger(original.statementEndingBalanceCents);
  const balancesPending = original.balancesPending === true || !hasStoredBalances;
  const movement = calculateReconciliation({
    openingBalanceCents: 0,
    statementEndingBalanceCents: 0,
    transactions: included,
    outstandingItemsCents: 0,
  });
  const reconciliation = balancesPending
    ? { ...movement, openingBalanceCents: 0, statementEndingBalanceCents: 0, expectedEndingBalanceCents: 0, differenceCents: 0, canReconcile: false, status: "unreconciled" }
    : calculateReconciliation({
      openingBalanceCents: Number(original.openingBalanceCents),
      statementEndingBalanceCents: Number(original.statementEndingBalanceCents),
      transactions: included,
      outstandingItemsCents: 0,
    });
  statements.push(env.DB.prepare(
    `INSERT INTO finance_reconciliations
       (id, fiscal_year_id, statement_month, account_id, opening_balance_cents, statement_ending_balance_cents,
        expected_ending_balance_cents, difference_cents, deposits_cents, withdrawals_cents, transfers_cents,
        outstanding_items_cents, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreconciled', '', ?, ?)
     ON CONFLICT(statement_month, account_id) DO UPDATE SET
       fiscal_year_id = excluded.fiscal_year_id,
       opening_balance_cents = excluded.opening_balance_cents,
       statement_ending_balance_cents = excluded.statement_ending_balance_cents,
       expected_ending_balance_cents = excluded.expected_ending_balance_cents,
       difference_cents = excluded.difference_cents,
       deposits_cents = excluded.deposits_cents,
       withdrawals_cents = excluded.withdrawals_cents,
       transfers_cents = excluded.transfers_cents,
       outstanding_items_cents = excluded.outstanding_items_cents,
       status = 'unreconciled', reconciled_by = NULL, reconciled_at = NULL, updated_at = excluded.updated_at`,
  ).bind(id("finance_recon"), batch.fiscal_year_id, batch.statement_month, batch.account_id, reconciliation.openingBalanceCents,
    reconciliation.statementEndingBalanceCents, reconciliation.expectedEndingBalanceCents, reconciliation.differenceCents,
    reconciliation.depositsCents, reconciliation.withdrawalsCents, reconciliation.transfersCents,
    reconciliation.outstandingItemsCents, timestamp, timestamp));
  statements.push(balancesPending
    ? env.DB.prepare(
      `INSERT INTO finance_pending_statement_balances
         (statement_month, account_id, reason, created_by, created_at)
       VALUES (?, ?, 'statement_not_supplied', ?, ?)
       ON CONFLICT(statement_month, account_id) DO UPDATE SET
         reason = excluded.reason, created_by = excluded.created_by, created_at = excluded.created_at`,
    ).bind(batch.statement_month, batch.account_id, session.actor, timestamp)
    : env.DB.prepare(`DELETE FROM finance_pending_statement_balances WHERE statement_month = ? AND account_id = ?`).bind(batch.statement_month, batch.account_id));
  statements.push(env.DB.prepare(
    `INSERT INTO finance_periods (statement_month, fiscal_year_id, status, updated_at)
     VALUES (?, ?, 'draft', ?)
     ON CONFLICT(statement_month) DO UPDATE SET status = 'draft', published_by = NULL, published_at = NULL, updated_at = excluded.updated_at`,
  ).bind(batch.statement_month, batch.fiscal_year_id, timestamp));
  statements.push(env.DB.prepare(
    `UPDATE finance_import_batches
     SET status = 'imported', preview_json = NULL, imported_count = ?, skipped_count = ?, confirmed_at = ?
     WHERE id = ? AND status = 'preview'`,
  ).bind(included.length, skipped, timestamp, batch.id));
  await env.DB.batch(statements);
  await auditFinance(env, session, "import_confirmed", "import_batch", batch.id, { importedCount: included.length, skippedCount: skipped, balancesPending, reconciliationDifferenceCents: balancesPending ? null : reconciliation.differenceCents });
  return { batchId: batch.id, importedCount: included.length, skippedCount: skipped, balancesPending, reconciliation: { ...reconciliation, status: "unreconciled" } };
}

export async function rollbackFinanceImport(env, session, batchId) {
  const batch = await first(env, `SELECT * FROM finance_import_batches WHERE id = ?`, [batchId]);
  if (!batch) throw Object.assign(new Error("Import batch not found."), { status: 404 });
  if (batch.status !== "imported") throw Object.assign(new Error("Only an imported batch can be rolled back."), { status: 409 });
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`UPDATE finance_transactions SET deleted_at = ?, updated_at = ? WHERE import_batch_id = ? AND deleted_at IS NULL`).bind(timestamp, timestamp, batchId),
    env.DB.prepare(`UPDATE finance_import_batches SET status = 'rolled_back', rolled_back_at = ? WHERE id = ?`).bind(timestamp, batchId),
    env.DB.prepare(`UPDATE finance_reconciliations SET status = 'unreconciled', reconciled_by = NULL, reconciled_at = NULL, updated_at = ? WHERE statement_month = ? AND account_id = ?`).bind(timestamp, batch.statement_month, batch.account_id),
    env.DB.prepare(`UPDATE finance_periods SET status = 'draft', published_by = NULL, published_at = NULL, updated_at = ? WHERE statement_month = ?`).bind(timestamp, batch.statement_month),
  ]);
  await auditFinance(env, session, "import_rolled_back", "import_batch", batchId, { statementMonth: batch.statement_month, accountId: batch.account_id });
  return { batchId, status: "rolled_back" };
}

export async function saveFinanceReconciliation(env, session, statementMonth, body) {
  const accountId = String(body.accountId || "");
  const existing = await first(env, `SELECT * FROM finance_reconciliations WHERE statement_month = ? AND account_id = ?`, [statementMonth, accountId]);
  if (!existing) throw Object.assign(new Error("Reconciliation record not found. Import transactions first."), { status: 404 });
  const rows = await loadTransactions(env, { fiscalYearId: existing.fiscal_year_id, session: { role: "editor" }, filters: { month: statementMonth, accountId } });
  const openingBalanceCents = Number(body.openingBalanceCents);
  const statementEndingBalanceCents = Number(body.statementEndingBalanceCents);
  const outstandingItemsCents = Number(body.outstandingItemsCents || 0);
  if (![openingBalanceCents, statementEndingBalanceCents, outstandingItemsCents].every(Number.isSafeInteger)) {
    throw Object.assign(new Error("Statement balances and outstanding items must be integer cents."), { status: 400 });
  }
  const calculation = calculateReconciliation({
    openingBalanceCents,
    statementEndingBalanceCents,
    transactions: rows,
    outstandingItemsCents,
  });
  const wantsReconciled = body.status === "reconciled";
  if (wantsReconciled && !calculation.canReconcile) throw Object.assign(new Error("The month cannot be reconciled until the difference is $0.00 and every transaction is reviewed."), { status: 409, details: calculation });
  const status = wantsReconciled ? "reconciled" : "unreconciled";
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE finance_reconciliations SET
       opening_balance_cents = ?, statement_ending_balance_cents = ?, expected_ending_balance_cents = ?,
       difference_cents = ?, deposits_cents = ?, withdrawals_cents = ?, transfers_cents = ?, outstanding_items_cents = ?,
       status = ?, document_id = ?, notes = ?, reconciled_by = ?, reconciled_at = ?, updated_at = ?
       WHERE statement_month = ? AND account_id = ?`,
    ).bind(calculation.openingBalanceCents, calculation.statementEndingBalanceCents, calculation.expectedEndingBalanceCents,
      calculation.differenceCents, calculation.depositsCents, calculation.withdrawalsCents, calculation.transfersCents,
      calculation.outstandingItemsCents, status, body.documentId || null, String(body.notes || "").slice(0, 1000),
      wantsReconciled ? session.actor : null, wantsReconciled ? timestamp : null, timestamp, statementMonth, accountId),
    env.DB.prepare(`DELETE FROM finance_pending_statement_balances WHERE statement_month = ? AND account_id = ?`).bind(statementMonth, accountId),
  ]);
  await auditFinance(env, session, wantsReconciled ? "month_reconciled" : "reconciliation_updated", "reconciliation", existing.id, calculation);
  return { ...calculation, status, balancesKnown: true };
}

export async function setFinancePeriodPublication(env, session, statementMonth, publish) {
  const reconciliations = await all(env,
    `SELECT r.status, r.difference_cents, pending.statement_month AS pending_balance_month
     FROM finance_reconciliations r
     LEFT JOIN finance_pending_statement_balances pending
       ON pending.statement_month = r.statement_month AND pending.account_id = r.account_id
     WHERE r.statement_month = ?`,
    [statementMonth],
  );
  if (publish && (!reconciliations.length || reconciliations.some((item) => item.status !== "reconciled" || Number(item.difference_cents) !== 0 || item.pending_balance_month))) {
    throw Object.assign(new Error("Every account for the month must be reconciled with a $0.00 difference before publishing."), { status: 409 });
  }
  const fiscalYearId = fiscalYearForDate(`${statementMonth}-01`).id;
  const timestamp = nowIso();
  await run(
    env,
    `INSERT INTO finance_periods (statement_month, fiscal_year_id, status, published_by, published_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(statement_month) DO UPDATE SET status = excluded.status, published_by = excluded.published_by,
       published_at = excluded.published_at, updated_at = excluded.updated_at`,
    [statementMonth, fiscalYearId, publish ? "published" : "draft", publish ? session.actor : null, publish ? timestamp : null, timestamp],
  );
  await auditFinance(env, session, publish ? "month_published" : "month_unpublished", "finance_period", statementMonth);
  return { statementMonth, status: publish ? "published" : "draft" };
}

export async function updateFinanceTransaction(env, session, transactionId, body) {
  const beforeRow = await first(env, `SELECT * FROM finance_transactions WHERE id = ? AND deleted_at IS NULL`, [transactionId]);
  if (!beforeRow) throw Object.assign(new Error("Transaction not found."), { status: 404 });
  const transactionDate = normalizeDate(body.transactionDate || beforeRow.transaction_date);
  const classification = String(body.classification || beforeRow.classification);
  const rawAmountCents = Number(body.amountCents ?? beforeRow.amount_cents);
  const description = String(body.description ?? beforeRow.description).trim();
  if (!transactionDate || !['income', 'expense', 'transfer'].includes(classification) || !Number.isSafeInteger(rawAmountCents) || !description) throw Object.assign(new Error("Invalid transaction update."), { status: 400 });
  const amountCents = signedAmountFor(classification, rawAmountCents);
  const category = body.categoryId ? await first(env, `SELECT id, classification FROM finance_categories WHERE id = ? AND is_active = 1`, [body.categoryId]) : null;
  if (body.categoryId && (!category || category.classification !== classification)) throw Object.assign(new Error("Category does not match the transaction classification."), { status: 400 });
  const fingerprint = await transactionFingerprint({ accountId: beforeRow.account_id, transactionDate, amountCents, description });
  const timestamp = nowIso();
  await run(
    env,
    `UPDATE finance_transactions SET transaction_date = ?, posted_date = ?, amount_cents = ?, classification = ?, category_id = ?,
       source_category = ?, description = ?, normalized_description = ?, fingerprint = ?, is_one_time = ?, is_capital = ?,
       is_internal_transfer = ?, matching_transfer_id = ?, is_restricted = ?, reconciliation_status = ?, notes = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [transactionDate, normalizeDate(body.postedDate) || null, amountCents, classification, body.categoryId || null,
      String(body.sourceCategory ?? beforeRow.source_category), description, normalizeDescription(description), fingerprint,
      body.isOneTime ? 1 : 0, body.isCapital ? 1 : 0, classification === "transfer" || body.isInternalTransfer ? 1 : 0,
      body.matchingTransferId || null, body.isRestricted ? 1 : 0,
      ['unreviewed', 'cleared', 'outstanding', 'void'].includes(body.reconciliationStatus) ? body.reconciliationStatus : beforeRow.reconciliation_status,
      String(body.notes ?? beforeRow.notes).slice(0, 1000), timestamp, transactionId],
  );
  await run(env, `UPDATE finance_reconciliations SET status = 'unreconciled', reconciled_by = NULL, reconciled_at = NULL, updated_at = ? WHERE statement_month = ? AND account_id = ?`, [timestamp, beforeRow.statement_month, beforeRow.account_id]);
  await run(env, `UPDATE finance_periods SET status = 'draft', published_by = NULL, published_at = NULL, updated_at = ? WHERE statement_month = ?`, [timestamp, beforeRow.statement_month]);
  await auditFinance(env, session, "transaction_updated", "transaction", transactionId, { before: beforeRow, after: body });
  return { id: transactionId, updatedAt: timestamp };
}

export async function getFinanceAdmin(env, fiscalYearId) {
  const [imports, funds, commitments, mappings, audit, documents, forecasts] = await Promise.all([
    all(env, `SELECT b.*, a.name AS account_name FROM finance_import_batches b JOIN finance_accounts a ON a.id = b.account_id ORDER BY b.created_at DESC LIMIT 500`),
    all(env, `SELECT * FROM finance_restricted_funds WHERE fiscal_year_id = ? OR fiscal_year_id IS NULL ORDER BY is_active DESC, name`, [fiscalYearId]),
    all(env, `SELECT * FROM finance_commitments WHERE fiscal_year_id = ? OR fiscal_year_id IS NULL ORDER BY status, due_date, created_at DESC`, [fiscalYearId]),
    all(env, `SELECT m.*, c.name AS category_name FROM finance_category_mappings m JOIN finance_categories c ON c.id = m.category_id ORDER BY m.priority DESC, m.id`),
    all(env, `SELECT * FROM finance_audit_events ORDER BY created_at DESC LIMIT 200`),
    all(env, `SELECT id, fiscal_year_id, statement_month, account_id, filename, content_type, size_bytes, sha256, uploaded_by, uploaded_at FROM finance_documents WHERE deleted_at IS NULL AND (fiscal_year_id = ? OR fiscal_year_id IS NULL) ORDER BY uploaded_at DESC`, [fiscalYearId]),
    all(env, `SELECT * FROM finance_forecasts WHERE fiscal_year_id = ? ORDER BY statement_month, classification`, [fiscalYearId]),
  ]);
  return {
    imports: imports.map((row) => ({ id: row.id, fiscalYearId: row.fiscal_year_id, statementMonth: row.statement_month, accountId: row.account_id, accountName: row.account_name, sourceFilename: row.source_filename, status: row.status, rowCount: Number(row.row_count), duplicateCount: Number(row.duplicate_count), importedCount: Number(row.imported_count), skippedCount: Number(row.skipped_count), createdBy: row.created_by, createdAt: row.created_at })),
    funds: funds.map((row) => ({ id: row.id, name: row.name, amountCents: Number(row.amount_cents), fiscalYearId: row.fiscal_year_id || "", notes: row.notes, isActive: bool(row.is_active) })),
    commitments: commitments.map((row) => ({ id: row.id, description: row.description, payee: row.payee, amountCents: Number(row.amount_cents), dueDate: row.due_date || "", accountId: row.account_id || "", fiscalYearId: row.fiscal_year_id || "", commitmentType: row.commitment_type, status: row.status, checkLastFour: row.check_last_four || "", notes: row.notes })),
    mappings: mappings.map((row) => ({ id: row.id, classification: row.classification, sourceCategory: row.source_category, descriptionContains: row.description_contains, categoryId: row.category_id, categoryName: row.category_name, priority: Number(row.priority) })),
    audit: audit.map((row) => ({ id: row.id, actor: row.actor, actorRole: row.actor_role, action: row.action, entityType: row.entity_type, entityId: row.entity_id, details: JSON.parse(row.details_json || "{}"), createdAt: row.created_at })),
    documents: documents.map((row) => ({ id: row.id, fiscalYearId: row.fiscal_year_id || "", statementMonth: row.statement_month || "", accountId: row.account_id || "", filename: row.filename, contentType: row.content_type, sizeBytes: Number(row.size_bytes), sha256: row.sha256, uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at })),
    forecasts: forecasts.map((row) => ({ id: row.id, fiscalYearId: row.fiscal_year_id, statementMonth: row.statement_month, classification: row.classification, categoryId: row.category_id || "", amountCents: Number(row.amount_cents), notes: row.notes })),
  };
}

const ADMIN_TABLES = {
  fund: {
    table: "finance_restricted_funds",
    fields: ["name", "amount_cents", "fiscal_year_id", "notes", "is_active"],
    values: (body) => [String(body.name || "").trim(), Number(body.amountCents), body.fiscalYearId || null, String(body.notes || "").slice(0, 1000), body.isActive === false ? 0 : 1],
  },
  commitment: {
    table: "finance_commitments",
    fields: ["description", "payee", "amount_cents", "due_date", "account_id", "fiscal_year_id", "commitment_type", "status", "check_last_four", "notes"],
    values: (body) => [String(body.description || "").trim(), String(body.payee || "").trim(), Number(body.amountCents), normalizeDate(body.dueDate) || null, body.accountId || null, body.fiscalYearId || null, body.commitmentType === "outstanding_check" ? "outstanding_check" : "commitment", ['outstanding', 'paid', 'cancelled'].includes(body.status) ? body.status : "outstanding", String(body.checkLastFour || "").replace(/\D/g, "").slice(-4) || null, String(body.notes || "").slice(0, 1000)],
  },
  mapping: {
    table: "finance_category_mappings",
    fields: ["classification", "source_category", "description_contains", "category_id", "priority"],
    values: (body) => [String(body.classification || ""), String(body.sourceCategory || "").trim(), String(body.descriptionContains || "").trim(), String(body.categoryId || ""), Number(body.priority || 0)],
  },
  forecast: {
    table: "finance_forecasts",
    fields: ["fiscal_year_id", "statement_month", "classification", "category_id", "amount_cents", "notes"],
    values: (body) => [String(body.fiscalYearId || ""), String(body.statementMonth || ""), String(body.classification || ""), body.categoryId || null, Number(body.amountCents), String(body.notes || "").slice(0, 1000)],
  },
};

export async function upsertFinanceAdminEntity(env, session, entityType, entityId, body) {
  const config = ADMIN_TABLES[entityType];
  if (!config) throw Object.assign(new Error("Unsupported finance entity."), { status: 404 });
  const values = config.values(body);
  if (values.some((value, index) => config.fields[index] === "amount_cents" && (!Number.isSafeInteger(value) || value < 0))) throw Object.assign(new Error("Amount must be a non-negative integer number of cents."), { status: 400 });
  if ((entityType === "fund" && !values[0]) || (entityType === "commitment" && !values[0])) throw Object.assign(new Error("A name or description is required."), { status: 400 });
  const timestamp = nowIso();
  const recordId = entityId || id(`finance_${entityType}`);
  if (entityId) {
    await run(env, `UPDATE ${config.table} SET ${config.fields.map((field) => `${field} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...values, timestamp, entityId]);
  } else {
    await run(env, `INSERT INTO ${config.table} (id, ${config.fields.join(", ")}, created_at, updated_at) VALUES (?, ${config.fields.map(() => "?").join(", ")}, ?, ?)`, [recordId, ...values, timestamp, timestamp]);
  }
  await auditFinance(env, session, entityId ? `${entityType}_updated` : `${entityType}_created`, entityType, recordId, body);
  return { id: recordId, updatedAt: timestamp };
}

export async function updateFinanceReserve(env, session, fiscalYearId, reserveCents) {
  if (!Number.isSafeInteger(reserveCents) || reserveCents < 0) throw Object.assign(new Error("Reserve must be a non-negative integer number of cents."), { status: 400 });
  const timestamp = nowIso();
  await run(env, `INSERT INTO finance_settings (fiscal_year_id, reserve_cents, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(fiscal_year_id) DO UPDATE SET reserve_cents = excluded.reserve_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at`, [fiscalYearId, reserveCents, session.actor, timestamp]);
  await auditFinance(env, session, "reserve_updated", "finance_settings", fiscalYearId, { reserveCents });
  return { fiscalYearId, reserveCents, updatedAt: timestamp };
}

export function transactionsToCsv(transactions) {
  const safeCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [["Transaction date", "Posted date", "Amount", "Classification", "Category", "Source category", "Description", "Account", "Reporting period", "Statement month", "One-time", "Capital", "Internal transfer", "Restricted", "Reconciliation", "Notes"]];
  transactions.forEach((transaction) => rows.push([
    transaction.transactionDate, transaction.postedDate, (transaction.amountCents / 100).toFixed(2), transaction.classification,
    transaction.categoryName, transaction.sourceCategory, transaction.description, transaction.accountName, fiscalYearForDate(transaction.transactionDate).label,
    transaction.statementMonth, transaction.isOneTime ? "yes" : "no", transaction.isCapital ? "yes" : "no",
    transaction.isInternalTransfer ? "yes" : "no", transaction.isRestricted ? "yes" : "no", transaction.reconciliationStatus,
    transaction.notes,
  ]));
  return rows.map((row) => row.map(safeCell).join(",")).join("\r\n");
}

export async function saveFinanceDocument(env, session, formData) {
  if (!env.FINANCE_DOCUMENTS) throw Object.assign(new Error("R2 binding FINANCE_DOCUMENTS is not configured."), { status: 503 });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw Object.assign(new Error("Choose a supporting document."), { status: 400 });
  if (file.size > 10 * 1024 * 1024) throw Object.assign(new Error("Supporting documents are limited to 10 MB."), { status: 413 });
  const allowed = new Set(["application/pdf", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
  if (!allowed.has(file.type)) throw Object.assign(new Error("Only PDF, CSV, and XLSX supporting documents are accepted."), { status: 400 });
  const bytes = await file.arrayBuffer();
  const hashBytes = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(hashBytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const documentId = id("finance_document");
  const r2Key = `finance/${new Date().getUTCFullYear()}/${crypto.randomUUID()}`;
  await env.FINANCE_DOCUMENTS.put(r2Key, bytes, { httpMetadata: { contentType: file.type }, customMetadata: { sha256 } });
  const timestamp = nowIso();
  await run(env, `INSERT INTO finance_documents (id, fiscal_year_id, statement_month, account_id, filename, content_type, size_bytes, r2_key, sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [documentId, formData.get("fiscalYearId") || null, formData.get("statementMonth") || null, formData.get("accountId") || null, file.name.split(/[\\/]/).at(-1).slice(0, 240), file.type, file.size, r2Key, sha256, session.actor, timestamp]);
  await auditFinance(env, session, "document_uploaded", "document", documentId, { filename: file.name, sizeBytes: file.size, sha256 });
  return { id: documentId, filename: file.name, sizeBytes: file.size, sha256, uploadedAt: timestamp };
}

export async function getFinanceDocument(env, documentId) {
  if (!env.FINANCE_DOCUMENTS) throw Object.assign(new Error("R2 binding FINANCE_DOCUMENTS is not configured."), { status: 503 });
  const metadata = await first(env, `SELECT * FROM finance_documents WHERE id = ? AND deleted_at IS NULL`, [documentId]);
  if (!metadata) throw Object.assign(new Error("Document not found."), { status: 404 });
  const object = await env.FINANCE_DOCUMENTS.get(metadata.r2_key);
  if (!object) throw Object.assign(new Error("Document object is missing."), { status: 404 });
  return { metadata, object };
}
