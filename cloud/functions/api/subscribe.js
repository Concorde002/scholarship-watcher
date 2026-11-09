import { requireUser } from '../_lib/auth.js';
import { json, readJson } from '../_lib/http.js';
import { rateLimit } from '../_lib/rate.js';

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  const row = await context.env.DB.prepare(
    'SELECT active FROM subscribers WHERE email = ?',
  )
    .bind(auth.user.email)
    .first();
  return json({ subscribed: Boolean(row?.active) });
}

export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;

  const allowed = await rateLimit(context.env, `sub:${auth.user.id}`, 10, 3600);
  if (!allowed) return json({ error: 'Too many changes. Try again later.' }, 429);

  const body = await readJson(context.request);
  const active = body?.active === true;

  await context.env.DB.prepare(
    `INSERT INTO subscribers (email, user_id, created_at, active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET active = excluded.active`,
  )
    .bind(auth.user.email, auth.user.id, new Date().toISOString(), active ? 1 : 0)
    .run();

  return json({ subscribed: active });
}
