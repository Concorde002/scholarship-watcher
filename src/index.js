#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { loadConfig, loadSources, paths } from './config.js';
import { fetchSource, fetchPageText } from './fetch-sources.js';
import { classify, mergeVerdict } from './analyze.js';
import { reviewWithLlm } from './llm.js';
import { fingerprint, itemId, mapLimit, similarTitles, daysUntil } from './util.js';
import { loadSeen, loadStore, markSeen, pruneSeen, saveSeen, saveStore, updateStore, writeDigestFiles } from './store.js';
import { prepareDigest, renderHtml, renderText, subjectFor } from './digest.js';
import { describeMailConfig, sendDigest, sendTestEmail } from './mailer.js';
import { installSchedule, removeSchedule, scheduleStatus } from './schedule.js';
import { runSetup, ask, askHidden } from './setup.js';
import {
  closeInstagram,
  hasInstagramSession,
  instagramSessionInfo,
  loginInstagram,
  verifyInstagramSession,
} from './instagram.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const HELP = `
scholarship-watcher ${pkg.version}

Usage:
  npm run run                 Fetch sources and send the daily digest
  npm run preview             Dry run: print the digest, change nothing
  npm run setup               Interactive email + schedule setup
  npm run instagram:login     One-time Instagram login (burner recommended)
  npm run instagram:status    Verify the saved Instagram session
  npm run check-sources       Check every enabled source
  npm run test-email          Send a test email
  npm run schedule            Install the daily schedule
  npm test                    Run the test suite

Options for "run":
  --dry-run                   Do not send email or save state
  --no-save                   Do not update seen/store state
  --limit N                   Only process the N newest unseen posts
  --llm                       Enable opencode AI verification for this run
  --no-llm                    Disable AI verification
  --verbose                   Log each source and classification count

Options for "schedule":
  --time HH:MM                Daily run time (24-hour), default 08:00
  --remove                    Remove the schedule
  --status                    Show whether the schedule is installed

Options for "instagram-login":
  --no-wait                   Fail instead of waiting for manual 2FA/challenge

The watcher only keeps opportunities that state full funding and show no
application/registration fee. Everything else is counted and discarded.
`;

function log(...args) {
  console.log(`[watcher]`, ...args);
}

function logWarn(...args) {
  console.warn(`[watcher]`, ...args);
}

function newestFirst(a, b) {
  const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  return bTime - aTime;
}

async function enrich(items, config) {
  const targets = items
    .filter((item) => item.sourceType !== 'telegram' && item.sourceType !== 'instagram' && (item.summary?.length ?? 0) < 900)
    .slice(0, config.enrichLimit);

  let enriched = 0;
  let failed = 0;

  await mapLimit(targets, 4, async (item) => {
    try {
      item.pageText = await fetchPageText(item.url);
      if (item.pageText) enriched += 1;
    } catch {
      item.pageText = '';
      failed += 1;
    }
  });

  return { targets: targets.length, enriched, failed };
}

async function commandRun(options) {
  const config = loadConfig();
  const useLlm = options.llm ? true : options.noLlm ? false : config.useLlm;
  let sources = loadSources().filter((source) => source.enabled);

  if (sources.some((source) => source.type === 'instagram') && !hasInstagramSession()) {
    logWarn('Instagram sources skipped: no saved session. Run `npm run instagram:login` once.');
    sources = sources.filter((source) => source.type !== 'instagram');
  }

  const now = new Date();

  if (sources.length === 0) throw new Error('No enabled sources in config/sources.json');

  log(`Checking ${sources.length} sources for ${now.toLocaleDateString('en-GB')}…`);

  const results = await mapLimit(sources, 4, fetchSource);
  const errors = results.filter((result) => result.error);

  for (const result of results) {
    if (options.verbose) {
      const detail = result.error ? `ERROR ${result.error}` : `${result.items.length} items`;
      console.log(`  ${result.error ? '✗' : '✓'} ${result.source.name} — ${detail} (${result.ms}ms)`);
    }
  }
  if (errors.length) {
    logWarn(`${errors.length} source(s) failed:`);
    for (const result of errors) logWarn(`  ${result.source.name}: ${result.error}`);
  }

  const rawItems = results.flatMap((result) => result.items);
  const oldestAllowed = now.getTime() - config.maxAgeDays * 86_400_000;

  const freshEnough = rawItems.filter((item) => {
    if (!item.publishedAt) return true;
    const published = Date.parse(item.publishedAt);
    return !Number.isFinite(published) || published >= oldestAllowed;
  });

  const byUrl = new Map();
  for (const item of freshEnough) {
    if (!byUrl.has(item.url)) byUrl.set(item.url, { ...item, id: itemId(item.url) });
  }

  const seenFingerprints = new Set();
  let unique = [];
  for (const item of byUrl.values()) {
    const fp = fingerprint(item.title);
    if (seenFingerprints.has(fp)) continue;
    seenFingerprints.add(fp);
    unique.push(item);
  }

  const seen = loadSeen();
  const seenIds = new Set(Object.keys(seen.seen));
  const store = loadStore();
  const unseen = unique.filter((item) => !seenIds.has(item.id));
  unseen.sort(newestFirst);
  let fresh = unseen;

  // Suppress the same program arriving from another source with a new URL,
  // but only for recent, still-open items so annual editions are not lost.
  const recentTitles = Object.values(store.items).filter((entry) => {
    if (!entry.firstSeen) return false;
    const age = (now.getTime() - Date.parse(`${entry.firstSeen}T00:00:00`)) / 86_400_000;
    const open = !entry.deadline || (daysUntil(entry.deadline, now) ?? 0) >= 0;
    return age <= 21 && open;
  });
  if (options.limit) {
    const limit = Number.parseInt(options.limit, 10);
    if (Number.isFinite(limit) && limit > 0) fresh = fresh.slice(0, limit);
  }

  log(
    `${rawItems.length} posts fetched · ${unique.length} unique · ${unseen.length} unseen · ${unique.length - unseen.length} already seen${fresh.length !== unseen.length ? ` · processing ${fresh.length}` : ''}`,
  );

  const enrichStats = await enrich(fresh, config);
  if (enrichStats.targets > 0) {
    log(`Read ${enrichStats.enriched}/${enrichStats.targets} full pages for fee/deadline evidence.`);
  }

  let classified = fresh.map((item) => classify(item, { now }));

  if (useLlm) {
    const pool = classified
      .filter((item) => item.status === 'accepted' || item.status === 'review')
      .slice(0, config.llmLimit);
    if (pool.length) {
      const verdicts = await reviewWithLlm(
        pool,
        {
          bin: config.llmBin,
          model: config.llmModel,
          timeoutMs: config.llmTimeoutMs,
          limit: config.llmLimit,
        },
        { log, warn: logWarn },
      );
      if (verdicts.size) {
        classified = classified.map((item) =>
          verdicts.has(item.id) ? mergeVerdict(item, verdicts.get(item.id)) : item,
        );
        log(`AI review returned ${verdicts.size} verdicts.`);
      }
    }
  }

  let acceptedToday = classified.filter((item) => item.status === 'accepted');

  if (recentTitles.length) {
    const before = acceptedToday.length;
    acceptedToday = acceptedToday.filter(
      (item) => !recentTitles.some((entry) => similarTitles(entry.title, item.title)),
    );
    if (acceptedToday.length !== before) {
      log(`${before - acceptedToday.length} match(es) already in the recent store were skipped.`);
    }
  }

  // The same program often arrives from several aggregators. Keep the best
  // entry (AI-verified, then has a deadline, then highest confidence).
  const rank = (item) => [
    item.verifiedBy === 'opencode' ? 0 : 1,
    item.deadline ? 0 : 1,
    -(item.confidence ?? 0),
    item.deadline ?? '9999-12-31',
  ];
  acceptedToday.sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  });

  const dedupedAccepted = [];
  for (const item of acceptedToday) {
    if (dedupedAccepted.some((kept) => similarTitles(kept.title, item.title))) continue;
    dedupedAccepted.push(item);
  }
  if (dedupedAccepted.length !== acceptedToday.length) {
    log(`${acceptedToday.length - dedupedAccepted.length} cross-source duplicate match(es) merged.`);
  }
  acceptedToday = dedupedAccepted;

  const rejectedCount = classified.filter(
    (item) => item.status === 'rejected' || item.status === 'expired',
  ).length;
  const reviewCount = classified.filter((item) => item.status === 'review').length;

  if (options.verbose) {
    for (const item of classified) {
      console.log(
        `  [${item.status}] ${item.title.slice(0, 80)} — ${item.reason ?? ''}`,
      );
    }
  }

  log(
    `${acceptedToday.length} fully funded match(es) · ${rejectedCount} rejected (fee/partial/unfunded/expired) · ${reviewCount} need manual review`,
  );

  const storeCopy = structuredClone(store);
  updateStore(storeCopy, acceptedToday, now);

  const digest = prepareDigest({
    now,
    accepted: Object.values(storeCopy.items),
    newIds: new Set(acceptedToday.map((item) => item.id)),
    stats: {
      sourceCount: sources.length,
      sourceErrors: errors.length,
      scanned: unique.length,
      rejected: rejectedCount,
      review: reviewCount,
      acceptedToday: acceptedToday.length,
    },
  });

  if (digest.empty && !config.sendEmpty) {
    log('No new fully funded matches today and SEND_EMPTY is off. Nothing sent.');
    return;
  }

  const subject = subjectFor(digest);
  const text = renderText(digest);
  const html = renderHtml(digest);
  const files = writeDigestFiles(digest.day, text, html);
  log(`Digest written to ${files.html}`);

  if (options.dryRun) {
    console.log(`\n${text}\n`);
    log('Dry run: no email sent, no state saved.');
    return;
  }

  const mailStatus = describeMailConfig(config.mail);
  if (mailStatus.configured) {
    const result = await sendDigest({ subject, html, text }, config.mail);
    if (!result.sent) {
      logWarn(`Email failed: ${result.reason}`);
      logWarn('State was not advanced, so tomorrow will retry these opportunities.');
      process.exitCode = 1;
      return;
    }
    log(`Email sent to ${config.mail.to} via ${result.transport}.`);
  } else {
    logWarn(`No email configured (${mailStatus.reason}). Local mode: digest written only.`);
    console.log(`\n${text}\n`);
  }

  if (options.noSave) {
    log('--no-save: state not updated.');
    return;
  }

  if (!mailStatus.configured && !config.saveWithoutEmail) {
    log('No email configured: state not advanced, so the backlog is not lost. Run `npm run setup`.');
    return;
  }

  markSeen(seen, acceptedToday, now);
  pruneSeen(seen, now);
  saveSeen(seen);
  saveStore(storeCopy);
  log(`Saved state. ${acceptedToday.length} new item(s) marked as seen.`);
}

async function commandCheckSources(options) {
  const allSources = loadSources();
  let selected = options.all ? allSources : allSources.filter((source) => source.enabled);

  if (selected.some((source) => source.type === 'instagram') && !hasInstagramSession()) {
    logWarn('Instagram sources skipped: no saved session. Run `npm run instagram:login` once.');
    selected = selected.filter((source) => source.type !== 'instagram');
  }

  log(`Checking ${selected.length} source(s)…`);
  const results = await mapLimit(selected, 4, fetchSource);

  for (const result of results) {
    const status = result.error ? '✗' : '✓';
    const detail = result.error ? result.error : `${result.items.length} items`;
    console.log(`${status} ${result.source.name.padEnd(36)} ${detail} (${result.ms}ms)`);
  }

  const disabled = allSources.filter((source) => !source.enabled);
  if (disabled.length) {
    console.log('\nDisabled sources:');
    for (const source of disabled) {
      console.log(`- ${source.name}: ${source.note ?? 'disabled'}`);
    }
  }

  const enabledResults = results.filter((result) => result.source.enabled);
  if (enabledResults.length && enabledResults.every((result) => result.error)) {
    process.exitCode = 1;
  }
}

async function commandTestEmail() {
  const config = loadConfig();
  const status = describeMailConfig(config.mail);
  if (!status.configured) {
    throw new Error(`Email is not configured: ${status.reason}. Run npm run setup.`);
  }
  const result = await sendTestEmail(config.mail);
  if (!result.sent) throw new Error(`Test email failed: ${result.reason}`);
  log(`Test email sent to ${config.mail.to} via ${result.transport}.`);
}

async function commandInstagramLogin(options) {
  let username = process.env.IG_USERNAME?.trim() || '';
  let password = process.env.IG_PASSWORD || '';
  const code = process.env.IG_2FA_CODE?.trim() || '';
  let rl = null;

  if (!username || !password) {
    rl = createInterface({ input: stdin, output: stdout });
    if (!username) username = await ask(rl, 'Instagram username or email');
    if (!password) password = await askHidden(rl, 'Instagram password (input hidden): ');
  }

  try {
    const result = await loginInstagram({
      username,
      password,
      code,
      waitForManual: !options.noWait,
      headless: false,
    });
    log(`Instagram login OK for ${result.username}. ${result.posts} recent posts visible.`);
    log('Session saved in data/instagram/ (gitignored, mode 700).');
  } finally {
    if (rl) rl.close();
  }
}

async function commandInstagramStatus() {
  const info = instagramSessionInfo();
  if (!info) throw new Error('No Instagram session saved. Run: npm run instagram:login');
  const result = await verifyInstagramSession();
  log(
    `Instagram session OK (${result.posts} posts visible, saved ${info.loggedInAt}).` +
      (result.bioLink ? ' Bio link found.' : ''),
  );
}

async function commandSchedule(options) {
  if (options.remove) {
    const result = removeSchedule();
    log(`Schedule removed (${result.platform}).`);
    return;
  }
  if (options.status) {
    const status = scheduleStatus();
    log(
      status.installed
        ? `Schedule installed${status.loaded ? ' and loaded' : ' but not loaded'}: ${status.file}`
        : 'Schedule is not installed.',
    );
    return;
  }

  const config = loadConfig();
  const time = options.time || process.env.SCHEDULE_TIME || '08:00';
  const result = installSchedule({ time });
  log(
    result.loaded
      ? `Daily schedule installed for ${result.time} (${result.file}).`
      : `Schedule written to ${result.file}, but not confirmed by launchctl.`,
  );
  log(`Run it now with: ${result.command}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      'no-save': { type: 'boolean', default: false },
      'no-llm': { type: 'boolean', default: false },
      'no-wait': { type: 'boolean', default: false },
      llm: { type: 'boolean', default: false },
      limit: { type: 'string' },
      verbose: { type: 'boolean', short: 'v', default: false },
      all: { type: 'boolean', default: false },
      time: { type: 'string' },
      remove: { type: 'boolean', default: false },
      status: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', default: false },
    },
  });

  if (values.version) {
    console.log(pkg.version);
    return;
  }

  const command = positionals[0] ?? 'run';
  if (values.help || command === 'help') {
    console.log(HELP.trim());
    return;
  }

  const options = {
    dryRun: values['dry-run'],
    noSave: values['no-save'],
    noLlm: values['no-llm'],
    noWait: values['no-wait'],
    llm: values.llm,
    limit: values.limit,
    verbose: values.verbose,
    all: values.all,
    time: values.time,
    remove: values.remove,
    status: values.status,
  };

  try {
    switch (command) {
      case 'run':
        await commandRun(options);
        break;
      case 'setup':
        await runSetup();
        break;
      case 'instagram-login':
        await commandInstagramLogin(options);
        break;
      case 'instagram-status':
        await commandInstagramStatus();
        break;
      case 'check-sources':
      case 'sources':
        await commandCheckSources(options);
        break;
      case 'test-email':
        await commandTestEmail();
        break;
      case 'schedule':
        await commandSchedule(options);
        break;
      default:
        throw new Error(`Unknown command "${command}". Run with --help for usage.`);
    }
  } finally {
    await closeInstagram();
  }
}

main().catch((error) => {
  console.error(`[watcher] Error: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
