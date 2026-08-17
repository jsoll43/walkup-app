# BGSL Walk-up and Board Operations

The existing BGSL React/Vite application runs on Cloudflare Pages with Pages Functions, D1, and R2. It includes parent recording, coach playback, field scheduling, administration, archives, and the protected Board finance dashboard at `/board/finance`.

## Development

```sh
npm install
npm test
npm run lint
npm run build
```

Vite alone serves the client but does not run Pages Functions. Use Wrangler Pages development for end-to-end API testing; see [Finance dashboard setup](docs/finance-dashboard.md).

## Finance security

Raw finance files belong only under `private/`, which is excluded from git. Never commit bank statements, transaction exports, generated finance analysis, `.dev.vars`, secrets, account numbers, or routing numbers.

The finance API uses a short-lived HttpOnly session, enforces viewer/editor authorization on the server, and never exposes an R2 object key or public object URL. Cloudflare Access should additionally protect both the finance page and API in production.

Full setup, migration, import, reconciliation, Access, and troubleshooting instructions are in [docs/finance-dashboard.md](docs/finance-dashboard.md).
