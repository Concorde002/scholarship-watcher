/**
 * Fixed-window rate limiting in D1. Small race windows are acceptable for a
 * ten-person site; the goal is to stop brute force and scraper abuse.
 */
export async function rateLimit(env, key, limit, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;

  await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
       window_start = excluded.window_start`,
  )
    .bind(key, windowStart)
    .run();

  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first();

  // Opportunistic cleanup; do not block the request on it.
  if (Math.random() < 0.02) {
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(now - 86_400)
      .run()
      .catch(() => {});
  }

  return (row?.count ?? 1) <= limit;
}
