import {
  accessCodeOk,
  createSessionToken,
  sessionCookie,
} from '../../_lib/auth.js';
import {
  clientIp,
  json,
  normalizeEmail,
  readJson,
  validEmail,
} from '../../_lib/http.js';
import { rateLimit } from '../../_lib/rate.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB || !env.SESSION_SECRET || !env.SITE_ACCESS_CODE) {
    return json({ error: 'This watchlist is not configured yet.' }, 500);
  }

  const allowed = await rateLimit(env, `login:${clientIp(request)}`, 10, 600);
  if (!allowed) {
    return json({ error: 'Too many login attempts. Wait ten minutes and try again.' }, 429);
  }

  const body = await readJson(request);
  if (!body) return json({ error: 'Invalid request.' }, 400);

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!accessCodeOk(env, String(body.code ?? '').trim())) {
    return json({ error: 'Wrong access code.' }, 401);
  }

  let user = await env.DB.prepare('SELECT id, email, created_at FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const result = await env.DB.prepare(
      `INSERT INTO users (id, email, created_at)
       SELECT ?, ?, ?
       WHERE (SELECT COUNT(*) FROM users) < 10`,
    )
      .bind(id, email, createdAt)
      .run();

    if (!result.meta?.changes) {
      return json({ error: 'This watchlist is full. The 10-person limit has been reached.' }, 403);
    }
    user = { id, email, created_at: createdAt };
  }

  if (body.subscribe === true) {
    await env.DB.prepare(
      `INSERT INTO subscribers (email, user_id, created_at, active)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(email) DO UPDATE SET active = 1, user_id = excluded.user_id`,
    )
      .bind(email, user.id, new Date().toISOString())
      .run();
  }

  const subscriber = await env.DB.prepare('SELECT active FROM subscribers WHERE email = ?')
    .bind(email)
    .first();
  const token = await createSessionToken(user, env.SESSION_SECRET);

  return json(
    {
      ok: true,
      user: { email: user.email, createdAt: user.created_at },
      subscribed: Boolean(subscriber?.active),
    },
    200,
    { 'set-cookie': sessionCookie(token, request) },
  );
}
