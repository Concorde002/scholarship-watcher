import { requireUser } from '../_lib/auth.js';
import { daysLeft, json } from '../_lib/http.js';
import { rateLimit } from '../_lib/rate.js';

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;

  const allowed = await rateLimit(context.env, `opps:${auth.user.id}`, 120, 60);
  if (!allowed) return json({ error: 'Slow down a little. Try again in a minute.' }, 429);

  const { results } = await context.env.DB.prepare(
    `SELECT id, title, url, apply_url, source_name, source_type, deadline, event_date,
            location, category, reason, verified_by, first_seen
     FROM opportunities
     ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, title ASC`,
  ).all();

  const items = (results ?? [])
    .map((row) => {
      const days = daysLeft(row.deadline);
      return {
        id: row.id,
        title: row.title,
        url: row.url,
        applyUrl: row.apply_url,
        sourceName: row.source_name,
        sourceType: row.source_type,
        deadline: row.deadline,
        daysLeft: days,
        eventDate: row.event_date,
        location: row.location,
        category: row.category,
        reason: row.reason,
        verifiedBy: row.verified_by,
        firstSeen: row.first_seen,
        expired: days !== null && days < -1,
      };
    })
    .filter((item) => !item.expired);

  const counts = {
    open: items.length,
    urgent: items.filter((item) => item.daysLeft !== null && item.daysLeft <= 1).length,
    week: items.filter((item) => item.daysLeft !== null && item.daysLeft >= 2 && item.daysLeft <= 7).length,
    month: items.filter((item) => item.daysLeft !== null && item.daysLeft >= 8 && item.daysLeft <= 30).length,
    later: items.filter((item) => item.daysLeft !== null && item.daysLeft > 30).length,
    noDeadline: items.filter((item) => item.daysLeft === null).length,
  };

  const watch = await context.env.DB.prepare(
    'SELECT opportunity_id FROM watchlist WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(auth.user.id)
    .all();

  const meta = await context.env.DB.prepare('SELECT value FROM meta WHERE key = ?')
    .bind('last_import')
    .first();

  return json({
    user: { email: auth.user.email },
    items,
    counts,
    watchlist: (watch.results ?? []).map((row) => row.opportunity_id),
    updatedAt: meta?.value ?? null,
  });
}
