# Scholarship Watcher

i built this so i stop refreshing twenty tabs every morning. it watches the usual scholarship portals, drops anything that wants a fee, and emails me a short list with deadlines and event dates. it runs locally; the only account it touches is a burner instagram.

a local daily watcher for **fully funded** scholarships, fellowships, conferences and youth summits. It reads the portals that feed the big Instagram accounts, rejects paid/self-funded programs and anything that mentions an application or registration fee, extracts deadlines and event dates, and emails you one short digest per day.

The scraper runs on your own machine. The optional hosted watchlist is a Cloudflare Pages site. No dashboard subscription, no analytics.

```text
Scholarship Watcher · 4 new fully funded · 2 closing soon · 9 Nov
```

## What it actually does

1. **Fetches** 14 web/Telegram sources plus 10 Instagram channels: RSS feeds, public Telegram previews, listing pages with no feed, and authenticated Instagram profile grids.
2. **Reads the article or caption**, not just the headline, so fee and deadline language is visible.
3. **Applies two strict questions**: is it explicitly fully funded? is there any fee?
4. **Drops** self-funded, partially funded, unfunded, expired, and fee-charging programs.
5. **Deduplicates** the same program arriving from several aggregators.
6. **Extracts the application deadline and the event/program dates** (not the other way around) and groups the digest:
   - Apply today or tomorrow
   - Closing this week
   - New today
   - Still open from the last 10 days
7. **Emails you** via SMTP or Resend. If email is not configured yet, it writes the digest to `data/digests/` and prints it.
8. **Runs daily** through macOS `launchd` or Linux `cron`.
9. **Shows everything in a local dashboard** at `http://127.0.0.1:8787`: live source health, email status, next-run countdown, deadline countdowns and filters.

## The filter is deliberately strict

Kept only when the page says things like *fully funded*, *fully sponsored*, *100% funded*, *all expenses paid*, or *fully covered*, **and** no application / registration / participation / program / processing fee is mentioned.

Rejected or held back:

| Signal | Result |
| --- | --- |
| Self-funded, partially funded, unfunded, pay your own way | Rejected |
| Any application / registration / participation / program fee | Rejected |
| Fee waiver available (fee still exists) | Rejected |
| "A few fully funded seats, the rest self-funded" | `review` — excluded from the email |
| Roundup / listicle ("Top 10 scholarships…") | `review` — pick one manually |
| Funding level not stated | `review` — excluded from the email |
| Deadline already passed | Expired |
| Deadline within 1 day | Apply today section |
| Deadline within 7 days | Closing this week section |

The classifier runs on keywords and a few negation rules. It is intentionally conservative: **the absence of a fee mention is treated as no fee**, which is why every email ends with a verification checklist. Always confirm on the official host domain before applying. This is a discovery tool, not a guarantee.

## Quick start

Requirements: Node.js **20+** and `git`. Optional: **Google Chrome** for the Instagram sources, and the `opencode` CLI for AI-assisted verification.

```bash
git clone https://github.com/Concorde002/scholarship-watcher.git
cd scholarship-watcher
npm install
npm run preview
npm run instagram:login   # optional, once, for the 8 Instagram channels
npm run dashboard         # starts http://127.0.0.1:8787
```

`npm run preview` fetches everything, prints the digest, writes HTML/Markdown to `data/digests/`, and changes no state. It does **not** send email.

If you run the watcher before configuring email, it prints and archives the digest but **does not advance state**, so the backlog is still there for your first real email. Set `SAVE_WITHOUT_EMAIL=true` if you want a local-only archive that advances state.

Then run the setup wizard:

```bash
npm run setup
```

It asks for:

- the email address that should receive the digest,
- Gmail SMTP (recommended), another SMTP server, Resend, or local-only mode,
- the daily run time,
- whether to enable optional AI verification,
- whether to install the schedule and send a test email.

Everything is stored in `.env` with mode `600`. The file is gitignored.

### Gmail

Gmail requires an **App Password**, not your normal password:

1. Turn on 2-Step Verification.
2. Open <https://myaccount.google.com/apppasswords>.
3. Create an app password for "Mail".
4. Paste it into `npm run setup` (input is hidden).

## Instagram (optional, one-time login)

Instagram now requires a logged-in session to read profile pages. Log in once with a burner account:

```bash
npm run instagram:login
```

- Opens a real Chrome window. Enter the password, then the WhatsApp/email code if 2FA is enabled. Tick **“Trust this device”** so daily runs skip 2FA.
- The command waits up to five minutes for you to finish the code or a security challenge, then verifies the session against a live profile.
- Only the browser session is stored, under `data/instagram/` (mode `700`, gitignored). The password is never written to disk or committed.
- Daily runs reuse that session headlessly. It reads the 12 most recent posts per handle, one profile at a time, with a 2–4 second delay.
- Captions are parsed for funding, fees, deadlines and application links. Short links such as `opd.to` and Instagram’s link-in-bio redirects are resolved.
- Check or repair the session anytime:

```bash
npm run instagram:status
npm run instagram:login
```

- Requires **Google Chrome**. Set `IG_HEADED=1` to watch the daily browser.
- Personal use only. Automated access can get an account rate-limited or challenged, which is why a burner is recommended.

Handles watched: `@yopportunities`, `@opportunities_corners`, `@opportunitydesk`, `@scholarshipscorner`, `@opportunitiescircleofficial`, `@oya_opportunity`, `@fellowships.guide`, `@glornoscholarships`, `@opportunitiesforafricans`, `@afterschoolafrica`.

Two handles from the original directory (`@opportunitiescircle`, `@oyaopportunities`) return “page isn’t available”. The live handles are pulled from the parent websites and used above.

## Local dashboard

```bash
npm run dashboard
```

Then open <http://127.0.0.1:8787>. It binds to `127.0.0.1` only.

What is on it:

- every open opportunity with a live deadline countdown
- event/program dates (`When:`), separate from the application deadline
- search, source, deadline and sort filters
- watcher health: last run, duration, next-run countdown, email delivery, Instagram session
- every source shown as **live**, **failed**, **skipped** or **disabled**, with item counts, timing and the actual error
- a link to the latest digest

The server reads `data/opportunities.json` and `data/status.json` on every request, so it updates after each run. Change the port with:

```bash
DASHBOARD_PORT=8788 npm run dashboard
```

`npm run dashboard -- --open` opens the browser automatically. There is no auth because it only listens on localhost.

## Hosted watchlist (Cloudflare Pages)

**Live:** <https://scholarship-by0.pages.dev>

`scholarship.pages.dev` was already taken by another Cloudflare account, so Cloudflare assigned the `-by0` subdomain to this project. A custom domain can replace it later.

What is there:

- private access code + email login
- hard cap of **10 people**
- saved watchlist stored in D1, not browser localStorage
- rate limits on login, opportunities, watchlist changes, subscriptions and imports
- email-list signup (the subscriber list is stored in D1)
- signed HttpOnly session cookie, 30 days
- all opportunity data behind the auth API; the static files contain no data

The access code is not in this repo. Set/rotate it with:

```bash
cd cloud
npx wrangler pages secret put SITE_ACCESS_CODE --project-name scholarship
```

The local watcher publishes into the site after a successful run when `PUBLISH_CLOUD=true` is set in `.env`:

```bash
npm run run            # fetch, email, save state, publish
npm run publish:cloud  # publish the current store without a run
```

The mailing list can receive the latest delivered digest:

```bash
npm run mail:list -- --dry-run
npm run mail:list
```

Set `MAIL_SUBSCRIBERS=true` in `.env` to send that digest to hosted subscribers automatically after each successful run. The owner address is skipped.

### Architecture and limits

- `cloud/public` — Pages frontend
- `cloud/functions` — Pages Functions API
- Cloudflare D1 — users, sessions' watchlists, subscribers, opportunities, rate limits
- local watcher — RSS/Telegram/HTML/Instagram + opencode AI + SMTP
- `npm run publish:cloud` — authenticated import into D1

**`opencode` does not run on Cloudflare Pages.** Pages Functions have no shell, no long-running process, no Chrome and no Playwright. The AI/Instagram/SMTP work stays on the machine running the watcher. If that machine is asleep, the hosted site keeps serving the last published data but does not refresh.

For fully cloud-side scraping, use a always-on Node host (VPS, Fly.io, Render, Railway) where Playwright and `opencode` can run, then publish to Pages. Cloudflare Workers cron can do RSS/Telegram/HTML, but not Playwright or the `opencode` CLI; that would need an HTTP model API instead.

Deploy cloud changes with:

```bash
cd cloud
npx wrangler pages deploy public --project-name scholarship
```

Apply D1 migrations with:

```bash
npx wrangler d1 execute scholarship-watchlist --remote --file cloud/migrations/0001_init.sql
```

Export the mailing list (admin secret comes from `.env` or Cloudflare):

```bash
curl -H "x-admin-secret: $CLOUD_ADMIN_SECRET" \
  https://scholarship-by0.pages.dev/api/admin/subscribers
```

## Daily schedule

```bash
npm run schedule -- --time 08:00     # install / update
npm run schedule -- --status         # is it installed?
npm run schedule -- --remove         # remove it
```

- **macOS:** writes `~/Library/LaunchAgents/com.scholarshipwatcher.daily.plist` and loads it with `launchctl`. Runs in your GUI session, so Keychain/network access works.
- **Linux:** adds a marked line to your user crontab.
- **Windows:** use Task Scheduler with `node C:\path\to\scholarship-watcher\src\index.js run`.

Logs:

```text
data/logs/launchd.out.log
data/logs/launchd.err.log
```

Run it immediately without waiting for the schedule:

```bash
launchctl kickstart -k gui/$(id -u)/com.scholarshipwatcher.daily
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run run` | Real run: fetch, filter, email, save state |
| `npm run preview` | Dry run, no email, no state, prints digest |
| `npm run setup` | Interactive email + schedule wizard |
| `npm run instagram:login` | One-time Instagram login (burner recommended) |
| `npm run instagram:status` | Verify the saved Instagram session |
| `npm run dashboard` | Local dashboard on `http://127.0.0.1:8787` |
| `npm run publish:cloud` | Push the current store to the hosted watchlist |
| `npm run mail:list -- --dry-run` | Preview sending the latest digest to subscribers |
| `npm run check-sources` | Test every enabled source and show item counts |
| `npm run test-email` | Send a delivery test |
| `npm run schedule -- --time 07:30` | Install or update the daily job |
| `npm test` | Unit tests for the filter, deadlines, feeds and digest |

Useful flags:

```bash
node src/index.js run --dry-run          # same as npm run preview
node src/index.js run --no-save          # send, but do not mark items as seen
node src/index.js run --limit 20         # only process the 20 newest unseen posts
node src/index.js run --llm              # enable AI verification for this run
node src/index.js run --verbose          # per-source and per-item detail
```

## Sources

| Source | Type | Notes |
| --- | --- | --- |
| Opportunities Corners | RSS | Aggregator |
| Opportunity Desk | RSS | Aggregator |
| Scholarships Corner | RSS | Aggregator |
| Opportunities Circle | RSS | Aggregator |
| OYA Opportunities | RSS | Aggregator |
| Scholars4Dev | RSS | Academic scholarships |
| Opportunities for Africans | RSS | Aggregator |
| One Young World | HTML | Official scholarship page |
| Lindau Nobel Laureate Meetings | RSS | Official |
| MCW Global | RSS | Official fellowship |
| Scholarships Corner | Telegram | Public channel preview, `@scholarshipscorner` |
| Opportunities Corners | Telegram | Public channel preview, `@opcorners` |
| Opportunities Circle | Telegram | Public channel preview, `@opportunitiescircleofficial` |
| Scholarship Region | Telegram | Public channel preview, `@scholarshipregion` |
| Youth Opportunities | Instagram | Authenticated profile grid |
| Opportunities Corners | Instagram | Authenticated profile grid |
| Opportunity Desk | Instagram | Authenticated profile grid |
| Scholarships Corner | Instagram | Authenticated profile grid |
| Opportunities Circle | Instagram | Authenticated profile grid |
| OYA Opportunities | Instagram | Authenticated profile grid |
| Fellowships Guide | Instagram | Authenticated profile grid |
| Glorno Scholarships | Instagram | Authenticated profile grid |
| Opportunities for Africans | Instagram | Authenticated profile grid |
| After School Africa | Instagram | Authenticated profile grid |

**Instagram mode needs the one-time login above.** It reads the public profile grid of the burner account’s session, not the private inbox or DMs. Public Telegram previews (`t.me/s/<channel>`) require **no Telegram account**: the watcher reads the public preview pages every run. Two handles from the original directory were dead and were replaced with the handles published on the parent websites.

Some sources are present in `config/sources.json` but disabled with a note:

- **ProFellow** — Cloudflare returns HTTP 403 to non-browser clients.
- **ARMACAD** — no feed, public homepage currently lists stale calls.
- **For9a** — Arabic-language feed; the English classifier would drop most items.
- **EURAXESS** — no public RSS; search page is JavaScript-rendered.
- **Youth Opportunities · website** — the HTML conference/scholarship pages sit behind Cloudflare and usually time out from Node. The `@yopportunities` Instagram source is enabled and covers the same posts.
- **Youth Opportunities · Telegram** — `youthop.com` does not link an official Telegram channel, and `@youthopportunities` is an unrelated Yemeni channel, so it is disabled instead of parsing the wrong feed.
- **Falling Walls, HPAIR, World Youth Forum, Hansen Leadership Institute** — no reliable opportunities feed, so they are covered indirectly through the aggregators. Their official pages remain on the digest's permanent watchlist for empty days.

Youth Opportunities times out from some networks (the site sits behind Cloudflare). The watcher logs the failure, keeps going, and returns results on later runs.

## Configuration

### `config/sources.json`

```json
{
  "id": "my-source",
  "name": "My Source",
  "type": "rss",
  "url": "https://example.com/feed",
  "enabled": true
}
```

Types:

- `rss` — RSS 2.0 or Atom feed.
- `telegram` — public channel preview; set `channel` to the handle.
- `html` — listing page; set `linkPattern` (regex on the URL) and optionally `excludePattern`, `titleMin`, `maxItems`.
- `instagram` — authenticated profile grid; set `handle` and optionally `maxItems` (default 12). Requires `npm run instagram:login`.

Set `"enabled": false` to keep a source documented without fetching it. `npm run check-sources` shows every enabled source plus a reminder for disabled ones.

### `.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `DIGEST_TO` | — | Destination email |
| `MAIL_FROM` | `SMTP_USER` | From header |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | — / `465` / `true` | SMTP server |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP credentials |
| `RESEND_API_KEY` | — | Use Resend instead of SMTP |
| `SCHEDULE_TIME` | `08:00` | Time used by `npm run schedule` |
| `SEND_EMPTY` | `true` | Send a short digest even when nothing matched |
| `SAVE_WITHOUT_EMAIL` | `false` | Advance state when no email is configured (local-only mode) |
| `MAX_AGE_DAYS` | `60` | Ignore feed items older than this |
| `ENRICH_LIMIT` | `30` | How many article pages to read per run |
| `USE_LLM` | `false` | Optional opencode AI verification |
| `OPENCODE_MODEL` | CLI default | e.g. `provider/model` |
| `OPENCODE_BIN` | `opencode` | Path to the CLI |
| `LLM_LIMIT` | `24` | Max candidates sent to the model |
| `IG_HEADED` | unset | Set to `1` to watch the Instagram browser during a run |
| `DASHBOARD_PORT` | `8787` | Local dashboard port |
| `CLOUD_URL` | — | Hosted Pages URL |
| `CLOUD_ADMIN_SECRET` | — | Admin secret for `publish:cloud` and subscriber export |
| `PUBLISH_CLOUD` | `false` | Publish after each successful run |
| `MAIL_SUBSCRIBERS` | `false` | Send the latest digest to hosted subscribers after each run (owner skipped) |

If email sending fails, the run exits non-zero and **does not advance state**, so yesterday's opportunities are retried on the next run instead of being silently lost.

## Optional AI verification

The keyword filter is the default because it is fast, free and offline. If you already use the [opencode CLI](https://opencode.ai), you can let its model double-check borderline items and extract deadlines:

```bash
USE_LLM=true
OPENCODE_MODEL=your-provider/your-model
```

```bash
node src/index.js run --llm --verbose
```

How it behaves:

- Sends at most `LLM_LIMIT` candidates in batches of six.
- The prompt requires a JSON verdict: fully funded (boolean), application fee (boolean), deadline, location, category, confidence, reason.
- A valid verdict overrides the keyword verdict.
- If the CLI is missing, unauthenticated, times out, or returns junk, the watcher logs a warning and keeps the keyword results. A model failure never breaks the daily email.
- This uses your model credits and can add a few minutes per run.

## Tests

```bash
npm test
```

Covers the fee/negation rules, mixed-funding bait-and-switch, deadline formats, rolling deadlines, past deadlines, event vs deadline extraction, RSS/Atom/Telegram parsing, Instagram caption/title/link extraction, cross-source deduplication, title cleanup, HTML escaping and digest sections.

## Project layout

```text
config/sources.json     the watched portals
src/index.js            CLI + pipeline
src/dashboard.js        local HTTP dashboard + JSON API
src/status.js           run/source health written to data/status.json
src/fetch-sources.js    RSS / Atom / Telegram / HTML / Instagram fetching
src/instagram.js        authenticated Instagram profile-grid scraper + login
src/analyze.js          fully-funded + no-fee + deadline rules
src/llm.js              optional opencode CLI verification
src/store.js            seen/store state in data/
src/digest.js           Markdown + responsive HTML email
src/mailer.js           SMTP + Resend delivery
src/schedule.js         launchd / cron installer
src/setup.js            interactive wizard
public/                 local dashboard HTML/CSS/JS (no build step)
cloud/                  Cloudflare Pages frontend, Functions API, D1 migration
scripts/                cloud publish + mailing-list helpers
test/                   node:test suites
data/                   generated state, digests, logs and Instagram session (gitignored)
```

The Instagram browser profile is at `data/instagram/profile/`. It contains session cookies, so treat it like a password and never commit it.

## Troubleshooting

**No email, only local files.** Run `npm run setup` again or check `DIGEST_TO`, `MAIL_FROM`, and SMTP/Resend values. `npm run test-email` gives the exact error.

**Gmail "Username and Password not accepted".** Use an App Password and make sure 2-Step Verification is on.

**Instagram sources are skipped.** There is no saved session. Run `npm run instagram:login` once. If it was already saved, the session expired: `npm run instagram:status`, then log in again.

**Instagram asks for a code.** The login command opens Chrome and waits up to five minutes. Enter the WhatsApp/email code there and tick “Trust this device”. You can also pass a fresh code: `IG_2FA_CODE=123456 npm run instagram:login`.

**An Instagram handle stops working.** The account was renamed, made private, or deleted. Update `handle` in `config/sources.json` or disable that source.

**Chrome is not found.** Install Google Chrome. The Instagram fetcher uses your installed Chrome through Playwright, so no extra browser download is needed.

**A source is red in `npm run check-sources`.** That source is blocking the request (Cloudflare, timeout, changed markup). The rest of the run continues. Fix the feed/URL or disable the source.

**The scheduled job does not run.** Check `launchctl print gui/$(id -u)/com.scholarshipwatcher.daily` and the logs under `data/logs/`. Reinstall with `npm run schedule -- --time 08:00`.

**Too many items.** Tighten `MAX_AGE_DAYS`, or disable Telegram/Instagram sources in `config/sources.json`. The digest only shows 20 new items per day.

**The digest is empty.** That is a valid result. With `SEND_EMPTY=true` you still get a short email and the permanent watchlist, which confirms the watcher is alive.

## Privacy

- Everything runs locally.
- `.env` is gitignored and written with mode `600`.
- The Instagram browser session lives in `data/instagram/` (mode `700`, gitignored). The password is never stored; only the session cookies are. Use a burner account.
- No analytics, no telemetry, no third-party database.
- Emails go through the SMTP/Resend account you configure.
- Opportunity links point to third-party sites; verify the host before entering personal data.

## License

[MIT](LICENSE) © 2026 Concorde002

Built for personal use. No warranty that a program is genuinely fully funded, fee-free, or still open — always verify on the official page.
