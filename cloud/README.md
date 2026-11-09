# Hosted watchlist

Cloudflare Pages frontend + Functions API + D1.

- `public/` — static UI
- `functions/api/` — auth, opportunities, watchlist, subscribe, health, admin
- `migrations/0001_init.sql` — D1 schema

## Deploy

```bash
npx wrangler d1 execute scholarship-watchlist --remote --file migrations/0001_init.sql
npx wrangler pages deploy public --project-name scholarship
```

## Secrets

Set these on the Pages project:

```bash
npx wrangler pages secret put SESSION_SECRET --project-name scholarship
npx wrangler pages secret put SITE_ACCESS_CODE --project-name scholarship
npx wrangler pages secret put ADMIN_SECRET --project-name scholarship
```

## Data

From the repository root, after a watcher run:

```bash
npm run publish:cloud
```

`PUBLISH_CLOUD=true` in the local `.env` also publishes after every successful run.
