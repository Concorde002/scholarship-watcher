import { requireUser } from '../_lib/auth.js';
import { json, readJson } from '../_lib/http.js';
import { rateLimit } from '../_lib/rate.js';

async function listWatchlist(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT opportunity_id FROM watchlist WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(userId)
    .all();
  return (results ?? []).map((row) => row.opportunity_id);
}

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  return json({ watchlist: await listWatchlist(context.env, auth.user.id) });
}

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;

  const allowed = await rateLimit(context.env, `watch:${auth.user.id}`, 60, 60);
  if (!allowed) return json({ error: 'Too many watchlist changes. Slow down.' }, 429);

  const body = await readJson(context.request);
  const id = String(body?.id ?? '').slice(0, 100);
  const action = body?.action === 'remove' ? 'remove' : 'add';
  if (!id) return json({ error: 'Missing opportunity id.' }, 400);

  if (action === 'add') {
    const exists = await context.env.DB.prepare('SELECT 1 AS ok FROM opportunities WHERE id = ?')
      .bind(id)
      .first();
    if (!exists) return json({ error: 'Opportunity not found.' }, 404);

    const count = await context.env.DB.prepare(
      'SELECT COUNT(*) AS total FROM watchlist WHERE user_id = ?',
    )
      .bind(auth.user.id)
      .first();
    if ((count?.total ?? 0) >= 200) {
      return json({ error: 'Watchlist limit is 200 items.' }, 400);
    }

    await context.env.DB.prepare(
      'INSERT OR IGNORE INTO watchlist (user_id, opportunity_id, created_at) VALUES (?, ?, ?)',
    )
      .bind(auth.user.id, id, new Date().toISOString())
      .run();
  } else {
    await context.env.DB.prepare(
      'DELETE FROM watchlist WHERE user_id = ? AND opportunity_id = ?',
    )
      .bind(auth.user.id, id)
      .run();
  }

  return json({ watchlist: await listWatchlist(context.env, auth.user.id) });
}
