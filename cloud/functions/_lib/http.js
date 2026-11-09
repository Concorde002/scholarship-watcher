export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const cookies = {};
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function getCookie(request, name) {
  return parseCookies(request)[name] || null;
}

export function makeCookie(name, value, { maxAge = 2_592_000, secure = true, httpOnly = true } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    httpOnly ? 'HttpOnly' : null,
    secure ? 'Secure' : null,
    'SameSite=Lax',
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookie(name, request) {
  const secure = new URL(request.url).protocol === 'https:';
  return makeCookie(name, '', { maxAge: 0, secure });
}

export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase().slice(0, 254);
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Whole days from today's UTC date to an ISO YYYY-MM-DD deadline. */
export function daysLeft(deadline) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline ?? ''))) return null;
  const [year, month, day] = deadline.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

export function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

export function truncate(value, max = 500) {
  return String(value ?? '').slice(0, max);
}
