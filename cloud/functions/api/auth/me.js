import { requireUser } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;

  const subscriber = await context.env.DB.prepare(
    'SELECT active FROM subscribers WHERE email = ?',
  )
    .bind(auth.user.email)
    .first();

  return json({
    user: { email: auth.user.email, createdAt: auth.user.created_at },
    subscribed: Boolean(subscriber?.active),
  });
}
