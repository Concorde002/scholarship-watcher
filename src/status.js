import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { paths } from './config.js';

export function loadStatus() {
  if (!existsSync(paths.status)) return null;
  try {
    return JSON.parse(readFileSync(paths.status, 'utf8'));
  } catch {
    return null;
  }
}

export function saveStatus(status) {
  try {
    mkdirSync(paths.data, { recursive: true });
    const temp = `${paths.status}.tmp`;
    writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, paths.status);
    return true;
  } catch (error) {
    console.warn(`[watcher] Could not write ${paths.status}: ${error.message}`);
    return false;
  }
}

/**
 * Merge the configured source list with this run's fetch results.
 * Disabled and skipped sources stay visible so the dashboard can explain them.
 */
export function buildSourceStatuses(allSources, results, { instagramSkipped = false } = {}) {
  const byId = new Map(results.map((result) => [result.source.id, result]));

  return allSources.map((source) => {
    const base = {
      id: source.id,
      name: source.name,
      type: source.type,
      enabled: Boolean(source.enabled),
      tags: source.tags ?? [],
      note: source.note ?? null,
    };

    if (!source.enabled) {
      return { ...base, status: 'disabled', items: 0, ms: 0, error: null };
    }
    if (source.type === 'instagram' && instagramSkipped) {
      return { ...base, status: 'skipped', items: 0, ms: 0, error: 'No Instagram session' };
    }

    const result = byId.get(source.id);
    if (!result) {
      return { ...base, status: 'unknown', items: 0, ms: 0, error: null };
    }

    return {
      ...base,
      status: result.error ? 'failed' : 'live',
      items: result.items?.length ?? 0,
      ms: result.ms ?? 0,
      error: result.error ?? null,
    };
  });
}
