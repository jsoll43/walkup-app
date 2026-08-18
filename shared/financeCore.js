export const FINANCE_CLASSIFICATIONS = Object.freeze(["income", "expense", "transfer"]);

const FULL_MONTH_NAMES = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

export function assertIntegerCents(value, field = "amountCents") {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be a safe integer number of cents.`);
  }
  return value;
}

export function parseAmountToCents(value) {
  if (Number.isSafeInteger(value) && typeof value === "number") return value * 100;
  const clean = String(value ?? "")
    .trim()
    .replace(/[$,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(clean)) {
    throw new TypeError(`Invalid currency amount: ${value}`);
  }
  const negative = clean.startsWith("-");
  const unsigned = negative ? clean.slice(1) : clean;
  const [whole, fractional = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new TypeError("Currency amount is outside the supported range.");
  return negative ? -cents : cents;
}

export function numberAmountToCents(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return parseAmountToCents(value);
  const scaled = Math.round(value * 100);
  if (!Number.isSafeInteger(scaled) || Math.abs(value * 100 - scaled) > 0.000001) {
    throw new TypeError(`Currency amount has more than two decimal places: ${value}`);
  }
  return scaled;
}

export function fiscalYearForDate(value) {
  const date = normalizeDate(value);
  if (!date) throw new TypeError(`Invalid transaction date: ${value}`);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 10 ? year : year - 1;
  const startsOn = `${startYear}-10-01`;
  const endsOn = `${startYear + 1}-09-30`;
  return {
    id: `fy_${startYear}_${startYear + 1}`,
    label: fiscalYearRangeLabel(startsOn, endsOn),
    startsOn,
    endsOn,
  };
}

export function fiscalYearRangeLabel(startsOn, endsOn) {
  const start = normalizeDate(startsOn);
  const end = normalizeDate(endsOn);
  if (!start || !end) return "Reporting period unavailable";
  const monthYear = (date) => `${FULL_MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  return `${monthYear(start)} – ${monthYear(end)}`;
}

export function fiscalMonths(startYear) {
  return Array.from({ length: 12 }, (_, index) => {
    const monthIndex = 9 + index;
    const year = startYear + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

export function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  const clean = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean);
  const parts = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : null;
  if (!parts) return "";
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeDescription(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function fingerprintInput({ accountId, transactionDate, amountCents, description }) {
  assertIntegerCents(amountCents);
  const date = normalizeDate(transactionDate);
  if (!date) throw new TypeError("A valid transaction date is required for duplicate detection.");
  return [String(accountId || "").trim(), date, String(amountCents), normalizeDescription(description)].join("|");
}

export async function sha256Hex(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function transactionFingerprint(transaction) {
  return sha256Hex(fingerprintInput(transaction));
}

export function findDuplicateGroups(transactions) {
  const groups = new Map();
  transactions.forEach((transaction, index) => {
    const key = fingerprintInput(transaction);
    const current = groups.get(key) || [];
    current.push({ index, transaction });
    groups.set(key, current);
  });
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([fingerprint, entries]) => ({ fingerprint, entries }));
}

export function signedAmountFor(classification, amountCents) {
  assertIntegerCents(amountCents);
  if (classification === "income") return Math.abs(amountCents);
  if (classification === "expense") return -Math.abs(amountCents);
  if (classification === "transfer") return amountCents;
  throw new TypeError(`Unsupported classification: ${classification}`);
}

export function sumCents(values) {
  return values.reduce((total, value) => total + assertIntegerCents(value), 0);
}

export function summarizeTransactions(transactions) {
  const active = transactions.filter((transaction) => !transaction.deletedAt && transaction.reconciliationStatus !== "void");
  const externalIncomeCents = sumCents(
    active
      .filter((transaction) => transaction.classification === "income" && !transaction.isInternalTransfer)
      .map((transaction) => Math.abs(transaction.amountCents)),
  );
  const expenseRows = active.filter(
    (transaction) => transaction.classification === "expense" && !transaction.isInternalTransfer,
  );
  const expensesCents = sumCents(expenseRows.map((transaction) => Math.abs(transaction.amountCents)));
  const oneTimeExpensesCents = sumCents(
    expenseRows
      .filter((transaction) => transaction.isOneTime || transaction.isCapital)
      .map((transaction) => Math.abs(transaction.amountCents)),
  );
  return {
    transactionCount: active.length,
    externalIncomeCents,
    expensesCents,
    oneTimeExpensesCents,
    normalizedExpensesCents: expensesCents - oneTimeExpensesCents,
    surplusCents: externalIncomeCents - expensesCents,
    internalTransfersCents: sumCents(
      active
        .filter((transaction) => transaction.classification === "transfer" || transaction.isInternalTransfer)
        .map((transaction) => transaction.amountCents),
    ),
  };
}

export function calculateHistoricalBalances({ months, officialBalances, monthlyMovements }) {
  const officialByMonth = new Map(officialBalances.map((row) => [row.statementMonth, row]));
  const movementByMonth = new Map(monthlyMovements.map((row) => [row.statementMonth, assertIntegerCents(row.movementCents, "movementCents")]));
  const rows = months.map((statementMonth) => {
    const official = officialByMonth.get(statementMonth);
    return official ? {
      statementMonth,
      balanceCents: assertIntegerCents(official.balanceCents, "balanceCents"),
      status: official.status,
      source: official.source,
      movementCents: movementByMonth.get(statementMonth) ?? null,
      calculationDirection: "",
      rollforwardDifferenceCents: null,
    } : {
      statementMonth,
      balanceCents: null,
      status: "missing",
      source: "",
      movementCents: movementByMonth.get(statementMonth) ?? null,
      calculationDirection: "",
      rollforwardDifferenceCents: null,
    };
  });

  let priorEndingBalanceCents = null;
  rows.forEach((row) => {
    const movementKnown = Number.isSafeInteger(row.movementCents);
    if (row.status !== "missing") {
      row.rollforwardDifferenceCents = Number.isSafeInteger(priorEndingBalanceCents) && movementKnown
        ? row.balanceCents - (priorEndingBalanceCents + row.movementCents)
        : null;
      priorEndingBalanceCents = row.balanceCents;
    } else if (Number.isSafeInteger(priorEndingBalanceCents) && movementKnown) {
      row.balanceCents = assertIntegerCents(priorEndingBalanceCents + row.movementCents, "calculatedBalanceCents");
      row.status = "calculated";
      row.source = "transaction_rollforward";
      row.calculationDirection = "forward";
      priorEndingBalanceCents = row.balanceCents;
    } else {
      priorEndingBalanceCents = null;
    }
  });

  for (let index = rows.length - 1; index > 0; index -= 1) {
    const current = rows[index];
    const previous = rows[index - 1];
    if (previous.status !== "missing" || !Number.isSafeInteger(current.balanceCents) || !Number.isSafeInteger(current.movementCents)) continue;
    previous.balanceCents = assertIntegerCents(current.balanceCents - current.movementCents, "calculatedBalanceCents");
    previous.status = "calculated";
    previous.source = "transaction_backcast";
    previous.calculationDirection = "backward";
  }

  return rows;
}

export function calculateAvailableCash({
  bankBalancesCents,
  reconciledCashOnHandCents,
  restrictedFundsCents,
  outstandingObligationsCents,
  reserveCents,
}) {
  return (
    assertIntegerCents(bankBalancesCents, "bankBalancesCents") +
    assertIntegerCents(reconciledCashOnHandCents, "reconciledCashOnHandCents") -
    assertIntegerCents(restrictedFundsCents, "restrictedFundsCents") -
    assertIntegerCents(outstandingObligationsCents, "outstandingObligationsCents") -
    assertIntegerCents(reserveCents, "reserveCents")
  );
}

export function calculateReconciliation({
  openingBalanceCents,
  statementEndingBalanceCents,
  transactions,
  outstandingItemsCents = 0,
}) {
  assertIntegerCents(openingBalanceCents, "openingBalanceCents");
  assertIntegerCents(statementEndingBalanceCents, "statementEndingBalanceCents");
  assertIntegerCents(outstandingItemsCents, "outstandingItemsCents");

  const active = transactions.filter((transaction) => transaction.reconciliationStatus !== "void" && !transaction.deletedAt);
  const cleared = active.filter((transaction) => transaction.reconciliationStatus === "cleared");
  const depositsCents = sumCents(
    cleared.filter((transaction) => transaction.classification === "income").map((transaction) => Math.abs(transaction.amountCents)),
  );
  const withdrawalsCents = sumCents(
    cleared.filter((transaction) => transaction.classification === "expense").map((transaction) => Math.abs(transaction.amountCents)),
  );
  const transfersCents = sumCents(
    cleared.filter((transaction) => transaction.classification === "transfer").map((transaction) => transaction.amountCents),
  );
  const expectedEndingBalanceCents = openingBalanceCents + depositsCents - withdrawalsCents + transfersCents;
  const differenceCents = statementEndingBalanceCents - expectedEndingBalanceCents;
  const unresolvedCount = active.filter((transaction) => transaction.reconciliationStatus === "unreviewed").length;

  return {
    openingBalanceCents,
    depositsCents,
    withdrawalsCents,
    transfersCents,
    outstandingItemsCents,
    expectedEndingBalanceCents,
    statementEndingBalanceCents,
    differenceCents,
    unresolvedCount,
    canReconcile: differenceCents === 0 && unresolvedCount === 0,
    status: differenceCents === 0 && unresolvedCount === 0 ? "reconciled" : "unreconciled",
  };
}

export function compareSamePeriod(currentTransactions, priorTransactions, completedMonths) {
  const months = new Set(completedMonths);
  const current = summarizeTransactions(
    currentTransactions.filter((transaction) => months.has(transaction.statementMonth?.slice(5, 7))),
  );
  const prior = summarizeTransactions(
    priorTransactions.filter((transaction) => months.has(transaction.statementMonth?.slice(5, 7))),
  );
  return {
    current,
    prior,
    incomeChangeCents: current.externalIncomeCents - prior.externalIncomeCents,
    expenseChangeCents: current.expensesCents - prior.expensesCents,
    surplusChangeCents: current.surplusCents - prior.surplusCents,
  };
}

export function labelProjection(valueCents, isProjected) {
  assertIntegerCents(valueCents);
  return { valueCents, isProjected: Boolean(isProjected), label: isProjected ? "Projected" : "Actual" };
}

export function projectFiscalYear({ currentBalanceCents, actualMonths, monthlyForecasts }) {
  const forecastByMonth = new Map(monthlyForecasts.map((forecast) => [forecast.statementMonth, forecast]));
  const remainingNetCents = [...forecastByMonth.entries()]
    .filter(([month]) => !actualMonths.includes(month))
    .reduce((sum, [, forecast]) => sum + assertIntegerCents(forecast.netCents), 0);
  return labelProjection(currentBalanceCents + remainingNetCents, remainingNetCents !== 0);
}

export function buildValidationDiscrepancies(actualByControl, controls) {
  return controls.map((control) => {
    const actualCents = actualByControl[control.id];
    return {
      ...control,
      actualCents: Number.isSafeInteger(actualCents) ? actualCents : null,
      differenceCents: Number.isSafeInteger(actualCents) ? actualCents - control.expectedCents : null,
      status: Number.isSafeInteger(actualCents)
        ? actualCents === control.expectedCents
          ? "matched"
          : "mismatch"
        : "missing",
    };
  });
}

function percentChange(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 1000) / previous) / 10;
}

export function deterministicInsights({ comparison, categoryChanges = [], notableCapitalExpenses = [], reconciliations = [], missingMonths = [], duplicateCount = 0, projection = null, dataIssues = [] }) {
  const insights = [];
  if (comparison) {
    if (comparison.prior.transactionCount === 0) {
      insights.push({
        type: "comparison_missing",
        tone: "warning",
        text: "Prior-year same-period transactions are not available, so year-over-year changes are withheld.",
      });
    } else {
    const incomePercent = percentChange(comparison.current.externalIncomeCents, comparison.prior.externalIncomeCents);
    const expensePercent = percentChange(comparison.current.expensesCents, comparison.prior.expensesCents);
    insights.push({
      type: "income_change",
      tone: comparison.incomeChangeCents >= 0 ? "positive" : "warning",
      text: `Income is ${comparison.incomeChangeCents >= 0 ? "up" : "down"}${incomePercent === null ? "" : ` ${Math.abs(incomePercent)}%`} versus the same completed months last year.`,
      amountCents: Math.abs(comparison.incomeChangeCents),
    });
    insights.push({
      type: "expense_change",
      tone: comparison.expenseChangeCents <= 0 ? "positive" : "warning",
      text: `Expenses are ${comparison.expenseChangeCents >= 0 ? "up" : "down"}${expensePercent === null ? "" : ` ${Math.abs(expensePercent)}%`} versus the same completed months last year.`,
      amountCents: Math.abs(comparison.expenseChangeCents),
    });
    }
  }
  categoryChanges.slice(0, 3).forEach((change) => insights.push({
    type: "category_change",
    tone: change.changeCents > 0 ? "warning" : "neutral",
    text: `${change.name} changed by ${change.changeCents >= 0 ? "an increase" : "a decrease"}.`,
    amountCents: Math.abs(change.changeCents),
  }));
  notableCapitalExpenses.slice(0, 3).forEach((transaction) => insights.push({
    type: "capital_expense_difference",
    tone: "neutral",
    text: `A major year-over-year difference is ${transaction.comparisonPeriod === "prior" ? "last year's" : "this year's"} capital project: ${transaction.description}.`,
    amountCents: Math.abs(transaction.amountCents),
  }));
  const unreconciled = reconciliations.filter((item) => item.status !== "reconciled");
  if (unreconciled.length) insights.push({ type: "unreconciled", tone: "danger", text: `${unreconciled.length} month/account reconciliation${unreconciled.length === 1 ? " is" : "s are"} incomplete.` });
  if (missingMonths.length) insights.push({ type: "missing_months", tone: "warning", text: `Missing statements: ${missingMonths.join(", ")}.` });
  if (duplicateCount) insights.push({ type: "duplicates", tone: "warning", text: `${duplicateCount} possible duplicate transaction${duplicateCount === 1 ? " requires" : "s require"} review.` });
  if (projection) insights.push({ type: "projection", tone: "neutral", text: projection.isProjected ? "Projected fiscal-year ending balance." : "No future forecast is loaded; this is the current reconciled balance.", amountCents: projection.valueCents, isProjected: projection.isProjected });
  dataIssues.filter((issue) => issue.status === "open").forEach((issue) => insights.push({ type: issue.issueType, tone: issue.severity === "error" ? "danger" : "warning", text: issue.description, amountCents: issue.amountCents }));
  return insights;
}

// Interface boundary for an optional future summary provider. V1 remains deterministic.
export class DeterministicFinanceInsightProvider {
  summarize(input) {
    return deterministicInsights(input);
  }
}
