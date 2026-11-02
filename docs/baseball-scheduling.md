# Barrington Little League scheduling

The standalone page at `/baseball` copies the BGSL scheduler with Majors, Minors,
and Tee Ball fields, a separate single-bubble calendar, and two-hour reservations. It has its own branding, session
storage keys, `/api/baseball/` routes, and `baseball_` database tables. The original
BGSL source and tables are not modified. Only the former hello-world page is
replaced.

## Access and initial setup

There are two views: **Schedule & Requests** and **Admin**. The schedule, PDF export,
request form, and request history are available without login. Requests always
need admin approval. A browser keeps a random requester token locally so only
that browser can cancel its own pending requests; the token is never published.

1. Open `/baseball#admin`. For initial setup, the site owner can use the existing
   site administrator key. Do not share the BGSL key with the baseball scheduler.
2. Expand **Admin Password, Teams & Imports** and set a separate Little League
   admin password. It authorizes both approvals and setup, with no board or coach
   login. A previously configured baseball board password remains usable as the
   admin password; the legacy database column is retained to preserve data.
3. Add baseball teams. CSV imports support `major`, `minor`, `tee-ball`, and `bubble`.
4. The admin can optionally set their own email alert destination. No BGSL
   notification recipient, password, team, or reservation is copied.

All baseball tables and the request ownership column are initialized in the
existing Cloudflare D1 `DB` binding, without altering BGSL tables. Email alerts
reuse the configured Mailgun transport and are disabled until a baseball
notification recipient is explicitly saved.

## Development and deployment

### Demonstration schedule

The one-time `bll-sample-20261102-30days-v1` seed creates Barrington 6U, 8U, 10U,
12U, and 14U teams and up to 65 clearly labeled sample reservations for
November 2 through December 1, 2026: 45 practices and 20 fictional games against
nearby towns. It runs transactionally when the baseball schedule is first read,
skips occupied field times, sends no alerts, and never changes existing rows.
The completion marker prevents later page loads from duplicating events or
recreating samples deleted by the admin. `BASEBALL_SAMPLE_DATA=off` skips seeding
in test or other environments. The Field/Bubble switch selects either the three-field calendar or the single-column
bubble calendar. Bubble bookings use the same dated reservations, approvals,
cancellations, conflict checks, and PDF export; field and bubble entries are
scoped separately. Legacy standing-bubble notes remain stored but are not used
as calendar bookings. Compact cards abbreviate team/title and whole-hour times;
tapping a card reveals complete details. Approved status badges remain visible.

### Build

Run `npm ci`, then `node scripts/build-baseball.mjs` after changing baseball client
source. Commit the generated `public/baseball.html` and `public/baseball/app-*`
assets with the source. The existing `npm run build` copies these public assets;
no existing build configuration or package scripts are changed.

`npm test` includes the baseball isolation and workflow tests. End-to-end local API
testing uses Cloudflare Pages with a local D1 binding; Vite alone does not serve
Pages Functions.

The header logo is an image-generated cartoon of the three supplied Barrington
baseball caps. The page uses muted mustard yellow and royal blue lettering.
