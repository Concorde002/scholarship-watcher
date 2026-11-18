import { requireAdmin } from '../../_lib/auth.js';
import { clientIp, json, readJson, truncate } from '../../_lib/http.js';
import { rateLimit } from '../../_lib/rate.js';

function cleanItem(item, importedAt) {
  const id = truncate(item?.id, 100);
  const title = truncate(item?.title, 250);
  if (!id || !title) return null;

  return {
    id,
    title,
    url: truncate(item.url, 500),
    apply_url: truncate(item.applyUrl, 500),
    source_name: truncate(item.sourceName, 120),
    source_type: truncate(item.sourceType, 40),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(item.deadline ?? '') ? item.deadline : null,
    event_date: truncate(item.eventDate, 120),
    location: truncate(item.location, 120),
    category: truncate(item.category, 60),
    reason: truncate(item.reason, 400),
    verified_by: truncate(item.verifiedBy, 40),
    first_seen: truncate(item.firstSeen, 30),
    imported_at: importedAt,
    under18: ['yes', 'no', 'unknown'].includes(item.under18) ? item.under18 : 'unknown',
    age_label: truncate(item.ageLabel, 40),
    conference: item.conference === true ? 1 : 0,
  };
}

export async function onRequestPost(context) {
  const admin = await requireAdmin(context);
  if (admin.error) return admin.error;

  const allowed = await rateLimit(context.env, `import:${clientIp(context.request)}`, 10, 60);
  if (!allowed) return json({ error: 'Import rate limited.' }, 429);

  const body = await readJson(context.request);
  if (!Array.isArray(body?.items)) return json({ error: 'Expected an items array.' }, 400);
  if (body.items.length > 1000) return json({ error: 'Too many items in one import.' }, 400);

  const importedAt = new Date().toISOString();
  const items = body.items.map((item) => cleanItem(item, importedAt)).filter(Boolean);

  // Allow the frontend/import to keep working while the optional audience
  // migration has not been applied yet (e.g. an offline deploy).
  let hasAudienceColumns = false;
  try {
    const info = await context.env.DB.prepare('PRAGMA table_info(opportunities)').all();
    hasAudienceColumns = (info.results ?? []).some((column) => column.name === 'under18');
  } catch {
    hasAudienceColumns = false;
  }

  const fields = [
    'id',
    'title',
    'url',
    'apply_url',
    'source_name',
    'source_type',
    'deadline',
    'event_date',
    'location',
    'category',
    'reason',
    'verified_by',
    'first_seen',
    'imported_at',
  ];
  if (hasAudienceColumns) fields.push('under18', 'age_label', 'conference');
  const placeholders = fields.map(() => '?').join(', ');

  await context.env.DB.prepare('DELETE FROM opportunities').run();

  for (let offset = 0; offset < items.length; offset += 40) {
    const chunk = items.slice(offset, offset + 40);
    const statements = chunk.map((item) =>
      context.env.DB.prepare(
        `INSERT OR REPLACE INTO opportunities (${fields.join(', ')}) VALUES (${placeholders})`,
      ).bind(...fields.map((field) => item[field])),
    );

    if (statements.length) await context.env.DB.batch(statements);
  }

  await context.env.DB.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind('last_import', importedAt)
    .run();

  return json({ ok: true, count: items.length, importedAt });
}
