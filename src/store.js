import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dateKey, daysUntil, fingerprint } from './util.js';
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
      sourceType: item.sourceType ?? existing?.sourceType ?? '',
      applyUrl: item.applyUrl ?? existing?.applyUrl ?? null,
      location: item.location ?? existing?.location ?? '',
      category: item.category ?? existing?.category ?? '',
      deadline: item.deadline ?? null,
      deadlineLabel: item.deadlineLabel ?? null,
      eventDate: item.eventDate ?? existing?.eventDate ?? null,
      reason: item.reason,
      confidence: item.confidence,
      verifiedBy: item.verifiedBy ?? existing?.verifiedBy ?? 'heuristic',
      firstSeen: existing?.firstSeen ?? today,
      lastSeen: today,
    };
  }

  store.updatedAt = new Date().toISOString();
  dedupeStore(store);
  pruneStore(store, now);
  return store;
}

/**
 * Exact-title duplicates can accumulate across days when the same post arrives
 * from Telegram and Instagram. Keep the entry with the best apply link.
 */
export function dedupeStore(store) {
  const byFingerprint = new Map();

  for (const item of Object.values(store.items)) {
    const key = fingerprint(item.title);
    const existing = byFingerprint.get(key);
    if (!existing) {
      byFingerprint.set(key, item);
      continue;
    }

    const score = (entry) =>
      (entry.applyUrl ? 2 : 0) +
      (entry.sourceType === 'instagram' ? 1 : 0) +
      Math.min(1, (entry.summary?.length ?? 0) / 1000);
    const winner = score(item) > score(existing) ? item : existing;
    const loser = winner === existing ? item : existing;

    winner.firstSeen = [winner.firstSeen, loser.firstSeen].filter(Boolean).sort()[0] ?? winner.firstSeen;
    winner.lastSeen = [winner.lastSeen, loser.lastSeen].filter(Boolean).sort().pop() ?? winner.lastSeen;
    for (const field of ['eventDate', 'location', 'category', 'applyUrl', 'sourceType']) {
      if (!winner[field] && loser[field]) winner[field] = loser[field];
    }
    byFingerprint.set(key, winner);
  }

  store.items = Object.fromEntries([...byFingerprint.values()].map((item) => [item.id, item]));
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

export function writeDigestFiles(day, markdown, html, { preview = false } = {}) {
  mkdirSync(paths.digests, { recursive: true });
  const base = join(paths.digests, `${preview ? 'preview-' : ''}${day}`);
  writeFileSync(`${base}.md`, markdown);
  writeFileSync(`${base}.html`, html);
  return { markdown: `${base}.md`, html: `${base}.html` };
}
