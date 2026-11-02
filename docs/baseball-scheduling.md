# Barrington Little League scheduling

The standalone page at `/baseball` copies the BGSL scheduler with Majors, Minors,
and Tee Ball fields and two-hour reservations. It has its own branding, session
storage keys, `/api/baseball/` routes, and `baseball_` database tables. The original
BGSL source and tables are not modified. Only the former hello-world page is
replaced.

## Initial setup

1. Open `/baseball#admin` and log in using the site's existing administrator key.
   This key is for the site owner; do not distribute it to baseball users.
2. Set the separate Little League coach and board scheduling passwords.
3. Add baseball teams. CSV imports support `major`, `minor`, and `tee-ball` fields.
4. Coaches and board members log in at `/baseball` using those new passwords.
5. Board members can optionally set their own email alert destination. No BGSL
   notification recipient, password, team, or reservation is copied.

The new tables are created on first authenticated administrator use in the existing
Cloudflare D1 `DB` binding. Email alerts reuse the configured Mailgun transport and
are disabled until a baseball board notification recipient is explicitly saved.

## Development and deployment

Run `npm ci`, then `node scripts/build-baseball.mjs` after changing baseball client
source. Commit the generated `public/baseball.html` and `public/baseball/app-*`
assets with the source. The existing `npm run build` copies these public assets;
no existing build configuration or package scripts are changed.

`npm test` includes the baseball isolation and workflow tests. End-to-end local API
testing uses Cloudflare Pages with a local D1 binding; Vite alone does not serve
Pages Functions.

The SVG logo is a vector interpretation of the lowercase b on the supplied
Barrington baseball caps, using blue, red, and white.
