import { requireAdmin } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet(context) {
  const admin = await requireAdmin(context);
  if (admin.error) return admin.error;

  const { results } = await context.env.DB.prepare(
    'SELECT email, created_at FROM subscribers WHERE active = 1 ORDER BY created_at ASC',
  ).all();

  return json({
    count: results?.length ?? 0,
    subscribers: (results ?? []).map((row) => ({
      email: row.email,
      createdAt: row.created_at,
    })),
  });
}
