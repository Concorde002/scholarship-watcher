import { json } from '../_lib/http.js';

export async function onRequestGet(context) {
  try {
    const users = await context.env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
    const opportunities = await context.env.DB.prepare(
      'SELECT COUNT(*) AS total FROM opportunities',
    ).first();
    const meta = await context.env.DB.prepare('SELECT value FROM meta WHERE key = ?')
      .bind('last_import')
      .first();

    return json({
      ok: true,
      users: users?.total ?? 0,
      opportunities: opportunities?.total ?? 0,
      lastImport: meta?.value ?? null,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, error: 'Database not ready' }, 503);
  }
}
