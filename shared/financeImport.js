import {
  fiscalYearForDate,
  normalizeDate,
  normalizeDescription,
  numberAmountToCents,
  parseAmountToCents,
  signedAmountFor,
} from "./financeCore.js";

function cellText(value) {
  return String(value ?? "").trim();
}

const IMPORT_MONTHS = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9], ["oct", 10],
  ["october", 10], ["nov", 11], ["november", 11], ["dec", 12], ["december", 12],
]);

export function inferImportMonth(filename) {
  const matches = new Set(String(filename || "").match(/20\d{2}-(?:0[1-9]|1[0-2])/g) || []);
  const monthPattern = /(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)[\s._-]+(20\d{2})/gi;
  for (const match of String(filename || "").matchAll(monthPattern)) {
    const month = IMPORT_MONTHS.get(match[1].toLowerCase());
    matches.add(`${match[2]}-${String(month).padStart(2, "0")}`);
  }
  if (matches.size !== 1) {
    throw new Error(`${filename}: use one monthly file whose name includes its month and year. Annual or multi-month files are not accepted.`);
  }
  return [...matches][0];
}

function inferFlags(classification, description, amountCents) {
  const normalized = normalizeDescription(description);
  const isTransfer = classification === "transfer" ||
    normalized.includes("transfer to one bank account") ||
    normalized.includes("transfer to operating account") ||
    normalized.includes("transfer from fundraising account") ||
    normalized.includes("fundraising account transfer");
  const isLandscapeProject = normalized.includes("landscap");
  return {
    classification: isTransfer ? "transfer" : classification,
    amountCents: signedAmountFor(isTransfer ? "transfer" : classification, amountCents),
    isInternalTransfer: isTransfer,
    isOneTime: isLandscapeProject,
    isCapital: isLandscapeProject,
    isRestricted: normalized.includes("player in need") || normalized.includes("restricted"),
  };
}

function parseCurrencyCell(value) {
  if (typeof value === "number") return numberAmountToCents(value);
  return parseAmountToCents(value);
}

function rowCandidate({ row, sourceRow, classification, dateIndex, amountIndex, descriptionIndex, categoryIndex, supplementalIndexes = [] }) {
  const hasContent = [dateIndex, amountIndex, descriptionIndex, ...supplementalIndexes].some((index) => cellText(row[index]));
  if (!hasContent) return null;
  const errors = [];
  const transactionDate = normalizeDate(row[dateIndex]);
  if (!transactionDate) errors.push("Invalid or missing transaction date.");
  let amountCents = 0;
  try {
    amountCents = parseCurrencyCell(row[amountIndex]);
  } catch (error) {
    errors.push(error.message);
  }
  const supplemental = supplementalIndexes.map((index) => cellText(row[index])).filter(Boolean);
  const description = cellText(row[descriptionIndex]) || supplemental.join(" | ");
  if (!description) errors.push("Description is required.");
  const sourceCategory = cellText(row[categoryIndex]);
  const flags = inferFlags(classification, [description, ...supplemental].join(" "), amountCents);
  return {
    sourceRow,
    transactionDate,
    postedDate: "",
    description,
    normalizedDescription: normalizeDescription(description),
    sourceCategory,
    supplementalNotes: supplemental.join(" | "),
    categoryId: "",
    reconciliationStatus: "cleared",
    notes: "",
    duplicateDecision: "",
    errors,
    ...flags,
  };
}

export function parseBgslWorkbook(sheets) {
  const transactionSheet = sheets.find((sheet) => String(sheet.sheet || sheet.name).trim().toLowerCase() === "transactions");
  if (!transactionSheet) throw new Error("The workbook does not contain a Transactions sheet.");
  const rows = transactionSheet.data || [];
  const transactions = [];
  rows.forEach((row, index) => {
    if (index < 4) return;
    const expense = rowCandidate({
      row,
      sourceRow: index + 1,
      classification: "expense",
      dateIndex: 1,
      amountIndex: 2,
      descriptionIndex: 3,
      categoryIndex: 4,
    });
    const income = rowCandidate({
      row,
      sourceRow: index + 1,
      classification: "income",
      dateIndex: 6,
      amountIndex: 7,
      descriptionIndex: 8,
      categoryIndex: 9,
      supplementalIndexes: [10, 11],
    });
    if (expense) transactions.push(expense);
    if (income) transactions.push(income);
  });
  return transactions;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

export function parseFinanceCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => normalizeDescription(value).replaceAll(" ", "_"));
  const find = (...names) => headers.findIndex((header) => names.includes(header));
  const indexes = {
    date: find("transaction_date", "date"),
    posted: find("posted_date"),
    amount: find("amount", "amount_cents"),
    classification: find("classification", "type"),
    description: find("description", "payee", "memo"),
    category: find("source_category", "category"),
  };
  if (indexes.date < 0 || indexes.amount < 0 || indexes.description < 0) {
    throw new Error("CSV requires date, amount, and description columns.");
  }
  return rows.slice(1).map((row, offset) => {
    const errors = [];
    const transactionDate = normalizeDate(row[indexes.date]);
    if (!transactionDate) errors.push("Invalid or missing transaction date.");
    let amountCents = 0;
    try {
      amountCents = indexes.amount >= 0 && headers[indexes.amount] === "amount_cents"
        ? Number(row[indexes.amount])
        : parseAmountToCents(row[indexes.amount]);
    } catch (error) {
      errors.push(error.message);
    }
    let classification = cellText(row[indexes.classification]).toLowerCase();
    if (!classification) classification = amountCents < 0 ? "expense" : "income";
    if (!['income', 'expense', 'transfer'].includes(classification)) errors.push("Classification must be income, expense, or transfer.");
    const description = cellText(row[indexes.description]);
    if (!description) errors.push("Description is required.");
    const flags = inferFlags(classification, description, amountCents);
    return {
      sourceRow: offset + 2,
      transactionDate,
      postedDate: indexes.posted >= 0 ? normalizeDate(row[indexes.posted]) : "",
      description,
      normalizedDescription: normalizeDescription(description),
      sourceCategory: indexes.category >= 0 ? cellText(row[indexes.category]) : "",
      supplementalNotes: "",
      categoryId: "",
      reconciliationStatus: "cleared",
      notes: "",
      duplicateDecision: "",
      errors,
      ...flags,
    };
  });
}

export function validateImportRows(rows, { statementMonth, fiscalYearId }) {
  return rows.map((row) => {
    const errors = [...(row.errors || [])];
    if (row.transactionDate && row.transactionDate.slice(0, 7) !== statementMonth) {
      errors.push(`Transaction date is outside ${statementMonth}.`);
    }
    if (row.transactionDate && fiscalYearForDate(row.transactionDate).id !== fiscalYearId) {
      errors.push("Transaction date is outside the selected fiscal year.");
    }
    return { ...row, errors: [...new Set(errors)] };
  });
}
