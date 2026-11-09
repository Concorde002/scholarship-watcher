import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dateKey, daysUntil } from './util.js';
import { paths } from './config.js';

const EMPTY_STORE = { version: 1, updatedAt: null, items: {} };
const EMPTY_SEEN = { version: 1, seen: {} };

function readJson(file, fallback) {
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(file, value) {
  mkdirSync(paths.data, { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

export function loadStore() {
  const store = readJson(paths.store, EMPTY_STORE);
  if (!store.items || typeof store.items !== 'object') return structuredClone(EMPTY_STORE);
  return store;
}

export function loadSeen() {
  const seen = readJson(paths.seen, EMPTY_SEEN);
  if (!seen.seen || typeof seen.seen !== 'object') return structuredClone(EMPTY_SEEN);
  return seen;
}

export function saveStore(store) {
  writeJson(paths.store, store);
}

export function saveSeen(seen) {
  writeJson(paths.seen, seen);
}

/** Merge this run's accepted items into the long-lived store. */
export function updateStore(store, accepted, now = new Date()) {
  const today = dateKey(now);
  for (const item of accepted) {
    if (!item.id) continue;
    const existing = store.items[item.id];
    store.items[item.id] = {
      id: item.id,
      title: item.title,
      url: item.url,
      summary: item.summary?.slice(0, 500) ?? '',
      sourceName: item.sourceName,
      location: item.location ?? existing?.location ?? '',
      category: item.category ?? existing?.category ?? '',
      deadline: item.deadline ?? null,
      deadlineLabel: item.deadlineLabel ?? null,
      reason: item.reason,
      confidence: item.confidence,
      verifiedBy: item.verifiedBy ?? existing?.verifiedBy ?? 'heuristic',
      firstSeen: existing?.firstSeen ?? today,
      lastSeen: today,
    };
  }

  store.updatedAt = new Date().toISOString();
  pruneStore(store, now);
  return store;
}

function pruneStore(store, now) {
  for (const [id, item] of Object.entries(store.items)) {
    const deadlineAge = item.deadline ? daysUntil(item.deadline, now) : null;
    const lastSeenAge = (Date.now() - Date.parse(`${item.lastSeen}T00:00:00`)) / 86_400_000;
    const expired = deadlineAge !== null && deadlineAge < -21;
    const abandoned = Number.isFinite(lastSeenAge) && lastSeenAge > 120;
    if (expired || abandoned) delete store.items[id];
  }
}

export function markSeen(seen, accepted, now = new Date()) {
  const today = dateKey(now);
  for (const item of accepted) {
    if (item.id) seen.seen[item.id] = today;
  }
  return seen;
}

export function pruneSeen(seen, now = new Date(), maxAgeDays = 180) {
  for (const [id, firstSeen] of Object.entries(seen.seen)) {
    const age = (Date.now() - Date.parse(`${firstSeen}T00:00:00`)) / 86_400_000;
    if (Number.isFinite(age) && age > maxAgeDays) delete seen.seen[id];
  }
  return seen;
}

export function writeDigestFiles(day, markdown, html) {
  mkdirSync(paths.digests, { recursive: true });
  const base = join(paths.digests, day);
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.html`, html);
  return { markdown: `${base}.md`, html: `${base}.html` };
}
