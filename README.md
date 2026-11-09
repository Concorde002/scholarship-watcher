# Scholarship Watcher

A local daily watcher for **fully funded** scholarships, fellowships, conferences and youth summits. It reads the portals that feed the big Instagram accounts, rejects paid/self-funded programs and anything that mentions an application or registration fee, extracts deadlines, and emails you one short digest per day.

Runs on your own machine. No account, no dashboard, no SaaS.

```text
Scholarship Watcher · 4 new fully funded · 2 closing soon · 9 Nov
```

## What it actually does

1. **Fetches** 14 live sources: RSS feeds, public Telegram channel previews, and listing pages that have no feed.
2. **Reads the article**, not just the headline, so fee and deadline language is visible.
3. **Applies two strict questions**: is it explicitly fully funded? is there any fee?
4. **Drops** self-funded, partially funded, unfunded, expired, and fee-charging programs.
5. **Deduplicates** the same program arriving from several aggregators.
6. **Extracts the application deadline** (not the event date) and groups the digest:
   - Apply today or tomorrow
   - Closing this week
   - New today
   - Still open from the last 10 days
7. **Emails you** via SMTP or Resend. If email is not configured yet, it writes the digest to `data/digests/` and prints it.
8. **Runs daily** through macOS `launchd` or Linux `cron`.

## The filter is deliberately strict

Kept only when the page says things like *fully funded*, *fully sponsored*, *100% funded*, *all expenses paid*, or *fully covered*, **and** no application / registration / participation / program / processing fee is mentioned.

Rejected or held back:

| Signal | Result |
| --- | --- |
| Self-funded, partially funded, unfunded, pay your own way | Rejected |
| Any application / registration / participation / program fee | Rejected |
| Fee waiver available (fee still exists) | Rejected |
| "A few fully funded seats, the rest self-funded" | `review` — excluded from the email |
| Funding level not stated | `review` — excluded from the email |
| Deadline already passed | Expired |
| Deadline within 1 day | Apply today section |
| Deadline within 7 days | Closing this week section |

The classifier runs on keywords and a few negation rules. It is intentionally conservative: **the absence of a fee mention is treated as no fee**, which is why every email ends with a verification checklist. Always confirm on the official host domain before applying. This is a discovery tool, not a guarantee.

## Quick start

Requirements: Node.js **20+** and `git`. Optional: the `opencode` CLI for AI-assisted verification.

```bash
git clone https://github.com/Concorde002/scholarship-watcher.git
cd scholarship-watcher
npm install
npm run preview
```

`npm run preview` fetches everything, prints the digest, writes HTML/Markdown to `data/digests/`, and changes no state. It does **not** send email.

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
| Youth Opportunities | HTML | Conferences + scholarships listing pages |
| One Young World | HTML | Official scholarship page |
| Lindau Nobel Laureate Meetings | RSS | Official |
| MCW Global | RSS | Official fellowship |
| Scholarships Corner | Telegram | Public channel preview |
| Opportunities Corners | Telegram | Public channel preview |
| Youth Opportunities | Telegram | Public channel preview |

**Instagram is not scraped.** Those accounts mostly repost from the websites and Telegram channels above, and scraping Instagram requires a logged-in account and violates its terms. The watcher follows the original publishers instead. Public Telegram previews (`t.me/s/<channel>`) are used because they require no account.

Some sources are present in `config/sources.json` but disabled with a note:

- **ProFellow** — Cloudflare returns HTTP 403 to non-browser clients.
- **ARMACAD** — no feed, public homepage currently lists stale calls.
- **For9a** — Arabic-language feed; the English classifier would drop most items.
- **EURAXESS** — no public RSS; search page is JavaScript-rendered.
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
| `MAX_AGE_DAYS` | `60` | Ignore feed items older than this |
| `ENRICH_LIMIT` | `30` | How many article pages to read per run |
| `USE_LLM` | `false` | Optional opencode AI verification |
| `OPENCODE_MODEL` | CLI default | e.g. `provider/model` |
| `OPENCODE_BIN` | `opencode` | Path to the CLI |
| `LLM_LIMIT` | `24` | Max candidates sent to the model |

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

Covers the fee/negation rules, mixed-funding bait-and-switch, deadline formats, rolling deadlines, past deadlines, RSS/Atom/Telegram parsing, cross-source deduplication, title cleanup, HTML escaping and digest sections.

## Project layout

```text
config/sources.json     the watched portals
src/index.js            CLI + pipeline
src/fetch-sources.js    RSS / Atom / Telegram / HTML fetching
src/analyze.js          fully-funded + no-fee + deadline rules
src/llm.js              optional opencode CLI verification
src/store.js            seen/store state in data/
src/digest.js           Markdown + responsive HTML email
src/mailer.js           SMTP + Resend delivery
src/schedule.js         launchd / cron installer
src/setup.js            interactive wizard
test/                   node:test suites
data/                   generated state, digests and logs (gitignored)
```

## Troubleshooting

**No email, only local files.** Run `npm run setup` again or check `DIGEST_TO`, `MAIL_FROM`, and SMTP/Resend values. `npm run test-email` gives the exact error.

**Gmail "Username and Password not accepted".** Use an App Password and make sure 2-Step Verification is on.

**A source is red in `npm run check-sources`.** That source is blocking the request (Cloudflare, timeout, changed markup). The rest of the run continues. Fix the feed/URL or disable the source.

**The scheduled job does not run.** Check `launchctl print gui/$(id -u)/com.scholarshipwatcher.daily` and the logs under `data/logs/`. Reinstall with `npm run schedule -- --time 08:00`.

**Too many items.** Tighten `MAX_AGE_DAYS`, or disable Telegram sources in `config/sources.json`. The digest only shows 20 new items per day.

**The digest is empty.** That is a valid result. With `SEND_EMPTY=true` you still get a short email and the permanent watchlist, which confirms the watcher is alive.

## Privacy

- Everything runs locally.
- `.env` is gitignored and written with mode `600`.
- No analytics, no telemetry, no third-party database.
- Emails go through the SMTP/Resend account you configure.
- Opportunity links point to third-party sites; verify the host before entering personal data.

## License

[MIT](LICENSE) © 2026 Concorde002

Built for personal use. No warranty that a program is genuinely fully funded, fee-free, or still open — always verify on the official page.
