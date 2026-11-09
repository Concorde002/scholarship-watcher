#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, paths } from '../src/config.js';
import { describeMailConfig, sendDigest } from '../src/mailer.js';
import { sleep } from '../src/util.js';

const base = (process.env.CLOUD_URL || '').replace(/\/+$/, '');
const secret = process.env.CLOUD_ADMIN_SECRET || '';
const dryRun = process.argv.includes('--dry-run');

if (!base || !secret) {
  console.error('Set CLOUD_URL and CLOUD_ADMIN_SECRET first.');
  process.exit(1);
}

const response = await fetch(`${base}/api/admin/subscribers`, {
  headers: { 'x-admin-secret': secret },
});
if (!response.ok) {
  console.error(`Could not load subscribers (${response.status}): ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
const { subscribers = [] } = await response.json();
if (!subscribers.length) {
  console.log('No subscribers yet.');
  process.exit(0);
}

let digestHtml = null;
let digestText = null;
let digestDay = null;
try {
  const files = readdirSync(paths.digests)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.html$/.test(name))
    .sort()
    .reverse();
  digestDay = files[0]?.replace(/\.html$/, '') ?? null;
  if (digestDay) {
    const htmlPath = join(paths.digests, `${digestDay}.html`);
    const mdPath = join(paths.digests, `${digestDay}.md`);
    digestHtml = readFileSync(htmlPath, 'utf8');
    digestText = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : digestHtml.replace(/<[^>]+>/g, ' ');
  }
} catch {
  // handled below
}

if (!digestHtml || !digestText) {
  console.error('No delivered digest found in data/digests. Run npm run run first.');
  process.exit(1);
}

const config = loadConfig();
const status = describeMailConfig(config.mail);
if (!status.configured) {
  console.error(`Email is not configured: ${status.reason}`);
  process.exit(1);
}

console.log(`Sending ${digestDay} digest to ${subscribers.length} subscriber(s)${dryRun ? ' (dry run)' : ''}…`);

let sent = 0;
let failed = 0;
const owner = (config.mail.to || '').toLowerCase();
for (const subscriber of subscribers) {
  if (owner && subscriber.email.toLowerCase() === owner) {
    console.log(`  skipping owner ${subscriber.email}`);
    continue;
  }
  if (dryRun) {
    console.log(`  would send to ${subscriber.email}`);
    continue;
  }
  const result = await sendDigest(
    {
      subject: `Scholarship Watchlist · ${digestDay}`,
      html: digestHtml,
      text: digestText,
    },
    { ...config.mail, to: subscriber.email },
  );
  if (result.sent) {
    sent += 1;
    console.log(`  sent to ${subscriber.email}`);
  } else {
    failed += 1;
    console.error(`  failed for ${subscriber.email}: ${result.reason}`);
  }
  await sleep(1200);
}

console.log(`Done. ${sent} sent, ${failed} failed.`);
if (failed) process.exitCode = 1;
