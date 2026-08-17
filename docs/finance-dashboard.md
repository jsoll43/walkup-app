# BGSL finance dashboard runbook

## Architecture and security model

The finance experience extends the existing application at `/board/finance`; it is not a separate app. Every API is under `/api/board/finance/*` and validates authorization in the Pages Function.

- Board viewers authenticate with the existing server-side Board Scheduling password hash and receive a short-lived `HttpOnly`, `SameSite=Strict` finance cookie. They can only use read APIs.
- Finance editors authenticate with `FINANCE_EDITOR_KEY`; the existing `ADMIN_KEY` is accepted as an administrator fallback. The key is exchanged once for the same HttpOnly session and is never stored in `sessionStorage`.
- Mutation requests require an editor session and same-origin request. Imports, transaction edits, reconciliation, publishing, funds, commitments, reserve changes, mappings, forecasts, documents, and rollbacks are enforced on the server.
- `FINANCE_LOCAL_AUTH_BYPASS=true` only works for requests whose hostname is exactly `localhost` or `127.0.0.1`. It defaults off. Never configure it in Cloudflare.
- Supporting documents use a private R2 binding named `FINANCE_DOCUMENTS`. Only authenticated API streaming is available; object keys and R2 URLs are never returned.
- Accounts store a display name and optional last four digits. Do not enter full account or routing numbers in any field.
- All stored monetary values are integer cents. Fiscal years always run October 1 through September 30.
- Internal transfers are visible but excluded from league-wide income, expenses, and results.
- A manually entered ending balance never reconciles a month. Reconciliation requires a zero calculated difference and no unreviewed transactions. Publishing requires every account in the month to be reconciled.
- Historical transaction backfills do not require an account or statement balances at import time. The server assigns them to `Consolidated historical source`; balances remain explicitly pending and cannot contribute to cash, reconciliation, or publication until an editor enters both official statement balances.
- Version 1 insights are exact calculations and templates. No AI binding or paid SaaS is used.

## Repository files and local data

Place source workbooks and statements under:

```text
private/finance-source/
```

The entire `private/` directory and `.dev.vars*` are excluded by `.gitignore`. The local analyzer writes normalized intermediates and its discrepancy report under `private/finance-analysis/`; none of these files should be committed.

The current supplied inventory is 23 XLSX files: 21 monthly workbooks from October 2024 through June 2026 and two annual workbooks. No CSV or PDF statements were supplied.

## Install and verify

```sh
npm install
npm test
npm run lint
npm run build
npm run finance:analyze
```

`npm run finance:analyze` reads only each monthly workbook's underlying `Transactions` sheet. It does not trust workbook Summary sheets and does not add balancing transactions. The detailed local result is:

```text
private/finance-analysis/reconciliation-report.json
```

## D1 migration commands

There was no checked-in Wrangler configuration when finance was added. Substitute the name of the D1 database already bound to the Pages project as `DB`.

Apply to a local Wrangler D1 database:

```sh
npx wrangler d1 execute YOUR_D1_DATABASE --local --file=./migrations/0008_finance.sql
npx wrangler d1 execute YOUR_D1_DATABASE --local --file=./migrations/0009_finance_backfill.sql
```

Inspect the local schema:

```sh
npx wrangler d1 execute YOUR_D1_DATABASE --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'finance_%' ORDER BY name"
```

After reviewing the local result, apply to the existing remote D1 database:

```sh
npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=./migrations/0008_finance.sql
npx wrangler d1 execute YOUR_D1_DATABASE --remote --file=./migrations/0009_finance_backfill.sql
```

If `0008_finance.sql` is already applied, run only `0009_finance_backfill.sql`. Migration 0009 adds the system-managed historical import account and pending-statement-balance state; it does not modify or delete existing transactions.

The migration is additive and uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `INSERT OR IGNORE`. It never inserts validation controls as transactions. Current Wrangler syntax is documented in [Cloudflare's D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/).

Applying a remote migration changes production data. It is separate from deploying the Pages application and should be run only after approval and backup review.

## End-to-end local Pages development

Build the client, apply the local migration, then run the static output and Functions together:

```sh
npm run build
npx wrangler pages dev dist --d1 DB=YOUR_D1_DATABASE_ID --r2=FINANCE_DOCUMENTS --binding=FINANCE_EDITOR_KEY=CHOOSE_A_LOCAL_ONLY_EDITOR_KEY
```

Wrangler normally serves this at `http://localhost:8788`. Cloudflare documents the current binding flags in [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/) and local Pages execution in [Pages local development](https://developers.cloudflare.com/pages/functions/local-development/).

The recommended local path is to sign in as a finance editor using the local-only editor key. If a bypass is genuinely needed, it must be explicit:

```sh
npx wrangler pages dev dist --d1 DB=YOUR_D1_DATABASE_ID --r2=FINANCE_DOCUMENTS --binding=FINANCE_LOCAL_AUTH_BYPASS=true --binding=FINANCE_LOCAL_AUTH_ROLE=editor
```

Do not use either `FINANCE_LOCAL_AUTH_BYPASS` setting in preview or production.

## Import workflow

1. Open `/board/finance`, sign in as Finance editor, and open **Finance administration → Imports**.
2. Select any number of monthly CSV/XLSX files at once. Each filename must contain exactly one month and year; annual/multi-month workbooks are rejected.
3. The queue is sorted chronologically. The app detects each statement month and October–September fiscal year from the filename. No account or balance selection is required.
4. Select **Parse and preview current file**. XLSX parsing happens in the browser; workbook Summary sheets are ignored.
5. Review every row. Correct dates, signed amounts, descriptions, normalized categories, reconciliation status, and one-time/internal-transfer/restricted flags.
6. Resolve every duplicate warning with an explicit **Include anyway** or **Skip this row** decision. A fingerprint uses the consolidated historical account, date, signed cents, and normalized description.
7. Confirm the import and continue through the queue. Each batch is saved under `Consolidated historical source` with statement balances explicitly pending.
8. When a statement becomes available, open **Reconciliation → Add statement balances**, enter both official balances, and optionally attach its protected supporting document.
9. A month can be marked reconciled only at a $0.00 difference with every transaction reviewed. Pending balances cannot be reconciled or published.
10. Publish only after the month is reconciled. Board viewers see transaction actuals only from published months.

Imported batches can be rolled back. Rollback soft-deletes the batch's transactions, marks the reconciliation incomplete, unpublishes the month, and writes an audit event.

### Supplied workbook validation result

Raw workbook transaction rows currently produce:

| Period | Source income | Source expenses | Source net | Control result |
| --- | ---: | ---: | ---: | --- |
| FY 2024–25 | $34,878.05 | $45,017.86 | −$10,139.81 | Income is $95.65 low; expenses are $100.00 low |
| FY 2025–26 through June | $32,847.54 | $25,957.25 | $6,890.29 | Before the known February and May statement corrections |

The FY 2025–26 statement-backed corrections exactly reconcile the annual controls as a validation scenario: February external income −$274.35 and May expenses +$595.19 produce income $32,573.19, expenses $26,552.44, and net $6,020.75. They are not inserted as balancing entries. The February source rows must be corrected/reviewed, and May still requires the seven actual missing statement withdrawals.

FY 2024–25's $14,975 landscape transaction is detected as one-time/capital. The $95.65 income difference traces to two invalid April source rows (one malformed year and one amount with three decimal places). The $100 expense difference traces to a March row without a valid date. If those source rows are resolved from statements, annual income and expense controls match, but the beginning-cash/activity/ending-cash roll-forward still has an unresolved $50.99 difference. At least $3,318 of snack-stand cash also lacks a clear deposit trail.

Seven fingerprint groups are flagged across the workbooks. A fingerprint match is only a warning because same-day equal sponsorships or purchases may be legitimate. No group is silently removed.

## Required Cloudflare dashboard configuration

In **Workers & Pages → the existing BGSL Pages project** configure both Preview and Production as appropriate:

1. Confirm the existing D1 database binding is named exactly `DB`.
2. Create or select a private R2 bucket for finance documents and add an R2 binding named exactly `FINANCE_DOCUMENTS`. Do not enable a public bucket domain.
3. Under **Settings → Variables and Secrets**, add secret `FINANCE_EDITOR_KEY` with a strong unique value. Do not put it in source or a plain environment variable. Existing `ADMIN_KEY` remains an accepted administrator fallback.
4. Confirm the existing Board Scheduling password is configured from the Admin scheduling section. Replace weak/shared values with a strong Board-only password.
5. Do not configure `FINANCE_LOCAL_AUTH_BYPASS` in Cloudflare.
6. Redeploy is required for new bindings/secrets to reach Pages Functions. Deployment is not performed by these implementation steps.

Cloudflare's current dashboard binding steps are in [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/).

## Cloudflare Access: required production defense in depth

The app-level session remains mandatory. Add Cloudflare Access so every Board member first authenticates with an individual email identity.

1. Go to **Zero Trust → Access controls → Applications → Create new application → Self-hosted and private**.
2. Add the production hostname and protect all four paths below. The exact path and its children are listed separately because a trailing wildcard does not cover the parent path:

   - `bgslwalkup.com/board/finance`
   - `bgslwalkup.com/board/finance/*`
   - `bgslwalkup.com/api/board/finance`
   - `bgslwalkup.com/api/board/finance/*`

3. Add an **Allow** policy whose Include selector is **Emails**, listing each current Board member individually. Avoid a public email-domain allow rule.
4. Add explicit Block/Exclude rules as appropriate and use a short Access session duration, such as eight hours.
5. Test an allowed Board email, a non-Board email, the page route, an API route, logout, and session expiry in Preview before production.
6. Repeat/review the policy whenever Board membership changes.

Access is deny-by-default for users who do not match an Allow policy. Cloudflare documents path matching in [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/), self-hosted application setup in [Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), and individual email selectors in [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

When Access is active, the app records Cloudflare's authenticated email header as the finance audit actor after the user also completes app sign-in. The header alone is not accepted as finance authorization.

## Operational checks before any production release

- `npm test`, `npm run lint`, and `npm run build` pass.
- Test unauthenticated finance API requests return `401`.
- Test a Board viewer can read but receives `403` on mutations.
- Test an editor import cannot confirm with unresolved duplicate decisions or invalid rows.
- Test a historical import requires neither an account selection nor placeholder statement balances and remains explicitly pending.
- Test a nonzero reconciliation difference cannot be marked reconciled.
- Test an unreconciled month cannot be published.
- Inspect phone and desktop widths for overflow, charts, forms, modals, reconciliation cards, and transaction cards.
- Confirm `_headers` reaches `/board/finance*` and API responses remain `no-store`.
- Confirm raw source files, local reports, secrets, and full account/routing numbers are absent from `git status` and `git ls-files`.
- Back up/review D1 before the remote migration.
- Obtain explicit approval before a production deployment.
