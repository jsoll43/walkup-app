import { useEffect, useMemo, useState } from "react";
import readExcelFile from "read-excel-file/browser";
import { calculateReconciliation, parseAmountToCents, sha256Hex } from "../../shared/financeCore.js";
import { parseBgslWorkbook, parseFinanceCsv, validateImportRows } from "../../shared/financeImport.js";

const TABS = [
  ["overview", "Overview"],
  ["cash-flow", "Cash flow"],
  ["spending", "Spending"],
  ["income", "Income"],
  ["comparison", "Year over year"],
  ["reconciliation", "Reconciliation"],
  ["transactions", "Transactions"],
];

const EMPTY_ADMIN = { imports: [], funds: [], commitments: [], mappings: [], audit: [], documents: [], forecasts: [] };

function money(cents) {
  if (!Number.isSafeInteger(Number(cents))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}

function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ""))) return value || "Not available";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function centsInput(value) {
  return Number.isSafeInteger(Number(value)) ? (Number(value) / 100).toFixed(2) : "";
}

function parseCentsInput(value) {
  return parseAmountToCents(String(value || "0"));
}

async function api(path, options = {}) {
  const { raw, ...fetchOptions } = options;
  const response = await fetch(`/api/board/finance/${path}`, { credentials: "same-origin", ...fetchOptions });
  if (raw) return response;
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text || response.statusText }; }
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.error || "Finance request failed.");
    error.status = response.status;
    error.details = data?.details;
    throw error;
  }
  return data;
}

function JsonRequest(method, body) {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function FinanceLogin({ onLogin }) {
  const [role, setRole] = useState("viewer");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("session/login", JsonRequest("POST", { role, password }));
      setPassword("");
      await onLogin();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page finance-login-page">
      <form className="card finance-login-card" onSubmit={submit}>
        <div className="finance-eyebrow">Board Member Area</div>
        <h1>BGSL Finance</h1>
        <p>Financial records are restricted to Board members and authorized finance editors.</p>
        <div className="finance-role-switch" aria-label="Finance role">
          <button type="button" className={role === "viewer" ? "is-active" : ""} onClick={() => setRole("viewer")}>Board viewer</button>
          <button type="button" className={role === "editor" ? "is-active" : ""} onClick={() => setRole("editor")}>Finance editor</button>
        </div>
        <label className="label" htmlFor="finance-password">{role === "viewer" ? "Board password" : "Finance editor / admin key"}</label>
        <input id="finance-password" className="input" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <label className="finance-check"><input type="checkbox" checked={show} onChange={() => setShow((value) => !value)} /> Show password</label>
        {error ? <div className="finance-alert is-danger" role="alert">{error}</div> : null}
        <button className="btn" disabled={loading || !password.trim()}>{loading ? "Signing in…" : "Sign in"}</button>
        <p className="finance-security-note">Your credential is exchanged for a short-lived, HttpOnly session and is not stored in the browser.</p>
      </form>
    </div>
  );
}

function LoadingCard({ text = "Loading finance data…" }) {
  return <div className="card finance-state-card" aria-live="polite">{text}</div>;
}

function EmptyState({ children }) {
  return <div className="finance-empty">{children}</div>;
}

function Metric({ label, value, note, tone = "" }) {
  return (
    <div className={`finance-metric ${tone ? `is-${tone}` : ""}`}>
      <div className="finance-metric-label">{label}</div>
      <div className="finance-metric-value">{value}</div>
      {note ? <div className="finance-metric-note">{note}</div> : null}
    </div>
  );
}

function MoneyMetric({ label, cents, note, tone }) {
  return <Metric label={label} value={money(cents)} note={note} tone={tone} />;
}

function MonthlyChart({ rows }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.incomeCents, row.expensesCents, row.hasForecast ? row.forecastIncomeCents : 0, row.hasForecast ? row.forecastExpensesCents : 0]));
  const chartHeight = 180;
  const baseline = 205;
  const groupWidth = 58;
  const width = Math.max(720, rows.length * groupWidth + 40);
  return (
    <div className="finance-chart" role="img" aria-label="Monthly income and expense chart">
      <svg viewBox={`0 0 ${width} 245`} preserveAspectRatio="xMidYMid meet">
        <line x1="22" y1={baseline} x2={width - 10} y2={baseline} className="finance-chart-axis" />
        {rows.map((row, index) => {
          const x = 30 + index * groupWidth;
          const incomeHeight = Math.round((row.incomeCents / max) * chartHeight);
          const expenseHeight = Math.round((row.expensesCents / max) * chartHeight);
          return (
            <g key={row.month}>
              <rect x={x} y={baseline - incomeHeight} width="17" height={incomeHeight} rx="4" className="finance-chart-income"><title>{`${monthLabel(row.month)} income ${money(row.incomeCents)}`}</title></rect>
              <rect x={x + 20} y={baseline - expenseHeight} width="17" height={expenseHeight} rx="4" className="finance-chart-expense"><title>{`${monthLabel(row.month)} expenses ${money(row.expensesCents)}`}</title></rect>
              <text x={x + 18} y="226" textAnchor="middle">{monthLabel(row.month).split(" ")[0]}</text>
            </g>
          );
        })}
      </svg>
      <div className="finance-chart-legend"><span className="is-income" /> Income <span className="is-expense" /> Expenses</div>
    </div>
  );
}

function CategoryBars({ rows, emptyText }) {
  const max = Math.max(1, ...rows.map((row) => row.amountCents));
  if (!rows.length) return <EmptyState>{emptyText}</EmptyState>;
  return <div className="finance-bars">{rows.map((row) => (
    <div className="finance-bar-row" key={row.name}>
      <div className="finance-bar-label"><span>{row.name}</span><strong>{money(row.amountCents)}</strong></div>
      <div className="finance-bar-track"><div style={{ width: `${Math.max(2, (row.amountCents / max) * 100)}%` }} /></div>
    </div>
  ))}</div>;
}

function Overview({ dashboard }) {
  const { overview } = dashboard;
  return (
    <div className="finance-section-stack">
      {overview.hasUnreconciled ? <div className="finance-alert is-warning"><strong>Preliminary figures.</strong> At least one expected month is missing or unreconciled. Only reconciled balances are used for cash metrics.</div> : null}
      <section>
        <div className="finance-section-heading"><div><div className="finance-eyebrow">Liquidity</div><h2>Cash position</h2></div><span className="finance-status-pill is-good">Reconciled balances</span></div>
        <div className="finance-metric-grid">
          <MoneyMetric label="Bank balances" cents={overview.bankBalancesCents} note="Latest reconciled balance per bank account" />
          <MoneyMetric label="Cash on hand" cents={overview.reconciledCashOnHandCents} note="Reconciled cash only" />
          <MoneyMetric label="Restricted funds" cents={overview.restrictedFundsCents} tone="muted" />
          <MoneyMetric label="Outstanding obligations" cents={overview.outstandingObligationsCents} tone="muted" />
          <MoneyMetric label="Board-selected reserve" cents={overview.reserveCents} tone="muted" />
          <MoneyMetric label="Available cash" cents={overview.availableCashCents} tone={overview.availableCashCents < 0 ? "danger" : "gold"} note="Balance + cash − restrictions − obligations − reserve" />
        </div>
      </section>
      <section>
        <div className="finance-section-heading"><div><div className="finance-eyebrow">Fiscal year performance</div><h2>{dashboard.fiscalYear.label} year to date</h2></div></div>
        <div className="finance-metric-grid is-four">
          <MoneyMetric label="External income" cents={overview.ytdIncomeCents} />
          <MoneyMetric label="Expenses" cents={overview.ytdExpensesCents} />
          <MoneyMetric label="Surplus / deficit" cents={overview.ytdSurplusCents} tone={overview.ytdSurplusCents < 0 ? "danger" : "positive"} />
          <MoneyMetric label={overview.projectedEndingBalance.isProjected ? "Projected year end" : "Current reconciled balance"} cents={overview.projectedEndingBalance.valueCents} note={overview.projectedEndingBalance.isProjected ? "Includes disclosed forecasts" : "No future forecast loaded"} />
        </div>
      </section>
      <div className="finance-two-column">
        <section className="card finance-panel"><h2>Financial insights</h2>{dashboard.insights.length ? <div className="finance-insights">{dashboard.insights.map((insight, index) => <div className={`finance-insight is-${insight.tone || "neutral"}`} key={`${insight.type}-${index}`}><span>{insight.text}</span>{Number.isSafeInteger(insight.amountCents) ? <strong>{money(insight.amountCents)}</strong> : null}</div>)}</div> : <EmptyState>Insights appear after transactions are published.</EmptyState>}</section>
        <section className="card finance-panel"><h2>Close status</h2><dl className="finance-definition-list"><div><dt>Latest reconciled month</dt><dd>{monthLabel(overview.latestReconciledMonth)}</dd></div><div><dt>Reporting basis</dt><dd>October 1–September 30</dd></div><div><dt>Internal transfers</dt><dd>Excluded from league-wide results</dd></div></dl></section>
      </div>
      <section className="card finance-panel">
        <div className="finance-section-heading"><div><div className="finance-eyebrow">Validation controls</div><h2>Source discrepancy report</h2></div></div>
        {dashboard.discrepancies.length ? <div className="finance-discrepancies">{dashboard.discrepancies.map((item) => <details className={`finance-discrepancy is-${item.status}`} key={item.id}><summary><span>{item.statementMonth ? monthLabel(item.statementMonth) : dashboard.fiscalYear.label} · {item.metric.replaceAll("_", " ")}</span><strong>{item.status === "matched" ? "Matched" : item.status === "missing" ? "Missing" : `${money(item.differenceCents)} difference`}</strong></summary><div className="finance-discrepancy-body"><dl><div><dt>Expected control</dt><dd>{money(item.expectedCents)}</dd></div><div><dt>Imported actual</dt><dd>{money(item.actualCents)}</dd></div><div><dt>Difference</dt><dd>{money(item.differenceCents)}</dd></div></dl>{item.sourceRows?.length ? <div><strong>Contributing source rows</strong><div className="finance-source-row-list">{item.sourceRows.map((row, index) => <span key={`${row.transactionId}-${index}`}>{row.statementMonth} · {row.sourceFilename || "Manual"}{row.sourceRow ? ` row ${row.sourceRow}` : ""} · {money(row.amountCents)}</span>)}</div></div> : null}</div></details>)}</div> : <EmptyState>Validation controls appear after the migration is applied.</EmptyState>}
      </section>
    </div>
  );
}

function CashFlow({ dashboard }) {
  return <div className="finance-section-stack"><section className="card finance-panel"><div className="finance-section-heading"><div><div className="finance-eyebrow">Actuals</div><h2>Monthly cash flow</h2></div></div><MonthlyChart rows={dashboard.monthly} /></section><div className="finance-month-cards">{dashboard.monthly.map((row) => <div className="card finance-month-card" key={row.month}><h3>{monthLabel(row.month)}</h3><dl><div><dt>Income</dt><dd>{money(row.incomeCents)}</dd></div><div><dt>Expenses</dt><dd>{money(row.expensesCents)}</dd></div><div><dt>Net</dt><dd className={row.netCents < 0 ? "is-negative" : "is-positive"}>{money(row.netCents)}</dd></div><div><dt>Running net</dt><dd>{money(row.runningNetCents)}</dd></div>{row.hasForecast ? <div><dt>Forecast net</dt><dd>{money(row.forecastNetCents)} <small>Projected</small></dd></div> : null}</dl></div>)}</div></div>;
}

function Spending({ dashboard, onTransactions }) {
  return <div className="finance-two-column finance-align-start"><section className="card finance-panel"><h2>Spending by category</h2><CategoryBars rows={dashboard.spending.byCategory} emptyText="No published expense transactions." /><button className="btn-secondary finance-panel-action" onClick={onTransactions}>Drill into transactions</button></section><div className="finance-section-stack"><section className="card finance-panel"><h2>Routine vs. one-time</h2><div className="finance-metric-grid is-two"><MoneyMetric label="Routine / normalized" cents={dashboard.spending.routineCents} /><MoneyMetric label="One-time / capital" cents={dashboard.spending.oneTimeCents} /></div></section><section className="card finance-panel"><h2>Top payees</h2>{dashboard.spending.topVendors.length ? <div className="finance-ranked-list">{dashboard.spending.topVendors.map((vendor) => <div key={vendor.name}><span>{vendor.name}</span><strong>{money(vendor.amountCents)}</strong></div>)}</div> : <EmptyState>Payee detail appears after expenses are published.</EmptyState>}</section></div></div>;
}

function Income({ dashboard }) {
  return <section className="card finance-panel"><div className="finance-section-heading"><div><div className="finance-eyebrow">External income only</div><h2>Income sources</h2></div><span className="finance-status-pill">Transfers excluded</span></div><CategoryBars rows={dashboard.income.byCategory} emptyText="No published income transactions." /></section>;
}

function Comparison({ dashboard }) {
  const comparison = dashboard.yearOverYear;
  return <div className="finance-section-stack"><div className={`finance-alert ${comparison.prior.transactionCount ? "is-info" : "is-warning"}`}>{comparison.prior.transactionCount ? "Current YTD is compared with the same completed fiscal months in the prior year. Projected values are not mixed into actual results." : "Prior-year same-period transactions are not available. Changes remain withheld until both periods are loaded and published."}</div><div className="finance-metric-grid is-three"><MoneyMetric label="Current-period income" cents={comparison.current.externalIncomeCents} /><MoneyMetric label="Prior same-period income" cents={comparison.prior.externalIncomeCents} /><MoneyMetric label="Income change" cents={comparison.incomeChangeCents} tone={comparison.incomeChangeCents < 0 ? "danger" : "positive"} /><MoneyMetric label="Current-period expenses" cents={comparison.current.expensesCents} /><MoneyMetric label="Prior same-period expenses" cents={comparison.prior.expensesCents} /><MoneyMetric label="Expense change" cents={comparison.expenseChangeCents} tone={comparison.expenseChangeCents > 0 ? "danger" : "positive"} /></div><section className="card finance-panel"><h2>Largest category changes</h2>{comparison.prior.transactionCount && comparison.categoryChanges.length ? <div className="finance-ranked-list">{comparison.categoryChanges.slice(0, 10).map((row) => <div key={row.name}><span>{row.name}<small>{money(row.priorCents)} → {money(row.currentCents)}</small></span><strong className={row.changeCents > 0 ? "is-negative" : "is-positive"}>{row.changeCents > 0 ? "+" : ""}{money(row.changeCents)}</strong></div>)}</div> : <EmptyState>Two published fiscal years are needed for comparison.</EmptyState>}</section></div>;
}

function ReconciliationEditor({ item, documents, onSave, busy }) {
  const [opening, setOpening] = useState(centsInput(item.openingBalanceCents));
  const [ending, setEnding] = useState(centsInput(item.statementEndingBalanceCents));
  const [outstanding, setOutstanding] = useState(centsInput(item.outstandingItemsCents));
  const [documentId, setDocumentId] = useState(item.documentId || "");
  const [notes, setNotes] = useState(item.notes || "");
  async function save(status) {
    await onSave(item.statementMonth, { accountId: item.accountId, openingBalanceCents: parseCentsInput(opening), statementEndingBalanceCents: parseCentsInput(ending), outstandingItemsCents: parseCentsInput(outstanding), documentId, notes, status });
  }
  return <details className="finance-recon-editor"><summary>Edit reconciliation</summary><div className="finance-form-grid"><label><span>Opening balance</span><input className="input" inputMode="decimal" value={opening} onChange={(event) => setOpening(event.target.value)} /></label><label><span>Statement ending</span><input className="input" inputMode="decimal" value={ending} onChange={(event) => setEnding(event.target.value)} /></label><label><span>Outstanding items</span><input className="input" inputMode="decimal" value={outstanding} onChange={(event) => setOutstanding(event.target.value)} /></label><label><span>Supporting document</span><select className="input" value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">None</option>{documents.filter((doc) => !doc.statementMonth || doc.statementMonth === item.statementMonth).map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}</select></label><label className="is-wide"><span>Notes</span><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div><div className="finance-button-row"><button className="btn-secondary" disabled={busy} onClick={() => save("unreconciled")}>Save draft</button><button className="btn" disabled={busy} onClick={() => save("reconciled")}>Mark reconciled</button></div></details>;
}

function Reconciliation({ dashboard, isEditor, documents, onSave, onPublish, busy }) {
  if (!dashboard.reconciliations.length) return <EmptyState>No statement reconciliations have been imported for this fiscal year.</EmptyState>;
  const byMonth = [...new Set(dashboard.reconciliations.map((item) => item.statementMonth))];
  return <div className="finance-section-stack">{byMonth.map((month) => { const items = dashboard.reconciliations.filter((item) => item.statementMonth === month); const canPublish = items.every((item) => item.status === "reconciled" && item.differenceCents === 0); const isPublished = items.every((item) => item.periodStatus === "published"); return <section className="card finance-panel" key={month}><div className="finance-section-heading"><div><div className="finance-eyebrow">{items[0].periodStatus}</div><h2>{monthLabel(month)}</h2></div><div className="finance-button-row"><span className={`finance-status-pill ${canPublish ? "is-good" : "is-warning"}`}>{canPublish ? "Reconciled" : "Unreconciled"}</span>{isEditor ? <button className="btn-secondary btn-sm" disabled={busy || (!isPublished && !canPublish)} onClick={() => onPublish(month, !isPublished)}>{isPublished ? "Unpublish" : "Publish"}</button> : null}</div></div><div className="finance-recon-grid">{items.map((item) => <article className="finance-recon-card" key={item.id}><h3>{item.accountName}</h3><dl><div><dt>Opening</dt><dd>{money(item.openingBalanceCents)}</dd></div><div><dt>Deposits</dt><dd>{money(item.depositsCents)}</dd></div><div><dt>Withdrawals</dt><dd>{money(item.withdrawalsCents)}</dd></div><div><dt>Transfers</dt><dd>{money(item.transfersCents)}</dd></div><div><dt>Outstanding</dt><dd>{money(item.outstandingItemsCents)}</dd></div><div><dt>Expected ending</dt><dd>{money(item.expectedEndingBalanceCents)}</dd></div><div><dt>Statement ending</dt><dd>{money(item.statementEndingBalanceCents)}</dd></div><div className="is-total"><dt>Difference</dt><dd className={item.differenceCents === 0 ? "is-positive" : "is-negative"}>{money(item.differenceCents)}</dd></div></dl>{item.status !== "reconciled" ? <div className="finance-alert is-warning">Preliminary — this account is not reconciled.</div> : null}{item.documentId ? <a className="btn-secondary btn-sm" href={`/api/board/finance/documents/${item.documentId}`} target="_blank" rel="noreferrer">View support</a> : null}{isEditor ? <ReconciliationEditor item={item} documents={documents} onSave={onSave} busy={busy} /> : null}</article>)}</div></section>; })}</div>;
}

function TransactionEditor({ transaction, categories, onSave, onClose, busy }) {
  const [form, setForm] = useState({ ...transaction, amount: centsInput(transaction.amountCents) });
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const matchingCategories = categories.filter((category) => category.classification === form.classification);
  return <div className="finance-modal" role="dialog" aria-modal="true" aria-label="Edit transaction"><div className="card finance-modal-card"><div className="finance-section-heading"><h2>Edit transaction</h2><button className="btn-secondary btn-sm" onClick={onClose}>Close</button></div><div className="finance-form-grid"><label><span>Date</span><input className="input" type="date" value={form.transactionDate} onChange={(event) => set("transactionDate", event.target.value)} /></label><label><span>Amount</span><input className="input" inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} /></label><label><span>Classification</span><select className="input" value={form.classification} onChange={(event) => { set("classification", event.target.value); set("categoryId", ""); }}><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select></label><label><span>Category</span><select className="input" value={form.categoryId} onChange={(event) => set("categoryId", event.target.value)}><option value="">Uncategorized</option>{matchingCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="is-wide"><span>Description / payee</span><input className="input" value={form.description} onChange={(event) => set("description", event.target.value)} /></label><label><span>Reconciliation</span><select className="input" value={form.reconciliationStatus} onChange={(event) => set("reconciliationStatus", event.target.value)}><option value="unreviewed">Unreviewed</option><option value="cleared">Cleared</option><option value="outstanding">Outstanding</option><option value="void">Void</option></select></label><label className="is-wide"><span>Notes</span><input className="input" value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label></div><div className="finance-check-grid"><label><input type="checkbox" checked={form.isOneTime} onChange={(event) => set("isOneTime", event.target.checked)} /> One-time</label><label><input type="checkbox" checked={form.isCapital} onChange={(event) => set("isCapital", event.target.checked)} /> Capital</label><label><input type="checkbox" checked={form.isInternalTransfer} onChange={(event) => set("isInternalTransfer", event.target.checked)} /> Internal transfer</label><label><input type="checkbox" checked={form.isRestricted} onChange={(event) => set("isRestricted", event.target.checked)} /> Restricted</label></div><button className="btn" disabled={busy} onClick={() => onSave(transaction.id, { ...form, amountCents: parseCentsInput(form.amount) })}>{busy ? "Saving…" : "Save transaction"}</button></div></div>;
}

function Transactions({ rows, filters, setFilters, bootstrap, isEditor, onEdit, onExport, loading }) {
  return <div className="finance-section-stack"><section className="card finance-panel"><div className="finance-section-heading"><div><h2>Transactions</h2><p>Internal transfers remain visible but are excluded from income and expense totals.</p></div><button className="btn-secondary" onClick={onExport}>Export filtered CSV</button></div><div className="finance-filter-grid"><input className="input" type="search" placeholder="Search description or notes" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /><input className="input" type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} /><select className="input" value={filters.account} onChange={(event) => setFilters((current) => ({ ...current, account: event.target.value }))}><option value="">All accounts</option>{bootstrap.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><select className="input" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">All categories</option>{bootstrap.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select className="input" value={filters.classification} onChange={(event) => setFilters((current) => ({ ...current, classification: event.target.value }))}><option value="">All types</option><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select><select className="input" value={filters.oneTime} onChange={(event) => setFilters((current) => ({ ...current, oneTime: event.target.value }))}><option value="">Routine and one-time</option><option value="true">One-time only</option><option value="false">Routine only</option></select></div></section>{loading ? <LoadingCard text="Loading transactions…" /> : rows.length ? <div className="finance-transaction-list">{rows.map((transaction) => <article className="card finance-transaction-card" key={transaction.id}><div className="finance-transaction-top"><div><div className="finance-transaction-date">{transaction.transactionDate}</div><h3>{transaction.description}</h3></div><strong className={transaction.amountCents < 0 ? "is-negative" : "is-positive"}>{money(transaction.amountCents)}</strong></div><div className="finance-chip-row"><span>{transaction.classification}</span><span>{transaction.categoryName}</span><span>{transaction.accountName}</span>{transaction.isInternalTransfer ? <span>Internal transfer</span> : null}{transaction.isOneTime || transaction.isCapital ? <span>One-time / capital</span> : null}<span>{transaction.reconciliationStatus}</span></div><div className="finance-transaction-meta">Source: {transaction.sourceFilename || "Manual"}{transaction.sourceRow ? `, row ${transaction.sourceRow}` : ""} · {transaction.statementMonth} · {transaction.periodStatus}</div>{isEditor ? <button className="btn-secondary btn-sm" onClick={() => onEdit(transaction)}>Edit</button> : null}</article>)}</div> : <EmptyState>No transactions match these filters.</EmptyState>}</div>;
}

function ImportWorkflow({ bootstrap, fiscalYearId, onComplete, busy, setBusy }) {
  const [file, setFile] = useState(null);
  const [accountId, setAccountId] = useState(bootstrap.accounts[0]?.id || "");
  const [statementMonth, setStatementMonth] = useState("");
  const [opening, setOpening] = useState("");
  const [ending, setEnding] = useState("");
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");

  async function previewFile() {
    if (!file || !accountId || !statementMonth) throw new Error("Choose a file, account, and statement month.");
    setBusy(true); setMessage("");
    try {
      let rows;
      if (file.name.toLowerCase().endsWith(".csv")) rows = parseFinanceCsv(await file.text());
      else if (file.name.toLowerCase().endsWith(".xlsx")) rows = parseBgslWorkbook(await readExcelFile(file));
      else throw new Error("Choose a CSV or XLSX file.");
      rows = validateImportRows(rows, { statementMonth, fiscalYearId });
      const sourceSha256 = await sha256Hex(await file.arrayBuffer());
      const data = await api("imports/preview", JsonRequest("POST", { fiscalYearId, statementMonth, accountId, sourceFilename: file.name, sourceSha256, openingBalanceCents: parseCentsInput(opening), statementEndingBalanceCents: parseCentsInput(ending), rows }));
      setPreview(data.preview); setConfirmed(false);
    } finally { setBusy(false); }
  }

  function updateRow(index, patch) {
    setPreview((current) => ({ ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row) }));
  }

  async function confirmImport() {
    setBusy(true); setMessage("");
    try {
      const data = await api(`imports/${preview.batchId}/confirm`, JsonRequest("POST", { confirm: confirmed, rows: preview.rows }));
      setMessage(`Imported ${data.result.importedCount} rows; ${data.result.skippedCount} skipped. The month remains unreconciled until explicitly closed.`);
      setPreview(null); setFile(null); setConfirmed(false); await onComplete();
    } finally { setBusy(false); }
  }

  const categoryOptions = (classification) => bootstrap.categories.filter((category) => category.classification === classification);
  const liveReconciliation = preview ? calculateReconciliation({
    openingBalanceCents: preview.openingBalanceCents,
    statementEndingBalanceCents: preview.statementEndingBalanceCents,
    transactions: preview.rows,
    outstandingItemsCents: 0,
  }) : null;
  return <section className="card finance-panel"><div className="finance-section-heading"><div><div className="finance-eyebrow">Editor only</div><h2>Import monthly transactions</h2></div></div><div className="finance-alert is-info">The workbook Summary sheet is ignored. Transaction rows are parsed in your browser, validated by the server, and are not saved until confirmation.</div><div className="finance-form-grid"><label><span>Fiscal year</span><select className="input" value={fiscalYearId} disabled>{bootstrap.fiscalYears.map((fy) => <option key={fy.id} value={fy.id}>{fy.label}</option>)}</select></label><label><span>Statement month</span><input className="input" type="month" value={statementMonth} onChange={(event) => setStatementMonth(event.target.value)} /></label><label><span>Account</span><select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{bootstrap.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label><span>Source CSV/XLSX</span><input className="input finance-file-input" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} /></label><label><span>Official opening balance</span><input className="input" inputMode="decimal" placeholder="0.00" value={opening} onChange={(event) => setOpening(event.target.value)} /></label><label><span>Official statement ending balance</span><input className="input" inputMode="decimal" placeholder="0.00" value={ending} onChange={(event) => setEnding(event.target.value)} /></label></div><button className="btn" disabled={busy || !file} onClick={() => previewFile().catch((error) => setMessage(error.message))}>{busy ? "Parsing…" : "Parse and preview"}</button>{message ? <div className="finance-alert is-info">{message}</div> : null}{preview ? <div className="finance-import-preview"><div className="finance-metric-grid is-four"><Metric label="Rows" value={preview.rows.length} /><Metric label="Possible duplicates" value={preview.duplicateCount} tone={preview.duplicateCount ? "danger" : "positive"} /><MoneyMetric label="Reconciliation difference" cents={liveReconciliation.differenceCents} tone={liveReconciliation.differenceCents ? "danger" : "positive"} /><Metric label="Status" value={liveReconciliation.canReconcile ? "Ready to reconcile" : "Review needed"} /></div><div className="finance-alert is-warning">Possible duplicates are never discarded automatically. Every flagged row requires Include or Skip.</div><div className="finance-import-rows">{preview.rows.map((row, index) => <article className={`finance-import-row ${row.errors.length || row.possibleDuplicate ? "has-warning" : ""}`} key={`${preview.batchId}-${row.sourceRow}-${index}`}><div className="finance-transaction-top"><div><strong>Source row {row.sourceRow}</strong><h3>{row.description || "Missing description"}</h3></div><strong>{money(row.amountCents)}</strong></div>{row.errors.length ? <div className="finance-alert is-danger">{row.errors.join(" ")}</div> : null}<div className="finance-form-grid is-compact"><label><span>Date</span><input className="input" type="date" value={row.transactionDate} onChange={(event) => updateRow(index, { transactionDate: event.target.value, errors: [] })} /></label><label><span>Signed amount</span><input className="input" inputMode="decimal" defaultValue={centsInput(row.amountCents)} onBlur={(event) => { try { updateRow(index, { amountCents: parseCentsInput(event.target.value), errors: [] }); } catch (error) { updateRow(index, { errors: [error.message] }); } }} /></label><label><span>Classification</span><select className="input" value={row.classification} onChange={(event) => updateRow(index, { classification: event.target.value, categoryId: categoryOptions(event.target.value)[0]?.id || "", isInternalTransfer: event.target.value === "transfer" })}><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select></label><label className="is-wide"><span>Raw description / payee</span><input className="input" value={row.description} onChange={(event) => updateRow(index, { description: event.target.value, errors: [] })} /></label><label><span>Category</span><select className="input" value={row.categoryId} onChange={(event) => updateRow(index, { categoryId: event.target.value })}>{categoryOptions(row.classification).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label><span>Reconciliation</span><select className="input" value={row.reconciliationStatus} onChange={(event) => updateRow(index, { reconciliationStatus: event.target.value })}><option value="cleared">Cleared</option><option value="outstanding">Outstanding</option><option value="unreviewed">Unreviewed</option></select></label>{row.possibleDuplicate ? <label><span>Duplicate decision</span><select className="input" value={row.duplicateDecision} onChange={(event) => updateRow(index, { duplicateDecision: event.target.value })}><option value="">Review required</option><option value="include">Include anyway</option><option value="skip">Skip this row</option></select></label> : null}</div><div className="finance-check-grid"><label><input type="checkbox" checked={row.isOneTime} onChange={(event) => updateRow(index, { isOneTime: event.target.checked })} /> One-time</label><label><input type="checkbox" checked={row.isInternalTransfer} onChange={(event) => updateRow(index, { isInternalTransfer: event.target.checked, classification: event.target.checked ? "transfer" : row.classification, categoryId: event.target.checked ? "finance_transfer_internal" : row.categoryId })} /> Internal transfer</label><label><input type="checkbox" checked={row.isRestricted} onChange={(event) => updateRow(index, { isRestricted: event.target.checked })} /> Restricted</label></div></article>)}</div><label className="finance-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the transaction rows, duplicate decisions, official balances, and reconciliation difference.</label><button className="btn" disabled={busy || !confirmed || preview.rows.some((row) => row.errors.length || (row.possibleDuplicate && !row.duplicateDecision))} onClick={() => confirmImport().catch((error) => setMessage(error.message))}>Confirm import</button></div> : null}</section>;
}

function SimpleAdminForms({ bootstrap, fiscalYearId, admin, onMutate, busy }) {
  const [reserve, setReserve] = useState("");
  const [fund, setFund] = useState({ name: "", amount: "", notes: "" });
  const [commitment, setCommitment] = useState({ description: "", payee: "", amount: "", dueDate: "", commitmentType: "commitment", checkLastFour: "" });
  const [mapping, setMapping] = useState({ classification: "income", sourceCategory: "", descriptionContains: "", categoryId: "finance_income_other", priority: "0" });
  const [forecast, setForecast] = useState({ statementMonth: "", classification: "income", categoryId: "", amount: "", notes: "" });
  const [documentFile, setDocumentFile] = useState(null);
  const [documentMonth, setDocumentMonth] = useState("");
  const [message, setMessage] = useState("");
  async function act(work) { setMessage(""); try { await work(); setMessage("Saved."); } catch (error) { setMessage(error.message); } }
  async function uploadDocument() { if (!documentFile) throw new Error("Choose a document."); const data = new FormData(); data.append("file", documentFile); data.append("fiscalYearId", fiscalYearId); data.append("statementMonth", documentMonth); await onMutate("documents", { method: "POST", body: data }); setDocumentFile(null); }
  return <div className="finance-section-stack"><section className="card finance-panel"><h2>Reserve setting</h2><div className="finance-inline-form"><input className="input" inputMode="decimal" placeholder="0.00" value={reserve} onChange={(event) => setReserve(event.target.value)} /><button className="btn" disabled={busy} onClick={() => act(() => onMutate("admin/reserve", JsonRequest("PUT", { fiscalYearId, reserveCents: parseCentsInput(reserve) })))}>Save reserve</button></div></section><div className="finance-two-column finance-align-start"><section className="card finance-panel"><h2>Restricted / designated fund</h2><div className="finance-form-stack"><input className="input" placeholder="Fund name" value={fund.name} onChange={(event) => setFund({ ...fund, name: event.target.value })} /><input className="input" inputMode="decimal" placeholder="Amount" value={fund.amount} onChange={(event) => setFund({ ...fund, amount: event.target.value })} /><input className="input" placeholder="Notes" value={fund.notes} onChange={(event) => setFund({ ...fund, notes: event.target.value })} /><button className="btn" disabled={busy} onClick={() => act(async () => { await onMutate("admin/fund", JsonRequest("POST", { name: fund.name, amountCents: parseCentsInput(fund.amount), fiscalYearId, notes: fund.notes })); setFund({ name: "", amount: "", notes: "" }); })}>Add fund</button></div><div className="finance-ranked-list">{admin.funds.map((item) => <div key={item.id}><span>{item.name}</span><strong>{money(item.amountCents)}</strong></div>)}</div></section><section className="card finance-panel"><h2>Commitment / outstanding check</h2><div className="finance-form-stack"><input className="input" placeholder="Description" value={commitment.description} onChange={(event) => setCommitment({ ...commitment, description: event.target.value })} /><input className="input" placeholder="Payee" value={commitment.payee} onChange={(event) => setCommitment({ ...commitment, payee: event.target.value })} /><input className="input" inputMode="decimal" placeholder="Amount" value={commitment.amount} onChange={(event) => setCommitment({ ...commitment, amount: event.target.value })} /><input className="input" type="date" value={commitment.dueDate} onChange={(event) => setCommitment({ ...commitment, dueDate: event.target.value })} /><select className="input" value={commitment.commitmentType} onChange={(event) => setCommitment({ ...commitment, commitmentType: event.target.value })}><option value="commitment">Commitment</option><option value="outstanding_check">Outstanding check</option></select>{commitment.commitmentType === "outstanding_check" ? <input className="input" inputMode="numeric" maxLength="4" placeholder="Check last four only" value={commitment.checkLastFour} onChange={(event) => setCommitment({ ...commitment, checkLastFour: event.target.value.replace(/\D/g, "").slice(0, 4) })} /> : null}<button className="btn" disabled={busy} onClick={() => act(async () => { await onMutate("admin/commitment", JsonRequest("POST", { ...commitment, amountCents: parseCentsInput(commitment.amount), fiscalYearId })); setCommitment({ description: "", payee: "", amount: "", dueDate: "", commitmentType: "commitment", checkLastFour: "" }); })}>Add obligation</button></div><div className="finance-ranked-list">{admin.commitments.map((item) => <div key={item.id}><span>{item.description}<small>{item.status} · {item.commitmentType.replace("_", " ")}</small></span><strong>{money(item.amountCents)}</strong></div>)}</div></section></div><div className="finance-two-column finance-align-start"><section className="card finance-panel"><h2>Category mapping</h2><div className="finance-form-stack"><select className="input" value={mapping.classification} onChange={(event) => setMapping({ ...mapping, classification: event.target.value, categoryId: bootstrap.categories.find((category) => category.classification === event.target.value)?.id || "" })}><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select><input className="input" placeholder="Original source category (optional)" value={mapping.sourceCategory} onChange={(event) => setMapping({ ...mapping, sourceCategory: event.target.value })} /><input className="input" placeholder="Description contains (optional)" value={mapping.descriptionContains} onChange={(event) => setMapping({ ...mapping, descriptionContains: event.target.value })} /><select className="input" value={mapping.categoryId} onChange={(event) => setMapping({ ...mapping, categoryId: event.target.value })}>{bootstrap.categories.filter((category) => category.classification === mapping.classification).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input className="input" type="number" placeholder="Priority" value={mapping.priority} onChange={(event) => setMapping({ ...mapping, priority: event.target.value })} /><button className="btn" disabled={busy || (!mapping.sourceCategory && !mapping.descriptionContains)} onClick={() => act(() => onMutate("admin/mapping", JsonRequest("POST", { ...mapping, priority: Number(mapping.priority) })))}>Add mapping</button></div></section><section className="card finance-panel"><h2>Forecast</h2><div className="finance-form-stack"><input className="input" type="month" value={forecast.statementMonth} onChange={(event) => setForecast({ ...forecast, statementMonth: event.target.value })} /><select className="input" value={forecast.classification} onChange={(event) => setForecast({ ...forecast, classification: event.target.value, categoryId: "" })}><option value="income">Income</option><option value="expense">Expense</option></select><select className="input" value={forecast.categoryId} onChange={(event) => setForecast({ ...forecast, categoryId: event.target.value })}><option value="">No category</option>{bootstrap.categories.filter((category) => category.classification === forecast.classification).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input className="input" inputMode="decimal" placeholder="Amount" value={forecast.amount} onChange={(event) => setForecast({ ...forecast, amount: event.target.value })} /><input className="input" placeholder="Forecast notes" value={forecast.notes} onChange={(event) => setForecast({ ...forecast, notes: event.target.value })} /><button className="btn" disabled={busy} onClick={() => act(() => onMutate("admin/forecast", JsonRequest("POST", { ...forecast, amountCents: parseCentsInput(forecast.amount), fiscalYearId })))}>Add forecast</button></div></section></div><section className="card finance-panel"><h2>Protected supporting documents</h2><div className="finance-inline-form"><input className="input" type="month" value={documentMonth} onChange={(event) => setDocumentMonth(event.target.value)} /><input className="input finance-file-input" type="file" accept=".pdf,.csv,.xlsx" onChange={(event) => setDocumentFile(event.target.files?.[0] || null)} /><button className="btn" disabled={busy || !documentFile} onClick={() => act(uploadDocument)}>Upload to protected R2</button></div><div className="finance-ranked-list">{admin.documents.map((doc) => <div key={doc.id}><span><a href={`/api/board/finance/documents/${doc.id}`} target="_blank" rel="noreferrer">{doc.filename}</a><small>{doc.statementMonth ? monthLabel(doc.statementMonth) : "General"} · {Math.ceil(doc.sizeBytes / 1024)} KB</small></span><strong>{doc.uploadedBy}</strong></div>)}</div></section>{message ? <div className="finance-alert is-info">{message}</div> : null}</div>;
}

function FinanceAdmin({ bootstrap, fiscalYearId, admin, onRefresh, busy, setBusy }) {
  const [subtab, setSubtab] = useState("imports");
  async function mutate(path, options) { setBusy(true); try { await api(path, options); await onRefresh(); } finally { setBusy(false); } }
  async function rollback(batchId) { if (!window.confirm("Roll back this batch? Imported rows will be soft-deleted and the month unpublished.")) return; await mutate(`imports/${batchId}/rollback`, JsonRequest("POST", {})); }
  return <div className="finance-section-stack"><div className="finance-subtabs"><button className={subtab === "imports" ? "is-active" : ""} onClick={() => setSubtab("imports")}>Imports</button><button className={subtab === "settings" ? "is-active" : ""} onClick={() => setSubtab("settings")}>Funds, obligations & forecast</button><button className={subtab === "audit" ? "is-active" : ""} onClick={() => setSubtab("audit")}>Audit history</button></div>{subtab === "imports" ? <><ImportWorkflow bootstrap={bootstrap} fiscalYearId={fiscalYearId} onComplete={onRefresh} busy={busy} setBusy={setBusy} /><section className="card finance-panel"><h2>Import batches</h2>{admin.imports.length ? <div className="finance-ranked-list">{admin.imports.map((batch) => <div key={batch.id}><span>{batch.sourceFilename}<small>{monthLabel(batch.statementMonth)} · {batch.accountName} · {batch.status} · {batch.importedCount}/{batch.rowCount} rows · {batch.duplicateCount} duplicate warnings</small></span>{batch.status === "imported" ? <button className="btn-danger btn-sm" disabled={busy} onClick={() => rollback(batch.id)}>Roll back</button> : <strong>{batch.status}</strong>}</div>)}</div> : <EmptyState>No import batches yet.</EmptyState>}</section></> : null}{subtab === "settings" ? <SimpleAdminForms bootstrap={bootstrap} fiscalYearId={fiscalYearId} admin={admin} onMutate={mutate} busy={busy} /> : null}{subtab === "audit" ? <section className="card finance-panel"><h2>Import and edit audit history</h2>{admin.audit.length ? <div className="finance-audit-list">{admin.audit.map((event) => <article key={event.id}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.actor} · {new Date(event.createdAt).toLocaleString()}</span><small>{event.entityType}: {event.entityId}</small></article>)}</div> : <EmptyState>No audit events yet.</EmptyState>}</section> : null}</div>;
}

export default function BoardFinance() {
  const [authState, setAuthState] = useState("checking");
  const [bootstrap, setBootstrap] = useState(null);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [admin, setAdmin] = useState(EMPTY_ADMIN);
  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState({ search: "", month: "", account: "", category: "", classification: "", oneTime: "" });
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingTransaction, setEditingTransaction] = useState(null);
  const isEditor = bootstrap?.session?.role === "editor";

  async function loadBootstrap() {
    try {
      const data = await api("bootstrap");
      setBootstrap(data);
      setFiscalYearId((current) => current || data.fiscalYears.find((year) => year.status === "open")?.id || data.fiscalYears[0]?.id || "");
      setAuthState("authed");
    } catch (nextError) {
      if (nextError.status === 401) { setAuthState("login"); setBootstrap(null); }
      else { setError(nextError.message); setAuthState("error"); }
    }
  }

  async function loadFinance() {
    if (!fiscalYearId || !bootstrap) return;
    setLoading(true); setError("");
    try {
      const requests = [api(`dashboard?fiscalYear=${encodeURIComponent(fiscalYearId)}`)];
      if (isEditor) requests.push(api(`admin?fiscalYear=${encodeURIComponent(fiscalYearId)}`));
      const [dashboardData, adminData] = await Promise.all(requests);
      setDashboard(dashboardData.dashboard);
      setAdmin(adminData?.admin || EMPTY_ADMIN);
    } catch (nextError) {
      if (nextError.status === 401) setAuthState("login");
      else setError(nextError.message);
    } finally { setLoading(false); }
  }

  async function loadTransactions() {
    if (!fiscalYearId || !bootstrap) return;
    setTransactionsLoading(true);
    try {
      const query = new URLSearchParams({ fiscalYear: fiscalYearId });
      Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
      const data = await api(`transactions?${query}`);
      setTransactions(data.transactions);
    } catch (nextError) { setError(nextError.message); }
    finally { setTransactionsLoading(false); }
  }

  useEffect(() => { loadBootstrap(); }, []);
  // Reloads are intentionally keyed to authenticated state and fiscal-year selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (authState === "authed") loadFinance(); }, [authState, fiscalYearId]);
  // Debounce filter changes; the current closure carries the selected filters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (authState !== "authed") return undefined; const timer = setTimeout(loadTransactions, 250); return () => clearTimeout(timer); }, [authState, fiscalYearId, filters]);

  async function logout() { await api("session", { method: "DELETE" }).catch(() => {}); setAuthState("login"); setBootstrap(null); setDashboard(null); }
  async function saveTransaction(transactionId, body) { setBusy(true); try { await api(`transactions/${transactionId}`, JsonRequest("PUT", body)); setEditingTransaction(null); await Promise.all([loadFinance(), loadTransactions()]); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); } }
  async function saveReconciliation(month, body) { setBusy(true); try { await api(`reconciliations/${month}`, JsonRequest("PUT", body)); await loadFinance(); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); } }
  async function publish(month, next) { setBusy(true); try { await api(`periods/${month}`, JsonRequest("PUT", { publish: next })); await loadFinance(); } catch (nextError) { setError(nextError.message); } finally { setBusy(false); } }
  async function exportCsv() { const query = new URLSearchParams({ fiscalYear: fiscalYearId, format: "csv" }); Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); }); const response = await api(`transactions?${query}`, { raw: true }); if (!response.ok) { setError("CSV export failed."); return; } const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `bgsl-finance-${fiscalYearId}.csv`; anchor.click(); URL.revokeObjectURL(url); }

  const tabList = useMemo(() => isEditor ? [...TABS, ["admin", "Finance administration"]] : TABS, [isEditor]);
  if (authState === "checking") return <LoadingCard text="Checking finance access…" />;
  if (authState === "login") return <FinanceLogin onLogin={loadBootstrap} />;
  if (authState === "error") return <div className="page"><div className="finance-alert is-danger">{error}</div></div>;
  if (!bootstrap || !fiscalYearId) return <LoadingCard />;

  return <div className="finance-page"><header className="finance-page-header"><div><div className="finance-eyebrow">Board Member Area</div><h1>Financial dashboard</h1><p>Reconciled cash, fiscal-year performance, transaction detail, and deterministic financial insights.</p></div><div className="finance-header-actions"><label><span>Fiscal year</span><select className="input" value={fiscalYearId} onChange={(event) => setFiscalYearId(event.target.value)}>{bootstrap.fiscalYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select></label><span className={`finance-role-badge is-${bootstrap.session.role}`}>{isEditor ? "Finance editor" : "Board viewer"}</span><button className="btn-secondary" onClick={logout}>Sign out</button></div></header><nav className="finance-tabs" aria-label="Finance dashboard sections">{tabList.map(([id, label]) => <button key={id} className={activeTab === id ? "is-active" : ""} onClick={() => setActiveTab(id)}>{label}</button>)}</nav>{error ? <div className="finance-alert is-danger" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div> : null}{loading || !dashboard ? <LoadingCard /> : <main className="finance-content">{activeTab === "overview" ? <Overview dashboard={dashboard} /> : null}{activeTab === "cash-flow" ? <CashFlow dashboard={dashboard} /> : null}{activeTab === "spending" ? <Spending dashboard={dashboard} onTransactions={() => setActiveTab("transactions")} /> : null}{activeTab === "income" ? <Income dashboard={dashboard} /> : null}{activeTab === "comparison" ? <Comparison dashboard={dashboard} /> : null}{activeTab === "reconciliation" ? <Reconciliation dashboard={dashboard} isEditor={isEditor} documents={admin.documents} onSave={saveReconciliation} onPublish={publish} busy={busy} /> : null}{activeTab === "transactions" ? <Transactions rows={transactions} filters={filters} setFilters={setFilters} bootstrap={bootstrap} isEditor={isEditor} onEdit={setEditingTransaction} onExport={exportCsv} loading={transactionsLoading} /> : null}{activeTab === "admin" && isEditor ? <FinanceAdmin bootstrap={bootstrap} fiscalYearId={fiscalYearId} admin={admin} onRefresh={loadFinance} busy={busy} setBusy={setBusy} /> : null}</main>}{editingTransaction ? <TransactionEditor transaction={editingTransaction} categories={bootstrap.categories} onSave={saveTransaction} onClose={() => setEditingTransaction(null)} busy={busy} /> : null}</div>;
}
