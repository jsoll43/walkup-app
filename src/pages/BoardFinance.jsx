import { useEffect, useMemo, useState } from "react";
import readExcelFile from "read-excel-file/browser";
import { fiscalYearForDate, parseAmountToCents, sha256Hex } from "../../shared/financeCore.js";
import { buildImportChecklist, inferImportMonth, parseBgslWorkbook, parseFinanceCsv, validateImportRows } from "../../shared/financeImport.js";

const TABS = [
  ["overview", "Overview"],
  ["cash-flow", "Cash flow"],
  ["spending", "Spending"],
  ["income", "Income"],
  ["comparison", "Year over year"],
  ["ai", "AI reports (Beta)"],
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

function compactMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(cents) / 100);
}

function niceChartScale(values, includeZero = false) {
  const numbers = values.filter(Number.isSafeInteger);
  if (!numbers.length) return { minimum: 0, maximum: 100, ticks: [0, 100] };
  let dataMinimum = Math.min(...numbers);
  let dataMaximum = Math.max(...numbers);
  if (includeZero) {
    dataMinimum = Math.min(0, dataMinimum);
    dataMaximum = Math.max(0, dataMaximum);
  }
  if (dataMinimum === dataMaximum) {
    const padding = Math.max(100, Math.round(Math.abs(dataMaximum) * 0.2));
    dataMinimum = includeZero ? Math.min(0, dataMinimum - padding) : dataMinimum - padding;
    dataMaximum += padding;
  }
  const roughStep = (dataMaximum - dataMinimum) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const multiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 2.5 ? 2.5 : normalizedStep <= 5 ? 5 : 10;
  const step = Math.max(1, Math.round(multiplier * magnitude));
  const minimum = Math.floor(dataMinimum / step) * step;
  let maximum = Math.ceil(dataMaximum / step) * step;
  if (maximum === minimum) maximum += step;
  const ticks = Array.from({ length: Math.round((maximum - minimum) / step) + 1 }, (_, index) => minimum + index * step);
  return { minimum, maximum, ticks };
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

function ChartNavigation({ ariaLabel, windowStart, maxStart, startMonth, endMonth, onChange }) {
  return (
    <div className="finance-chart-nav-row">
      <div className="finance-chart-nav" aria-label={ariaLabel}>
        <button type="button" className="btn-secondary btn-sm" disabled={windowStart === 0} onClick={() => onChange(Math.max(0, windowStart - 1))}>← Earlier</button>
        <strong>{monthLabel(startMonth)} – {monthLabel(endMonth)}</strong>
        <button type="button" className="btn-secondary btn-sm" disabled={windowStart >= maxStart} onClick={() => onChange(Math.min(maxStart, windowStart + 1))}>Later →</button>
      </div>
    </div>
  );
}

function ChartTooltip({ tooltip, width, height }) {
  if (!tooltip) return null;
  const tooltipWidth = Math.min(230, Math.max(120, tooltip.label.length * 6.4 + 18));
  const tooltipHeight = 27;
  const x = Math.min(width - tooltipWidth - 6, Math.max(6, tooltip.x - tooltipWidth / 2));
  const above = tooltip.y - tooltipHeight - 9;
  const y = above >= 6 ? above : Math.min(height - tooltipHeight - 6, tooltip.y + 11);
  return (
    <g className="finance-chart-tooltip" aria-hidden="true">
      <rect x={x} y={y} width={tooltipWidth} height={tooltipHeight} rx="6" />
      <text x={x + tooltipWidth / 2} y={y + 18} textAnchor="middle">{tooltip.label}</text>
    </g>
  );
}

function MonthlyChart({ rows }) {
  const windowSize = 6;
  const maxStart = Math.max(0, rows.length - windowSize);
  const latestActualIndex = rows.reduce((latest, row, index) => row.hasActual ? index : latest, -1);
  const initialStart = Math.min(maxStart, Math.max(0, latestActualIndex - windowSize + 1));
  const [requestedStart, setRequestedStart] = useState(initialStart);
  const [tooltip, setTooltip] = useState(null);
  const windowStart = Math.min(requestedStart, maxStart);
  if (!rows.length || !rows.some((row) => row.incomeCents || row.expensesCents)) return <EmptyState>No recorded income or expenses are available for this reporting period.</EmptyState>;

  const visibleRows = rows.slice(windowStart, windowStart + windowSize);
  const { minimum, maximum, ticks } = niceChartScale(rows.flatMap((row) => [row.incomeCents, row.expensesCents]), true);
  const width = 560;
  const height = 245;
  const left = 58;
  const right = 18;
  const top = 18;
  const bottom = 40;
  const baseline = height - bottom;
  const plotWidth = width - left - right;
  const plotHeight = baseline - top;
  const groupWidth = plotWidth / Math.max(1, visibleRows.length);
  const y = (value) => baseline - ((value - minimum) / Math.max(1, maximum - minimum)) * plotHeight;

  return (
    <div>
      <div className="finance-chart" role="img" aria-label={`Monthly income and expenses from ${monthLabel(visibleRows[0].month)} through ${monthLabel(visibleRows.at(-1).month)}`}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {ticks.map((value) => <g key={value}><line x1={left} y1={y(value)} x2={width - right} y2={y(value)} className={value === minimum ? "finance-chart-axis" : "finance-chart-grid"} /><text x={left - 8} y={y(value) + 4} textAnchor="end">{compactMoney(value)}</text></g>)}
          {visibleRows.map((row, index) => {
            const x = left + index * groupWidth + Math.max(4, (groupWidth - 42) / 2);
            const incomeHeight = baseline - y(row.incomeCents);
            const expenseHeight = baseline - y(row.expensesCents);
            const incomeLabel = `${monthLabel(row.month)} income: ${money(row.incomeCents)}`;
            const expenseLabel = `${monthLabel(row.month)} expenses: ${money(row.expensesCents)}`;
            return (
              <g key={row.month}>
                <rect x={x} y={baseline - incomeHeight} width="19" height={incomeHeight} rx="4" className="finance-chart-income" tabIndex={0} aria-label={incomeLabel} onMouseEnter={() => setTooltip({ x: x + 9.5, y: baseline - incomeHeight, label: incomeLabel })} onMouseLeave={() => setTooltip(null)} onFocus={() => setTooltip({ x: x + 9.5, y: baseline - incomeHeight, label: incomeLabel })} onBlur={() => setTooltip(null)}><title>{incomeLabel}</title></rect>
                <rect x={x + 23} y={baseline - expenseHeight} width="19" height={expenseHeight} rx="4" className="finance-chart-expense" tabIndex={0} aria-label={expenseLabel} onMouseEnter={() => setTooltip({ x: x + 32.5, y: baseline - expenseHeight, label: expenseLabel })} onMouseLeave={() => setTooltip(null)} onFocus={() => setTooltip({ x: x + 32.5, y: baseline - expenseHeight, label: expenseLabel })} onBlur={() => setTooltip(null)}><title>{expenseLabel}</title></rect>
                <text x={x + 21} y={height - 16} textAnchor="middle">{monthLabel(row.month).split(" ")[0]}</text>
              </g>
            );
          })}
          <ChartTooltip tooltip={tooltip} width={width} height={height} />
        </svg>
        <div className="finance-chart-legend"><span className="is-income" /> Income <span className="is-expense" /> Expenses</div>
      </div>
      <ChartNavigation ariaLabel="Monthly cash flow date range" windowStart={windowStart} maxStart={maxStart} startMonth={visibleRows[0].month} endMonth={visibleRows.at(-1).month} onChange={setRequestedStart} />
    </div>
  );
}

function HistoricalBalanceChart({ rows = [] }) {
  const windowSize = 6;
  const maxStart = Math.max(0, rows.length - windowSize);
  const [requestedStart, setRequestedStart] = useState(maxStart);
  const [tooltip, setTooltip] = useState(null);
  const windowStart = Math.min(requestedStart, maxStart);
  if (!rows.length) return <EmptyState>No official historical balances are available.</EmptyState>;

  const visibleRows = rows.slice(windowStart, windowStart + windowSize);
  const knownRows = visibleRows.filter((row) => Number.isSafeInteger(row.balanceCents));
  const allKnownRows = rows.filter((row) => Number.isSafeInteger(row.balanceCents));
  const { minimum, maximum, ticks } = niceChartScale(allKnownRows.map((row) => row.balanceCents), true);
  const width = 560;
  const height = 245;
  const left = 58;
  const right = 18;
  const top = 18;
  const bottom = 48;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index) => left + (visibleRows.length === 1 ? plotWidth / 2 : (index * plotWidth) / (visibleRows.length - 1));
  const y = (value) => top + ((maximum - value) / Math.max(1, maximum - minimum)) * plotHeight;
  const lineSegments = visibleRows.slice(1).map((row, index) => {
    const previous = visibleRows[index];
    if (!Number.isSafeInteger(previous.balanceCents) || !Number.isSafeInteger(row.balanceCents)) return null;
    return { previous, row, x1: x(index), y1: y(previous.balanceCents), x2: x(index + 1), y2: y(row.balanceCents) };
  }).filter(Boolean);
  const areaSegments = [];
  let activeArea = [];
  visibleRows.forEach((row, index) => {
    if (Number.isSafeInteger(row.balanceCents)) activeArea.push({ x: x(index), y: y(row.balanceCents) });
    else if (activeArea.length) { areaSegments.push(activeArea); activeArea = []; }
  });
  if (activeArea.length) areaSegments.push(activeArea);
  const statusLabel = (row) => row.status === "reconciled" ? "Reconciled" : row.status === "unreconciled" ? "Unreconciled statement balance" : row.status === "calculated" ? `Calculated ${row.calculationDirection === "backward" ? "backward from the next official balance" : "forward from the prior official balance"}; not validated` : "Statement control";
  const rollforwardNote = (row) => Number.isSafeInteger(row.rollforwardDifferenceCents) && row.rollforwardDifferenceCents !== 0
    ? ` · official balance is ${money(Math.abs(row.rollforwardDifferenceCents))} ${row.rollforwardDifferenceCents > 0 ? "higher" : "lower"} than recorded activity projected`
    : "";
  const visibleRange = `${monthLabel(visibleRows[0].statementMonth)} – ${monthLabel(visibleRows.at(-1).statementMonth)}`;

  return (
    <div>
      <div className="finance-chart is-balance" role="img" aria-label={`Official and calculated historical balances from ${visibleRange}`}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          {areaSegments.filter((segment) => segment.length > 1).map((segment, index) => <polygon key={index} points={`${segment[0].x},${y(0)} ${segment.map((point) => `${point.x},${point.y}`).join(" ")} ${segment.at(-1).x},${y(0)}`} className="finance-balance-chart-area" fill="#d9a514" fillOpacity="0.18" />)}
          {ticks.map((value) => <g key={value}><line x1={left} y1={y(value)} x2={width - right} y2={y(value)} className={value === minimum ? "finance-chart-axis" : "finance-chart-grid"} />{allKnownRows.length ? <text x={left - 8} y={y(value) + 4} textAnchor="end">{compactMoney(value)}</text> : null}</g>)}
          {lineSegments.map((segment) => <line key={`${segment.previous.statementMonth}-${segment.row.statementMonth}`} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} stroke={segment.previous.status === "calculated" || segment.row.status === "calculated" ? "#64748b" : "#9a6f00"} className={`finance-balance-chart-line ${segment.previous.status === "calculated" || segment.row.status === "calculated" ? "is-calculated" : ""}`} />)}
          {visibleRows.map((row, index) => (
            <g key={row.statementMonth}>
              {Number.isSafeInteger(row.balanceCents)
                ? <circle cx={x(index)} cy={y(row.balanceCents)} r="6" fill={row.status === "calculated" ? "#fff" : row.status === "control" || row.status === "unreconciled" ? "#d97706" : "#d9a514"} stroke={row.status === "calculated" ? "#64748b" : "#fff"} className={`finance-balance-chart-point is-${row.status}`} tabIndex={0} aria-label={`${monthLabel(row.statementMonth)} balance: ${money(row.balanceCents)}`} onMouseEnter={() => setTooltip({ x: x(index), y: y(row.balanceCents), label: `${monthLabel(row.statementMonth)} balance: ${money(row.balanceCents)}` })} onMouseLeave={() => setTooltip(null)} onFocus={() => setTooltip({ x: x(index), y: y(row.balanceCents), label: `${monthLabel(row.statementMonth)} balance: ${money(row.balanceCents)}` })} onBlur={() => setTooltip(null)}><title>{`${monthLabel(row.statementMonth)}: ${money(row.balanceCents)} · ${statusLabel(row)}${rollforwardNote(row)}`}</title></circle>
                : <circle cx={x(index)} cy={top + plotHeight} r="4" fill="#cbd5e1" className="finance-balance-chart-missing" tabIndex={0} aria-label={`${monthLabel(row.statementMonth)} balance unavailable`} onMouseEnter={() => setTooltip({ x: x(index), y: top + plotHeight, label: `${monthLabel(row.statementMonth)}: balance unavailable` })} onMouseLeave={() => setTooltip(null)} onFocus={() => setTooltip({ x: x(index), y: top + plotHeight, label: `${monthLabel(row.statementMonth)}: balance unavailable` })} onBlur={() => setTooltip(null)}><title>{`${monthLabel(row.statementMonth)}: recorded activity is missing, so the balance cannot be calculated`}</title></circle>}
              <text x={x(index)} y={height - 19} textAnchor="middle">{monthLabel(row.statementMonth).split(" ")[0]}</text>
            </g>
          ))}
          {!knownRows.length ? <text x={left + plotWidth / 2} y={top + plotHeight / 2} textAnchor="middle" className="finance-balance-chart-empty">No balance can be calculated in this window</text> : null}
          <ChartTooltip tooltip={tooltip} width={width} height={height} />
        </svg>
        <div className="finance-balance-legend" aria-label="Historical balance point key">
          <strong>Point key</strong>
          <span><i className="is-balance-known" /><span><b>Reconciled</b> Official statement balance</span></span>
          <span><i className="is-balance-review" /><span><b>Under review</b> Official control or unreconciled balance</span></span>
          <span><i className="is-balance-calculated" /><span><b>Calculated</b> Based on activity; not yet validated</span></span>
          <span><i className="is-balance-missing" /><span><b>Unavailable</b> Not enough recorded activity</span></span>
        </div>
      </div>
      <ChartNavigation ariaLabel="Historical balance date range" windowStart={windowStart} maxStart={maxStart} startMonth={visibleRows[0].statementMonth} endMonth={visibleRows.at(-1).statementMonth} onChange={setRequestedStart} />
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

function AiInsights({ dashboard, fiscalYearId }) {
  const minimumDate = dashboard.fiscalYear.startsOn;
  const maximumDate = dashboard.fiscalYear.endsOn;
  const [startDate, setStartDate] = useState(dashboard.ai?.availableStartDate || minimumDate);
  const [endDate, setEndDate] = useState(dashboard.ai?.availableEndDate || maximumDate);
  const [loadingReport, setLoadingReport] = useState("");
  const [result, setResult] = useState(null);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [allowanceBlocked, setAllowanceBlocked] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const rangeValid = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(endDate)
    && startDate >= minimumDate
    && endDate <= maximumDate
    && startDate <= endDate;
  const usagePercent = usage ? Math.min(100, (usage.neuronsUsedMilli / Math.max(1, usage.neuronLimitMilli)) * 100) : 0;
  const usageUnavailable = !usageLoading && !usage;
  const allowanceReached = allowanceBlocked || Boolean(usage && usage.remainingNeuronsMilli <= 0);
  const neurons = (milli) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(milli || 0) / 1_000);

  useEffect(() => {
    let current = true;
    setUsageLoading(true);
    api("ai-usage")
      .then((data) => { if (current) setUsage(data.usage); })
      .catch((nextError) => { if (current) setError(nextError.message); })
      .finally(() => { if (current) setUsageLoading(false); });
    return () => { current = false; };
  }, []);

  async function generate(reportType, requestedQuestion = "") {
    if (!rangeValid) {
      setError("Choose a valid date range within this reporting period.");
      return;
    }
    const cleanQuestion = requestedQuestion.trim();
    if (requestedQuestion && !cleanQuestion) {
      setError("Type a question first.");
      return;
    }
    const requestKey = cleanQuestion ? "question" : reportType;
    setLoadingReport(requestKey);
    setError("");
    try {
      const data = await api(`ai-insights?fiscalYear=${encodeURIComponent(fiscalYearId)}`, JsonRequest("POST", {
        reportType,
        startDate,
        endDate,
        question: cleanQuestion,
      }));
      setResult({ ...data.insight, reportType: requestKey });
      setUsage(data.insight.usage);
      setAllowanceBlocked(false);
    } catch (nextError) {
      setError(nextError.message);
      if (nextError.status === 429) setAllowanceBlocked(true);
      api("ai-usage").then((data) => setUsage(data.usage)).catch(() => {});
    } finally {
      setLoadingReport("");
    }
  }

  return (
    <section className="card finance-panel finance-ai-panel">
      <div className="finance-section-heading">
        <div><div className="finance-eyebrow">Workers AI · Beta</div><h2>Ask about the calculated totals</h2><p>Ask a basic financial question or choose a prepared report. The model receives aggregate totals only.</p></div>
        <span className="finance-status-pill is-warning">Beta · AI wording only</span>
      </div>
      <div className="finance-ai-toolbar">
        <label><span>Start date</span><input className="input" type="date" min={minimumDate} max={maximumDate} value={startDate} disabled={Boolean(loadingReport)} onChange={(event) => { setStartDate(event.target.value); setResult(null); setError(""); }} /></label>
        <label><span>End date</span><input className="input" type="date" min={minimumDate} max={maximumDate} value={endDate} disabled={Boolean(loadingReport)} onChange={(event) => { setEndDate(event.target.value); setResult(null); setError(""); }} /></label>
      </div>
      <p className="finance-ai-note">Dates are inclusive, so the range does not need to align with whole months.</p>
      <form className="finance-ai-question" onSubmit={(event) => { event.preventDefault(); generate("explain_month", question); }}>
        <label htmlFor="finance-ai-question"><span>Your question</span><textarea id="finance-ai-question" className="input" rows="2" maxLength="240" placeholder="For example: What should the Board pay attention to in this period?" value={question} disabled={Boolean(loadingReport)} onChange={(event) => { setQuestion(event.target.value); setResult(null); setError(""); }} /></label>
        <button className="btn" disabled={!rangeValid || !question.trim() || Boolean(loadingReport) || allowanceReached}>{loadingReport === "question" ? "Answering…" : "Ask about these dates"}</button>
      </form>
      <p className="finance-ai-note">Try: “Where did we spend the most?”, “How did income compare with last year?”, or “What should the Board watch?”</p>
      <div className="finance-ai-usage">
        <div><strong>Daily AI usage</strong><span>{usageLoading ? "Loading usage…" : usageUnavailable ? "Usage unavailable" : `${neurons(usage.neuronsUsedMilli)} of ${neurons(usage.neuronLimitMilli)} neurons`}</span></div>
        <div className="finance-ai-usage-track" role="progressbar" aria-label="Daily finance AI neuron usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(usagePercent)}><span style={{ width: `${usagePercent}%` }} /></div>
        <small>{usage ? `Resets ${new Date(usage.resetAt).toLocaleString([], { timeZoneName: "short" })}. ` : ""}The server will not start an uncached report that could exceed 10,000 neurons. This meter covers this finance dashboard; other Workers AI use on the Cloudflare account is separate.</small>
      </div>
      <div className="finance-ai-actions">
        <button className="btn" disabled={!rangeValid || Boolean(loadingReport) || allowanceReached} onClick={() => generate("explain_month")}>{loadingReport === "explain_month" ? "Writing…" : "Explain selected dates"}</button>
        <button className="btn-secondary" disabled={!rangeValid || Boolean(loadingReport) || allowanceReached} onClick={() => generate("year_over_year")}>{loadingReport === "year_over_year" ? "Writing…" : "Summarize the biggest year-over-year changes"}</button>
        <button className="btn-secondary" disabled={!rangeValid || Boolean(loadingReport) || allowanceReached} onClick={() => generate("expense_increases")}>{loadingReport === "expense_increases" ? "Writing…" : "What expenses increased the most?"}</button>
        <button className="btn-secondary" disabled={!rangeValid || Boolean(loadingReport) || allowanceReached} onClick={() => generate("treasurer_report")}>{loadingReport === "treasurer_report" ? "Writing…" : "Create a short treasurer's report for the board meeting"}</button>
      </div>
      <p className="finance-ai-note">Year-over-year reports compare the selected dates with the same dates one year earlier. If no prior transactions exist for those dates, the report says that comparison data is unavailable.</p>
      <div className="finance-ai-guardrail"><strong>What AI cannot do:</strong> It receives no account balances, reconciliation data, transaction descriptions, payees, or documents. It cannot change any financial record.</div>
      {error ? <div className="finance-alert is-warning" role="alert">{error}</div> : null}
      {result ? <div className="finance-ai-result" aria-live="polite"><div className="finance-ai-result-meta"><strong>AI-generated wording</strong><span>{result.cached ? "Reused cached report · no new AI usage" : "New report · daily neuron meter updated"}</span></div><div className="finance-ai-result-copy">{result.content}</div><small>Verify the wording against the calculated dashboard totals above; those totals remain the source of truth.</small></div> : null}
    </section>
  );
}

function Overview({ dashboard }) {
  const { overview } = dashboard;
  const balanceStatus = !overview.hasReconciledBalances
    ? { label: "No reconciled balance", tone: "is-warning" }
    : overview.balanceIsPreliminary
      ? { label: "Preliminary reconciled balance", tone: "is-warning" }
      : { label: "Reconciled balances", tone: "is-good" };
  return (
    <div className="finance-section-stack">
      {overview.hasUnreconciled || overview.balanceIsPreliminary ? <div className="finance-alert is-warning"><strong>Preliminary figures.</strong> <span>{overview.hasUnreconciled ? "At least one expected month is missing or unreconciled. " : ""}Only reconciled balances are used for cash metrics.{overview.balanceIsPreliminary ? " The latest reconciled balance is shown even though its reporting period is not yet published." : ""}</span></div> : null}
      <section>
        <div className="finance-section-heading"><div><div className="finance-eyebrow">Liquidity</div><h2>Cash position</h2></div><span className={`finance-status-pill ${balanceStatus.tone}`}>{balanceStatus.label}</span></div>
        <div className="finance-metric-grid">
          <MoneyMetric label="Bank balances" cents={overview.bankBalancesCents} note={overview.balanceIsPreliminary ? "Latest reconciled balance; reporting period not yet published" : "Latest reconciled balance per bank account"} />
          <MoneyMetric label="Cash on hand" cents={overview.reconciledCashOnHandCents} note="Reconciled cash only" />
          <MoneyMetric label="Restricted funds" cents={overview.restrictedFundsCents} tone="muted" />
          <MoneyMetric label="Outstanding obligations" cents={overview.outstandingObligationsCents} tone="muted" />
          <MoneyMetric label="Board-selected reserve" cents={overview.reserveCents} tone="muted" />
          <MoneyMetric label="Available cash" cents={overview.availableCashCents} tone={overview.availableCashCents < 0 ? "danger" : "gold"} note="Balance + cash − restrictions − obligations − reserve" />
        </div>
      </section>
      <section>
        <div className="finance-section-heading"><div><div className="finance-eyebrow">Year-to-date performance</div><h2>{dashboard.fiscalYear.label}</h2></div></div>
        <div className="finance-metric-grid is-four">
          <MoneyMetric label="External income" cents={overview.ytdIncomeCents} />
          <MoneyMetric label="Expenses" cents={overview.ytdExpensesCents} />
          <MoneyMetric label="Surplus / deficit" cents={overview.ytdSurplusCents} tone={overview.ytdSurplusCents < 0 ? "danger" : "positive"} />
          <MoneyMetric label={overview.projectedEndingBalance.isProjected ? "Projected year end" : "Current reconciled balance"} cents={overview.projectedEndingBalance.valueCents} note={overview.projectedEndingBalance.isProjected ? "Includes disclosed forecasts" : overview.balanceIsPreliminary ? "Latest reconciled balance; reporting period not yet published" : "No future forecast loaded"} />
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
  const hasPreliminaryActuals = dashboard.monthly.some((row) => row.hasActual && row.isPreliminary);
  const chartRows = dashboard.cashFlowHistory || dashboard.monthly;
  return <div className="finance-section-stack">{hasPreliminaryActuals ? <div className="finance-alert is-warning"><strong>Preliminary activity.</strong> Recorded transactions are shown before statement validation or reconciliation.</div> : null}<div className="finance-two-column finance-align-start"><section className="card finance-panel"><div className="finance-section-heading"><div><div className="finance-eyebrow">Actuals</div><h2>Monthly cash flow</h2><p>Use the controls below the graph to move through the reporting period.</p></div></div><MonthlyChart key={`${chartRows[0]?.month || dashboard.fiscalYear.id}-${chartRows.at(-1)?.month || "empty"}`} rows={chartRows} /></section><section className="card finance-panel"><div className="finance-section-heading"><div><div className="finance-eyebrow">Balance history</div><h2>Historical balance</h2><p>Official points anchor calculated balances. Hollow points are based on recorded activity and are not yet validated or reconciled.</p></div></div><HistoricalBalanceChart key={dashboard.historicalBalances.at(-1)?.statementMonth || "empty"} rows={dashboard.historicalBalances} /></section></div><div className="finance-month-cards">{dashboard.monthly.map((row) => <div className="card finance-month-card" key={row.month}><div className="finance-month-card-heading"><h3>{monthLabel(row.month)}</h3>{row.isPreliminary ? <span>Preliminary</span> : null}</div><dl><div><dt>Income</dt><dd>{money(row.incomeCents)}</dd></div><div><dt>Expenses</dt><dd>{money(row.expensesCents)}</dd></div><div><dt>Net</dt><dd className={row.netCents < 0 ? "is-negative" : "is-positive"}>{money(row.netCents)}</dd></div><div><dt>Running net</dt><dd>{money(row.runningNetCents)}</dd></div>{row.hasForecast ? <div><dt>Forecast net</dt><dd>{money(row.forecastNetCents)} <small>Projected</small></dd></div> : null}</dl></div>)}</div></div>;
}

function Spending({ dashboard, onTransactions }) {
  return <div className="finance-two-column finance-align-start"><section className="card finance-panel"><h2>Spending by category</h2><CategoryBars rows={dashboard.spending.byCategory} emptyText="No published expense transactions." /><button className="btn-secondary finance-panel-action" onClick={onTransactions}>Drill into transactions</button></section><section className="card finance-panel"><h2>Top payees</h2>{dashboard.spending.topVendors.length ? <div className="finance-ranked-list">{dashboard.spending.topVendors.map((vendor) => <div key={vendor.name}><span>{vendor.name}</span><strong>{money(vendor.amountCents)}</strong></div>)}</div> : <EmptyState>Payee detail appears after expenses are published.</EmptyState>}</section></div>;
}

function Income({ dashboard }) {
  return <section className="card finance-panel"><div className="finance-section-heading"><div><div className="finance-eyebrow">External income only</div><h2>Income sources</h2></div><span className="finance-status-pill">Transfers excluded</span></div><CategoryBars rows={dashboard.income.byCategory} emptyText="No published income transactions." /></section>;
}

function Comparison({ dashboard }) {
  const comparison = dashboard.yearOverYear;
  return <div className="finance-section-stack"><div className={`finance-alert ${comparison.prior.transactionCount ? "is-info" : "is-warning"}`}>{comparison.prior.transactionCount ? "Current results are compared with the same completed months in the prior reporting period. Projected values are not mixed into actual results." : "Prior-period transactions are not available. Changes remain withheld until both periods are loaded and published."}</div><div className="finance-metric-grid is-three"><MoneyMetric label="Current-period income" cents={comparison.current.externalIncomeCents} /><MoneyMetric label="Prior same-period income" cents={comparison.prior.externalIncomeCents} /><MoneyMetric label="Income change" cents={comparison.incomeChangeCents} tone={comparison.incomeChangeCents < 0 ? "danger" : "positive"} /><MoneyMetric label="Current-period expenses" cents={comparison.current.expensesCents} /><MoneyMetric label="Prior same-period expenses" cents={comparison.prior.expensesCents} /><MoneyMetric label="Expense change" cents={comparison.expenseChangeCents} tone={comparison.expenseChangeCents > 0 ? "danger" : "positive"} /></div><section className="card finance-panel"><h2>Largest category changes</h2>{comparison.prior.transactionCount && comparison.categoryChanges.length ? <div className="finance-ranked-list">{comparison.categoryChanges.slice(0, 10).map((row) => <div key={row.name}><span>{row.name}<small>{money(row.priorCents)} → {money(row.currentCents)}</small></span><strong className={row.changeCents > 0 ? "is-negative" : "is-positive"}>{row.changeCents > 0 ? "+" : ""}{money(row.changeCents)}</strong></div>)}</div> : <EmptyState>Two published reporting periods are needed for comparison.</EmptyState>}</section></div>;
}

function ReconciliationEditor({ item, documents, onSave, busy }) {
  const [opening, setOpening] = useState(item.balancesKnown ? centsInput(item.openingBalanceCents) : "");
  const [ending, setEnding] = useState(item.balancesKnown ? centsInput(item.statementEndingBalanceCents) : "");
  const [outstanding, setOutstanding] = useState(centsInput(item.outstandingItemsCents));
  const [documentId, setDocumentId] = useState(item.documentId || "");
  const [notes, setNotes] = useState(item.notes || "");
  async function save(status) {
    await onSave(item.statementMonth, { accountId: item.accountId, openingBalanceCents: parseCentsInput(opening), statementEndingBalanceCents: parseCentsInput(ending), outstandingItemsCents: parseCentsInput(outstanding), documentId, notes, status });
  }
  const balancesComplete = opening.trim() !== "" && ending.trim() !== "";
  return <details className="finance-recon-editor"><summary>{item.balancesKnown ? "Edit reconciliation" : "Add statement balances"}</summary>{!item.balancesKnown ? <div className="finance-alert is-info">Enter both balances from the official statement. Saving them clears the pending-balance flag but does not mark the month reconciled unless the difference is exactly $0.00.</div> : null}<div className="finance-form-grid"><label><span>Opening balance</span><input className="input" inputMode="decimal" placeholder="Required" value={opening} onChange={(event) => setOpening(event.target.value)} /></label><label><span>Statement ending</span><input className="input" inputMode="decimal" placeholder="Required" value={ending} onChange={(event) => setEnding(event.target.value)} /></label><label><span>Outstanding items</span><input className="input" inputMode="decimal" value={outstanding} onChange={(event) => setOutstanding(event.target.value)} /></label><label><span>Supporting document</span><select className="input" value={documentId} onChange={(event) => setDocumentId(event.target.value)}><option value="">None</option>{documents.filter((doc) => !doc.statementMonth || doc.statementMonth === item.statementMonth).map((doc) => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}</select></label><label className="is-wide"><span>Notes</span><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div><div className="finance-button-row"><button className="btn-secondary" disabled={busy || !balancesComplete} onClick={() => save("unreconciled")}>Save statement balances</button><button className="btn" disabled={busy || !balancesComplete} onClick={() => save("reconciled")}>Mark reconciled</button></div></details>;
}

function Reconciliation({ dashboard, isEditor, documents, onSave, onPublish, busy }) {
  if (!dashboard.reconciliations.length) return <EmptyState>No statement reconciliations have been imported for this reporting period.</EmptyState>;
  const byMonth = [...new Set(dashboard.reconciliations.map((item) => item.statementMonth))];
  return <div className="finance-section-stack">{byMonth.map((month) => { const items = dashboard.reconciliations.filter((item) => item.statementMonth === month); const hasPendingBalances = items.some((item) => !item.balancesKnown); const canPublish = items.every((item) => item.balancesKnown && item.status === "reconciled" && item.differenceCents === 0); const isPublished = items.every((item) => item.periodStatus === "published"); return <section className="card finance-panel" key={month}><div className="finance-section-heading"><div><div className="finance-eyebrow">{items[0].periodStatus}</div><h2>{monthLabel(month)}</h2></div><div className="finance-button-row"><span className={`finance-status-pill ${canPublish ? "is-good" : "is-warning"}`}>{canPublish ? "Reconciled" : hasPendingBalances ? "Balances pending" : "Unreconciled"}</span>{isEditor ? <button className="btn-secondary btn-sm" disabled={busy || (!isPublished && !canPublish)} onClick={() => onPublish(month, !isPublished)}>{isPublished ? "Unpublish" : "Publish"}</button> : null}</div></div><div className="finance-recon-grid">{items.map((item) => <article className="finance-recon-card" key={item.id}><h3>{item.accountName}</h3><dl><div><dt>Opening</dt><dd>{item.balancesKnown ? money(item.openingBalanceCents) : "Pending"}</dd></div><div><dt>Deposits</dt><dd>{money(item.depositsCents)}</dd></div><div><dt>Withdrawals</dt><dd>{money(item.withdrawalsCents)}</dd></div><div><dt>Transfers</dt><dd>{money(item.transfersCents)}</dd></div><div><dt>Outstanding</dt><dd>{money(item.outstandingItemsCents)}</dd></div><div><dt>Expected ending</dt><dd>{item.balancesKnown ? money(item.expectedEndingBalanceCents) : "Pending"}</dd></div><div><dt>Statement ending</dt><dd>{item.balancesKnown ? money(item.statementEndingBalanceCents) : "Pending"}</dd></div><div className="is-total"><dt>Difference</dt><dd className={item.balancesKnown ? (item.differenceCents === 0 ? "is-positive" : "is-negative") : ""}>{item.balancesKnown ? money(item.differenceCents) : "Pending"}</dd></div></dl>{!item.balancesKnown ? <div className="finance-alert is-warning">Statement balances pending — these transactions are imported but cannot be reconciled or published.</div> : item.status !== "reconciled" ? <div className="finance-alert is-warning">Preliminary — this account is not reconciled.</div> : null}{item.documentId ? <a className="btn-secondary btn-sm" href={`/api/board/finance/documents/${item.documentId}`} target="_blank" rel="noreferrer">View support</a> : null}{isEditor ? <ReconciliationEditor item={item} documents={documents} onSave={onSave} busy={busy} /> : null}</article>)}</div></section>; })}</div>;
}

function TransactionEditor({ transaction, categories, onSave, onClose, busy }) {
  const [form, setForm] = useState({ ...transaction, amount: centsInput(transaction.amountCents) });
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const matchingCategories = categories.filter((category) => category.classification === form.classification);
  return <div className="finance-modal" role="dialog" aria-modal="true" aria-label="Edit transaction"><div className="card finance-modal-card"><div className="finance-section-heading"><h2>Edit transaction</h2><button className="btn-secondary btn-sm" onClick={onClose}>Close</button></div><div className="finance-form-grid"><label><span>Date</span><input className="input" type="date" value={form.transactionDate} onChange={(event) => set("transactionDate", event.target.value)} /></label><label><span>Amount</span><input className="input" inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} /></label><label><span>Classification</span><select className="input" value={form.classification} onChange={(event) => { set("classification", event.target.value); set("categoryId", ""); }}><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select></label><label><span>Category</span><select className="input" value={form.categoryId} onChange={(event) => set("categoryId", event.target.value)}><option value="">Uncategorized</option>{matchingCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="is-wide"><span>Description / payee</span><input className="input" value={form.description} onChange={(event) => set("description", event.target.value)} /></label><label><span>Reconciliation</span><select className="input" value={form.reconciliationStatus} onChange={(event) => set("reconciliationStatus", event.target.value)}><option value="unreviewed">Unreviewed</option><option value="cleared">Cleared</option><option value="outstanding">Outstanding</option><option value="void">Void</option></select></label><label className="is-wide"><span>Notes</span><input className="input" value={form.notes} onChange={(event) => set("notes", event.target.value)} /></label></div><div className="finance-check-grid"><label><input type="checkbox" checked={form.isOneTime || form.isCapital} onChange={(event) => { const checked = event.target.checked; setForm((current) => ({ ...current, isOneTime: checked, isCapital: checked })); }} /> Capital project (used for insights only)</label><label><input type="checkbox" checked={form.isInternalTransfer} onChange={(event) => set("isInternalTransfer", event.target.checked)} /> Internal transfer</label><label><input type="checkbox" checked={form.isRestricted} onChange={(event) => set("isRestricted", event.target.checked)} /> Restricted</label></div><button className="btn" disabled={busy} onClick={() => onSave(transaction.id, { ...form, amountCents: parseCentsInput(form.amount) })}>{busy ? "Saving…" : "Save transaction"}</button></div></div>;
}

function Transactions({ rows, filters, setFilters, bootstrap, isEditor, onEdit, onExport, loading }) {
  return <div className="finance-section-stack"><section className="card finance-panel"><div className="finance-section-heading"><div><h2>Transactions</h2><p>Internal transfers remain visible but are excluded from income and expense totals.</p></div><button className="btn-secondary" onClick={onExport}>Export filtered CSV</button></div><div className="finance-filter-grid"><input className="input" type="search" placeholder="Search description or notes" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /><input className="input" type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} /><select className="input" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">All categories</option>{bootstrap.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select className="input" value={filters.classification} onChange={(event) => setFilters((current) => ({ ...current, classification: event.target.value }))}><option value="">All types</option><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select></div></section>{loading ? <LoadingCard text="Loading transactions…" /> : rows.length ? <div className="finance-transaction-list">{rows.map((transaction) => <article className="card finance-transaction-card" key={transaction.id}><div className="finance-transaction-top"><div><div className="finance-transaction-date">{transaction.transactionDate}</div><h3>{transaction.description}</h3></div><strong className={transaction.amountCents < 0 ? "is-negative" : "is-positive"}>{money(transaction.amountCents)}</strong></div><div className="finance-chip-row"><span>{transaction.classification}</span><span>{transaction.categoryName}</span>{transaction.accountName && transaction.accountName !== "Consolidated historical source" ? <span>{transaction.accountName}</span> : null}{transaction.isInternalTransfer ? <span>Internal transfer</span> : null}<span>{transaction.reconciliationStatus}</span></div><div className="finance-transaction-meta">Source: {transaction.sourceFilename || "Manual"}{transaction.sourceRow ? `, row ${transaction.sourceRow}` : ""} · {transaction.statementMonth} · {transaction.periodStatus}</div>{isEditor ? <button className="btn-secondary btn-sm" onClick={() => onEdit(transaction)}>Edit</button> : null}</article>)}</div> : <EmptyState>No transactions match these filters.</EmptyState>}</div>;
}

function ImportWorkflow({ bootstrap, imports, onComplete, busy, setBusy }) {
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const current = queue[queueIndex] || null;

  function selectFiles(fileList) {
    const entries = [...fileList].map((file) => {
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error(`${file.name}: choose a CSV or XLSX file.`);
      const statementMonth = inferImportMonth(file.name);
      const detectedFiscalYearId = fiscalYearForDate(`${statementMonth}-01`).id;
      if (!bootstrap.fiscalYears.some((year) => year.id === detectedFiscalYearId)) {
        throw new Error(`${file.name}: ${statementMonth} is outside the configured reporting periods.`);
      }
      return { file, statementMonth, fiscalYearId: detectedFiscalYearId };
    }).sort((left, right) => left.statementMonth.localeCompare(right.statementMonth) || left.file.name.localeCompare(right.file.name));
    setQueue(entries);
    setQueueIndex(0);
    setPreview(null);
    setConfirmed(false);
    setMessage(entries.length ? `${entries.length} monthly file${entries.length === 1 ? "" : "s"} queued in date order.` : "");
  }

  async function previewFile() {
    if (!current) throw new Error("Choose one or more monthly files.");
    setBusy(true); setMessage("");
    try {
      let rows;
      if (current.file.name.toLowerCase().endsWith(".csv")) rows = parseFinanceCsv(await current.file.text());
      else rows = parseBgslWorkbook(await readExcelFile(current.file));
      rows = validateImportRows(rows, { statementMonth: current.statementMonth, fiscalYearId: current.fiscalYearId });
      const sourceSha256 = await sha256Hex(await current.file.arrayBuffer());
      const data = await api("imports/preview", JsonRequest("POST", {
        fiscalYearId: current.fiscalYearId,
        statementMonth: current.statementMonth,
        sourceFilename: current.file.name,
        sourceSha256,
        openingBalanceCents: null,
        statementEndingBalanceCents: null,
        rows,
      }));
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
      const nextIndex = queueIndex + 1;
      const result = `Imported ${data.result.importedCount} rows from ${current.file.name}; ${data.result.skippedCount} skipped. Statement balances remain pending.`;
      setPreview(null); setConfirmed(false);
      if (nextIndex < queue.length) {
        setQueueIndex(nextIndex);
        setMessage(`${result} Ready for file ${nextIndex + 1} of ${queue.length}.`);
      } else {
        setQueue([]); setQueueIndex(0);
        setMessage(`${result} All queued files are complete.`);
      }
      await onComplete();
    } finally { setBusy(false); }
  }

  const categoryOptions = (classification) => bootstrap.categories.filter((category) => category.classification === classification);
  const fiscalYearLabel = current ? bootstrap.fiscalYears.find((year) => year.id === current.fiscalYearId)?.label : "";
  const importChecklists = bootstrap.fiscalYears.map((fiscalYear) => {
    const items = buildImportChecklist(fiscalYear, imports);
    return { fiscalYear, items, completed: items.filter((item) => item.imported).length };
  });
  return (
    <section className="card finance-panel">
      <div className="finance-section-heading"><div><div className="finance-eyebrow">Editor only</div><h2>Import monthly transactions</h2></div></div>
      <div className="finance-alert is-info">Select all monthly files at once. Month and reporting period are detected from each filename, and transactions are assigned to the system-managed consolidated historical source. No account or statement balances are required during import.</div>
      <div className="finance-import-checklist">
        <div className="finance-section-heading"><div><h3>Import checklist</h3><p>Confirmed monthly imports across all configured reporting periods</p></div></div>
        {importChecklists.map(({ fiscalYear, items, completed }) => <section className="finance-import-checklist-year" key={fiscalYear.id}>
          <div className="finance-import-checklist-year-heading"><strong>{fiscalYear.label}</strong><span>{completed} of {items.length} imported</span></div>
          <div className="finance-import-checklist-grid">{items.map((item) => <div className={`finance-import-checklist-item ${item.imported ? "is-imported" : ""}`} key={item.statementMonth}>
            <input type="checkbox" checked={item.imported} readOnly aria-label={`${monthLabel(item.statementMonth)} ${item.imported ? "imported" : "not imported"}`} />
            <span><strong>{monthLabel(item.statementMonth)}</strong><small>{item.sourceFilename || (item.status === "preview" ? "Preview started" : "No confirmed import")}{item.rowCount ? ` · ${item.rowCount} rows` : ""}</small></span>
            <em>{item.imported ? "Imported" : item.status === "preview" ? "Preview" : "Pending"}</em>
          </div>)}</div>
        </section>)}
      </div>
      <div className="finance-form-grid">
        <label className="is-wide"><span>Monthly CSV/XLSX files</span><input className="input finance-file-input" type="file" multiple accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { try { selectFiles(event.target.files || []); event.target.value = ""; } catch (error) { setQueue([]); setPreview(null); setMessage(error.message); } }} /></label>
        {current ? <><label><span>Detected month</span><input className="input" value={monthLabel(current.statementMonth)} disabled /></label><label><span>Detected reporting period</span><input className="input" value={fiscalYearLabel} disabled /></label></> : null}
      </div>
      {current ? <div className="finance-queue-status"><strong>File {queueIndex + 1} of {queue.length}</strong><span>{current.file.name}</span></div> : null}
      <button className="btn" disabled={busy || !current || Boolean(preview)} onClick={() => previewFile().catch((error) => setMessage(error.message))}>{busy ? "Parsing…" : "Parse and preview current file"}</button>
      {message ? <div className="finance-alert is-info">{message}</div> : null}
      {preview ? <div className="finance-import-preview">
        <div className="finance-metric-grid is-four">
          <Metric label="Rows" value={preview.rows.length} />
          <Metric label="Possible duplicates" value={preview.duplicateCount} tone={preview.duplicateCount ? "danger" : "positive"} />
          <Metric label="Statement balances" value="Pending" tone="muted" />
          <Metric label="Import account" value={preview.accountName} />
        </div>
        <div className="finance-alert is-warning">Possible duplicates are never discarded automatically. Every flagged row requires Include or Skip. This month remains unreconciled and unpublished until real statement balances are added later.</div>
        <div className="finance-import-rows">{preview.rows.map((row, index) => <article className={`finance-import-row ${row.errors.length || row.possibleDuplicate ? "has-warning" : ""}`} key={`${preview.batchId}-${row.sourceRow}-${index}`}>
          <div className="finance-transaction-top"><div><strong>Source row {row.sourceRow}</strong><h3>{row.description || "Missing description"}</h3></div><strong>{money(row.amountCents)}</strong></div>
          {row.errors.length ? <div className="finance-alert is-danger">{row.errors.join(" ")}</div> : null}
          <div className="finance-form-grid is-compact">
            <label><span>Date</span><input className="input" type="date" value={row.transactionDate} onChange={(event) => updateRow(index, { transactionDate: event.target.value, errors: [] })} /></label>
            <label><span>Signed amount</span><input className="input" inputMode="decimal" defaultValue={centsInput(row.amountCents)} onBlur={(event) => { try { updateRow(index, { amountCents: parseCentsInput(event.target.value), errors: [] }); } catch (error) { updateRow(index, { errors: [error.message] }); } }} /></label>
            <label><span>Classification</span><select className="input" value={row.classification} onChange={(event) => updateRow(index, { classification: event.target.value, categoryId: categoryOptions(event.target.value)[0]?.id || "", isInternalTransfer: event.target.value === "transfer" })}><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option></select></label>
            <label className="is-wide"><span>Raw description / payee</span><input className="input" value={row.description} onChange={(event) => updateRow(index, { description: event.target.value, errors: [] })} /></label>
            <label><span>Category</span><select className="input" value={row.categoryId} onChange={(event) => updateRow(index, { categoryId: event.target.value })}>{categoryOptions(row.classification).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label><span>Reconciliation</span><select className="input" value={row.reconciliationStatus} onChange={(event) => updateRow(index, { reconciliationStatus: event.target.value })}><option value="cleared">Cleared</option><option value="outstanding">Outstanding</option><option value="unreviewed">Unreviewed</option></select></label>
            {row.possibleDuplicate ? <label><span>Duplicate decision</span><select className="input" value={row.duplicateDecision} onChange={(event) => updateRow(index, { duplicateDecision: event.target.value })}><option value="">Review required</option><option value="include">Include anyway</option><option value="skip">Skip this row</option></select></label> : null}
          </div>
          <div className="finance-check-grid"><label><input type="checkbox" checked={row.isOneTime || row.isCapital} onChange={(event) => updateRow(index, { isOneTime: event.target.checked, isCapital: event.target.checked })} /> Capital project (used for insights only)</label><label><input type="checkbox" checked={row.isInternalTransfer} onChange={(event) => updateRow(index, { isInternalTransfer: event.target.checked, classification: event.target.checked ? "transfer" : row.classification, categoryId: event.target.checked ? "finance_transfer_internal" : row.categoryId })} /> Internal transfer</label><label><input type="checkbox" checked={row.isRestricted} onChange={(event) => updateRow(index, { isRestricted: event.target.checked })} /> Restricted</label></div>
        </article>)}</div>
        <label className="finance-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the transaction rows and every duplicate decision. I understand statement balances remain pending.</label>
        <button className="btn" disabled={busy || !confirmed || preview.rows.some((row) => row.errors.length || (row.possibleDuplicate && !row.duplicateDecision))} onClick={() => confirmImport().catch((error) => setMessage(error.message))}>Confirm import</button>
      </div> : null}
    </section>
  );
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
  return <div className="finance-section-stack"><div className="finance-subtabs"><button className={subtab === "imports" ? "is-active" : ""} onClick={() => setSubtab("imports")}>Imports</button><button className={subtab === "settings" ? "is-active" : ""} onClick={() => setSubtab("settings")}>Funds, obligations & forecast</button><button className={subtab === "audit" ? "is-active" : ""} onClick={() => setSubtab("audit")}>Audit history</button></div>{subtab === "imports" ? <><ImportWorkflow bootstrap={bootstrap} imports={admin.imports} onComplete={onRefresh} busy={busy} setBusy={setBusy} /><section className="card finance-panel"><h2>Import batches</h2>{admin.imports.length ? <div className="finance-ranked-list">{admin.imports.map((batch) => <div key={batch.id}><span>{batch.sourceFilename}<small>{monthLabel(batch.statementMonth)} · {batch.accountName} · {batch.status} · {batch.importedCount}/{batch.rowCount} rows · {batch.duplicateCount} duplicate warnings</small></span>{batch.status === "imported" ? <button className="btn-danger btn-sm" disabled={busy} onClick={() => rollback(batch.id)}>Roll back</button> : <strong>{batch.status}</strong>}</div>)}</div> : <EmptyState>No import batches yet.</EmptyState>}</section></> : null}{subtab === "settings" ? <SimpleAdminForms bootstrap={bootstrap} fiscalYearId={fiscalYearId} admin={admin} onMutate={mutate} busy={busy} /> : null}{subtab === "audit" ? <section className="card finance-panel"><h2>Import and edit audit history</h2>{admin.audit.length ? <div className="finance-audit-list">{admin.audit.map((event) => <article key={event.id}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.actor} · {new Date(event.createdAt).toLocaleString()}</span><small>{event.entityType}: {event.entityId}</small></article>)}</div> : <EmptyState>No audit events yet.</EmptyState>}</section> : null}</div>;
}

export default function BoardFinance() {
  const [authState, setAuthState] = useState("checking");
  const [bootstrap, setBootstrap] = useState(null);
  const [fiscalYearId, setFiscalYearId] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [admin, setAdmin] = useState(EMPTY_ADMIN);
  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState({ search: "", month: "", category: "", classification: "" });
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

  return <div className="finance-page"><header className="finance-page-header"><div><div className="finance-eyebrow">Board Member Area</div><h1>Financial dashboard</h1><p>Reconciled cash, reporting-period performance, transaction detail, and plain-language financial insights.</p></div><div className="finance-header-actions"><label><span>Reporting period</span><select className="input" value={fiscalYearId} onChange={(event) => setFiscalYearId(event.target.value)}>{bootstrap.fiscalYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select></label><span className={`finance-role-badge is-${bootstrap.session.role}`}>{isEditor ? "Finance editor" : "Board viewer"}</span><button className="btn-secondary" onClick={logout}>Sign out</button></div></header><nav className="finance-tabs" aria-label="Finance dashboard sections">{tabList.map(([id, label]) => <button key={id} className={activeTab === id ? "is-active" : ""} onClick={() => setActiveTab(id)}>{label}</button>)}</nav>{error ? <div className="finance-alert is-danger" role="alert"><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div> : null}{loading || !dashboard ? <LoadingCard /> : <main className="finance-content">{activeTab === "overview" ? <Overview dashboard={dashboard} /> : null}{activeTab === "cash-flow" ? <CashFlow dashboard={dashboard} /> : null}{activeTab === "spending" ? <Spending dashboard={dashboard} onTransactions={() => setActiveTab("transactions")} /> : null}{activeTab === "income" ? <Income dashboard={dashboard} /> : null}{activeTab === "comparison" ? <Comparison dashboard={dashboard} /> : null}{activeTab === "ai" ? <AiInsights key={`${dashboard.fiscalYear.id}-${dashboard.ai?.availableMonths?.at(-1) || "empty"}`} dashboard={dashboard} fiscalYearId={fiscalYearId} /> : null}{activeTab === "reconciliation" ? <Reconciliation dashboard={dashboard} isEditor={isEditor} documents={admin.documents} onSave={saveReconciliation} onPublish={publish} busy={busy} /> : null}{activeTab === "transactions" ? <Transactions rows={transactions} filters={filters} setFilters={setFilters} bootstrap={bootstrap} isEditor={isEditor} onEdit={setEditingTransaction} onExport={exportCsv} loading={transactionsLoading} /> : null}{activeTab === "admin" && isEditor ? <FinanceAdmin bootstrap={bootstrap} fiscalYearId={fiscalYearId} admin={admin} onRefresh={loadFinance} busy={busy} setBusy={setBusy} /> : null}</main>}{editingTransaction ? <TransactionEditor transaction={editingTransaction} categories={bootstrap.categories} onSave={saveTransaction} onClose={() => setEditingTransaction(null)} busy={busy} /> : null}</div>;
}
