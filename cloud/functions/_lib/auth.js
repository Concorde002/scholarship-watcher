import { constantTimeEqual, getCookie, json, makeCookie, clearCookie } from './http.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const SESSION_COOKIE = 'sw_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createSessionToken(user, secret) {
  const payload = {
    uid: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function readSession(request, secret) {
  if (!secret) return null;
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = await hmac(secret, body);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(decoder.decode(fromBase64url(body)));
    if (!payload?.uid || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireUser(context) {
  const session = await readSession(context.request, context.env.SESSION_SECRET);
  if (!session) return { error: json({ error: 'Not signed in' }, 401) };
  const user = await context.env.DB.prepare(
    'SELECT id, email, created_at FROM users WHERE id = ?',
  )
    .bind(session.uid)
    .first();
  if (!user) return { error: json({ error: 'Session expired' }, 401) };
  return { user, session };
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:';
  return makeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, secure });
}

export function expiredSessionCookie(request) {
  return clearCookie(SESSION_COOKIE, request);
}

export function accessCodeOk(env, code) {
  return Boolean(env.SITE_ACCESS_CODE && constantTimeEqual(code, env.SITE_ACCESS_CODE));
}

export async function requireAdmin(context) {
  const expected = context.env.ADMIN_SECRET;
  const provided = context.request.headers.get('x-admin-secret') || '';
  if (!expected || !constantTimeEqual(provided, expected)) {
    return { error: json({ error: 'Forbidden' }, 403) };
  }
  return {};
}
