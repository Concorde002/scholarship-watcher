import { chromium } from 'playwright-core';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.js';
import { canonicalUrl, cleanTitle, fingerprint, isHttpUrl, sleep, truncate } from './util.js';

const IG_DIR = join(paths.data, 'instagram');
const PROFILE_DIR = join(IG_DIR, 'profile');
const SESSION_FILE = join(IG_DIR, 'session.json');

let contextPromise = null;
let pagePromise = null;
let queue = Promise.resolve();
let authFailed = false;

function ensureDirs() {
  mkdirSync(IG_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
}

export function hasInstagramSession() {
  if (!existsSync(SESSION_FILE)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(SESSION_FILE, 'utf8'))?.loggedInAt);
  } catch {
    return false;
  }
}

export function instagramSessionInfo() {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveSessionMarker(username = 'instagram-session') {
  ensureDirs();
  writeFileSync(
    SESSION_FILE,
    `${JSON.stringify({ username, loggedInAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  chmodSync(SESSION_FILE, 0o600);
  authFailed = false;
}

function clearSessionMarker() {
  try {
    if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
  } catch {
    // ignore
  }
}

async function launchContext({ headless }) {
  ensureDirs();
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',
    headless,
    viewport: { width: 1280, height: 950 },
    locale: 'en-US',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

async function getSharedContext() {
  if (!contextPromise) {
    contextPromise = launchContext({ headless: process.env.IG_HEADED !== '1' });
  }
  return contextPromise;
}

async function getSharedPage(context) {
  if (!pagePromise) {
    pagePromise = (async () => {
      const page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(45_000);
      return page;
    })();
  }
  return pagePromise;
}

async function hasSessionCookie(context) {
  try {
    const cookies = await context.cookies('https://www.instagram.com');
    return cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value);
  } catch {
    return false;
  }
}

async function waitForSession(context, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasSessionCookie(context)) return true;
    await sleep(2000);
  }
  return false;
}

async function dismissDialogs(page) {
  for (const label of [/^not now$/i, /^not now\./i, /^skip$/i]) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.count().catch(() => 0)) {
      await button.click().catch(() => {});
      await sleep(500);
    }
  }
}

function unwrapInstagramLink(raw) {
  try {
    const url = new URL(raw);
    if (url.hostname === 'l.instagram.com') {
      const target = url.searchParams.get('u');
      if (target && isHttpUrl(target)) return target;
    }
    return url.href;
  } catch {
    return raw;
  }
}

export function firstExternalUrl(text) {
  const matches = String(text ?? '').match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  for (const raw of matches) {
    const cleaned = unwrapInstagramLink(raw.replace(/[.,;:!?]+$/, ''));
    try {
      const parsed = new URL(cleaned);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (['instagram.com', 'facebook.com', 'threads.net', 'threads.com'].includes(host)) continue;
      if (isHttpUrl(cleaned)) return cleaned;
    } catch {
      // ignore malformed urls
    }
  }
  return null;
}

export function pickTitle(caption) {
  const cleaned = String(caption ?? '').replace(/\s+/g, ' ').trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18);

  const keyword = /(scholarship|fellowship|program(?:me)?|summit|conference|internship|exchange|grant|award|forum|training)/i;
  const boilerplate = /(opportunity\s+link|link\s+in\s+bio|apply\s+(here|now|via)|follow\s+us|join\s+(our|us)|read\s+more|click\s+here|source\s*:)/i;

  const scored = sentences.map((sentence, index) => {
    let score = 0;
    if (/20[2-3]\d/.test(sentence)) score += 2;
    if (keyword.test(sentence)) score += 3;
    if (sentence.length >= 40 && sentence.length <= 160) score += 2;
    if (index === 0) score += 1;
    if (/[?]$/.test(sentence)) score -= 1;
    if (boilerplate.test(sentence)) score -= 10;
    if (/https?:\/\//.test(sentence)) score -= 5;
    return { sentence, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length || a.index - b.index);
  const best = scored[0]?.sentence ?? cleaned;
  const title = best.replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return truncate(cleanTitle(title || cleaned), 160);
}

/** Read the profile grid: post links + caption alt text + bio link. */
async function scrapeProfile(page, handle) {
  await page.goto(`https://www.instagram.com/${handle}/`, { waitUntil: 'domcontentloaded' });
  await sleep(4500);

  if (/\/accounts\/login/i.test(page.url()) || (await page.locator('input[name="email"]').count())) {
    const error = new Error('Instagram session expired. Run: npm run instagram:login');
    error.code = 'IG_AUTH';
    throw error;
  }

  await page
    .locator('a[href*="/p/"], a[href*="/reel/"]')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {});

  const data = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')];
    const seen = new Set();
    const posts = [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const match = /\/(p|reel)\/([^/?#]+)/.exec(href);
      if (!match) continue;
      const key = match[2];
      if (seen.has(key)) continue;
      seen.add(key);

      const alts = [...anchor.querySelectorAll('img')]
        .map((img) => img.alt || '')
        .sort((a, b) => b.length - a.length);
      const caption = alts[0] || anchor.getAttribute('aria-label') || '';
      posts.push({
        shortcode: key,
        kind: match[1],
        caption,
      });
    }

    const header = document.querySelector('header');
    let bioLink = '';
    if (header) {
      const links = [...header.querySelectorAll('a[href^="http"]')]
        .map((a) => a.href)
        .filter((url) => {
          try {
            const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
            return !['instagram.com', 'facebook.com', 'threads.net', 'threads.com'].includes(host);
          } catch {
            return false;
          }
        });
      bioLink = links[0] || '';
    }

    if (!bioLink) {
      const html = document.documentElement.innerHTML;
      const direct = /"external_url":"(https:[^"]+)"/.exec(html);
      const shim = /https?:\\?\/\\?\/l\.instagram\.com\/\?u=[^"'\\\s<]+/.exec(html);
      const raw = direct?.[1] ?? shim?.[0] ?? '';
      if (raw) {
        bioLink = raw
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/')
          .replace(/&amp;/g, '&');
      }
    }

    const bodyText = document.body.innerText || '';
    const privateAccount = /this account is private/i.test(bodyText);
    const notFound = /sorry, this page isn[’']t available/i.test(bodyText);
    return { posts, bioLink, privateAccount, notFound };
  });

  if (data.privateAccount) {
    throw new Error(`Instagram account @${handle} is private`);
  }
  if (data.notFound) {
    throw new Error(`Instagram profile not found: @${handle}`);
  }

  return data;
}

const GENERIC_SLUGS = new Set([
  'apply', 'apply-now', 'details', 'link', 'link-in-bio', 'bio', 'home', 'index',
  'opportunity', 'opportunities', 'program', 'programme', 'programs', 'register',
]);

const SHORTENERS = new Set([
  'opd.to', 'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly',
  'rebrand.ly', 'shorturl.at', 'cutt.ly', 'rb.gy',
]);

const ACRONYMS = {
  fao: 'FAO', csc: 'CSC', un: 'UN', ai: 'AI', usa: 'USA', uk: 'UK', mun: 'MUN',
  stem: 'STEM', phd: 'PhD', faq: 'FAQ', ngo: 'NGO', eu: 'EU', unesco: 'UNESCO',
  undp: 'UNDP', unicef: 'UNICEF', who: 'WHO', ibci: 'IBCI', ceps: 'CEPS',
};

export function titleFromUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(unwrapInstagramLink(raw));
    if (['instagram.com', 'www.instagram.com', 'facebook.com', 'www.facebook.com', 'l.instagram.com'].includes(url.hostname)) {
      return null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    let slug = segments[segments.length - 1] || '';
    slug = decodeURIComponent(slug).replace(/\.(html?|php|aspx?)$/i, '');
    if (!slug || GENERIC_SLUGS.has(slug.toLowerCase()) || slug.length < 15) return null;

    const words = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    if (words.length < 2) return null;

    const minor = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
    const title = words
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (ACRONYMS[lower]) return ACRONYMS[lower];
        if (index > 0 && minor.has(lower)) return lower;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ')
      .replace(/\b(20\d{2})\s+(20\d{2})\b/g, '$1–$2');

    const keyword = /(scholarship|fellowship|program(?:me)?|summit|conference|internship|exchange|grant|award|forum|training|leadership)/i;
    if (!keyword.test(title) && !/20[2-3]\d/.test(title)) return null;
    return truncate(title, 160);
  } catch {
    return null;
  }
}

async function resolveApplyUrl(url) {
  try {
    const parsed = new URL(url);
    if (!SHORTENERS.has(parsed.hostname.toLowerCase())) return url;
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10_000),
    });
    return response.url && response.url !== url && isHttpUrl(response.url) ? response.url : url;
  } catch {
    return url;
  }
}

function opportunityKey(item) {
  if (item.applyUrl) {
    try {
      const url = new URL(item.applyUrl);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/\/+$/, '');
      if (path && path !== '/' && !/linktr\.ee|linkin\.bio|beacons\.ai|bio\.link/i.test(host)) {
        return `url:${canonicalUrl(item.applyUrl)}`;
      }
    } catch {
      // fall through to title
    }
  }
  return `title:${fingerprint(item.title)}`;
}

function postToItem(post, bioLink) {
  const caption = String(post.caption || '').trim();
  if (caption.length < 20) return null;

  const applyUrl = firstExternalUrl(caption) || (bioLink ? unwrapInstagramLink(bioLink) : null);
  const title = titleFromUrl(applyUrl) || pickTitle(caption);
  if (!title) return null;

  const url = canonicalUrl(`https://www.instagram.com/${post.kind}/${post.shortcode}/`);
  const bioNote = !firstExternalUrl(caption) && bioLink ? `\nProfile link: ${unwrapInstagramLink(bioLink)}` : '';

  return {
    title,
    url,
    summary: truncate(`${caption}${bioNote}`, 1400),
    publishedAt: null,
    applyUrl: applyUrl && isHttpUrl(applyUrl) ? applyUrl : null,
  };
}

async function fetchProfileInner(source) {
  if (authFailed) throw new Error('Instagram session is not valid. Run: npm run instagram:login');
  if (!hasInstagramSession()) {
    throw new Error('Instagram session not configured. Run: npm run instagram:login');
  }

  const handle = source.handle || source.channel;
  if (!handle) throw new Error(`Instagram source ${source.id} has no handle`);

  const context = await getSharedContext();
  if (!(await hasSessionCookie(context))) {
    authFailed = true;
    clearSessionMarker();
    throw new Error('Instagram session expired. Run: npm run instagram:login');
  }

  const page = await getSharedPage(context);
  try {
    const data = await scrapeProfile(page, handle);
    const items = data.posts
      .slice(0, source.maxItems ?? 12)
      .map((post) => postToItem(post, data.bioLink))
      .filter(Boolean);

    for (const item of items) {
      if (!item.applyUrl) continue;
      try {
        const host = new URL(item.applyUrl).hostname.toLowerCase();
        if (SHORTENERS.has(host)) {
          item.applyUrl = await resolveApplyUrl(item.applyUrl);
          const slugTitle = titleFromUrl(item.applyUrl);
          if (slugTitle) item.title = slugTitle;
        }
      } catch {
        // keep the original url
      }
    }

    const seen = new Map();
    for (const item of items) {
      const key = opportunityKey(item);
      const existing = seen.get(key);
      if (!existing || item.summary.length > existing.summary.length) {
        seen.set(key, item);
      }
    }

    await sleep(1800 + Math.floor(Math.random() * 1700));
    return [...seen.values()];
  } catch (error) {
    if (error.code === 'IG_AUTH') {
      authFailed = true;
      clearSessionMarker();
    }
    throw error;
  }
}

/** Serialized so eight profiles never hit Instagram at the same time. */
export function fetchInstagramProfile(source) {
  const run = queue.then(
    () => fetchProfileInner(source),
    () => fetchProfileInner(source),
  );
  queue = run.catch(() => {});
  return run;
}

export async function closeInstagram() {
  if (contextPromise) {
    try {
      const context = await contextPromise;
      await context.close();
    } catch {
      // ignore
    }
    contextPromise = null;
    pagePromise = null;
  }
}

/** Verify the stored session against a live profile and refresh the marker. */
export async function verifyInstagramSession() {
  const context = await getSharedContext();
  if (!(await hasSessionCookie(context))) {
    clearSessionMarker();
    throw new Error('Instagram session expired. Run: npm run instagram:login');
  }
  const page = await getSharedPage(context);
  const data = await scrapeProfile(page, 'yopportunities');
  if (!data.posts.length) {
    throw new Error('Instagram loaded no posts. Session may be limited; run: npm run instagram:login');
  }
  saveSessionMarker('instagram-session');
  return { posts: data.posts.length, bioLink: data.bioLink || null };
}

/**
 * One-time interactive login. If 2FA is enabled, either pass a fresh code or
 * leave the headed Chrome window open and complete it manually.
 */
export async function loginInstagram({ username, password, code, waitForManual = true, headless = false }) {
  ensureDirs();
  const context = await launchContext({ headless });
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(45_000);

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await dismissDialogs(page);

    const emailInput = page.locator('input[name="email"]');
    if (await emailInput.count()) {
      await emailInput.fill(username);
      await page.locator('input[name="pass"]').fill(password);
      await page.locator('input[name="pass"]').press('Enter');
      await sleep(9000);
    }

    if (/two_step_verification/i.test(page.url())) {
      if (code) {
        const codeInput = page.locator('input[type="text"]').first();
        await codeInput.waitFor({ state: 'visible', timeout: 30_000 });
        await codeInput.fill(String(code));
        const trust = page.locator('input[type="checkbox"]').first();
        if (await trust.count().catch(() => 0)) await trust.check().catch(() => {});
        await codeInput.press('Enter');
        await sleep(10_000);
      } else if (waitForManual) {
        process.stdout.write(
          'Instagram 2FA required. Complete it in the Chrome window and tick “Trust this device”. Waiting up to 5 minutes…\n',
        );
        const ok = await waitForSession(context, 300_000);
        if (!ok) throw new Error('Timed out waiting for 2FA. Re-run: npm run instagram:login');
      } else {
        throw new Error(
          'Instagram requires a 2FA code. Re-run with a fresh code: IG_2FA_CODE=123456 npm run instagram:login',
        );
      }
    }

    if (/challenge/i.test(page.url())) {
      if (waitForManual) {
        process.stdout.write(
          'Instagram opened a security challenge. Complete it in the Chrome window. Waiting up to 5 minutes…\n',
        );
        const ok = await waitForSession(context, 300_000);
        if (!ok) throw new Error('Timed out waiting for the Instagram challenge.');
      } else {
        throw new Error('Instagram opened a security challenge. Re-run: npm run instagram:login');
      }
    }

    if (!(await hasSessionCookie(context))) {
      const ok = await waitForSession(context, waitForManual ? 60_000 : 10_000);
      if (!ok) {
        throw new Error(
          'Login did not complete. Check the credentials or complete the browser prompt, then re-run: npm run instagram:login',
        );
      }
    }

    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(2500);
    await dismissDialogs(page);

    // Verify by reading a real profile; the old web_profile_info API is gone.
    const data = await scrapeProfile(page, 'yopportunities');
    if (!data.posts.length) throw new Error('Login succeeded but the profile grid was empty.');
    saveSessionMarker(username);
    return { username, posts: data.posts.length };
  } finally {
    await context.close();
  }
}
