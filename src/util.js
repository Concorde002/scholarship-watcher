import { createHash } from 'node:crypto';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Decode the handful of HTML entities that show up in feeds and titles. */
export function decodeEntities(input = '') {
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(value) && value > 0 && value <= 0x10ffff) {
        try {
          return String.fromCodePoint(value);
        } catch {
          return match;
        }
      }
      return match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Turn an HTML fragment into a readable single-line string. */
export function stripHtml(input = '') {
  return decodeEntities(
    String(input)
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function collapseWhitespace(input = '') {
  return String(input).replace(/\s+/g, ' ').trim();
}

export function truncate(input = '', max = 200, suffix = '…') {
  const text = collapseWhitespace(input);
  if (text.length <= max) return text;
  return text.slice(0, max - suffix.length).trimEnd() + suffix;
}

/** Remove tracking params and normalize the URL so the same post dedupes. */
export function canonicalUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    url.hash = '';
    const dropExact = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'referrer']);
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || dropExact.has(lower)) url.searchParams.delete(key);
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch {
    return String(raw ?? '');
  }
}

export function sha1(input) {
  return createHash('sha1').update(String(input)).digest('hex');
}

export function itemId(url) {
  return sha1(canonicalUrl(url)).slice(0, 12);
}

/** Used to spot the same opportunity reposted under a different URL. */
export function fingerprint(title) {
  const normalized = decodeEntities(String(title ?? ''))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|and|or|of|for|to|in|on|at|with|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 110) || sha1(title).slice(0, 16);
}

/** Local calendar date key (deadlines are calendar dates, not instants). */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from today until an ISO YYYY-MM-DD deadline (negative = past). */
export function daysUntil(deadline, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline))) return null;
  const [y, m, d] = deadline.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function formatDate(iso, { withYear = true } = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function escapeHtml(input = '') {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run an async mapper with a bounded number of in-flight tasks. */
export async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Clean noisy feed titles that concatenate the article body onto the title. */
export function cleanTitle(input = '') {
  let text = stripHtml(input)
    .replace(/([a-z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cuts = [
    /\bApplications?\s+(?:are|is)\s+(?:now\s+)?open\b/i,
    /\bApply\s+(?:here|now|for|via|online)\b/i,
    /\b(?:To|How\s+to)\s+Apply\b/i,
    /\bApply\s+(?:through|using)\b/i,
    /\bStudy\s+Level\s*:/i,
    /\bDegree\s+Level\s*:/i,
    /\bProgram(?:me)?\s+Dates?\s*:/i,
    /\bDuration\s*:/i,
    /\s*(?:\(\s*)?No\s+Application\s+Fee\b/i,    /\bLink\s*:/i,
    /\bBenefits?\s*:/i,
    /\bEligibility\s*:/i,
    /\b(?:Click|Read)\s+(?:here|more)\b/i,
  ];

  for (const pattern of cuts) {
    const index = text.search(pattern);
    if (index >= 20) text = text.slice(0, index);
  }

  return text
    .replace(/[\s|·•,;:-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_STOPWORDS = new Set(
  'a an the and or of for to in on at with by from fully funded funding sponsor sponsored scholarship scholarships fellowship fellowships program programme opportunity opportunities apply application deadline 2026 2027'.split(
    ' ',
  ),
);

const TOKEN_ALIASES = {
  un: ['united', 'nations'],
  eu: ['european', 'union'],
  uk: ['united', 'kingdom'],
  usa: ['united', 'states'],
  us: ['united', 'states'],
};

export function titleTokens(title) {
  const tokens = decodeEntities(String(title ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);

  const expanded = [];
  for (const token of tokens) {
    if (TOKEN_ALIASES[token]) {
      expanded.push(...TOKEN_ALIASES[token]);
    } else if (token.length > 1 && !TITLE_STOPWORDS.has(token)) {
      expanded.push(token);
    }
  }
  return new Set(expanded);
}

const COUNTRY_ALIASES = {
  usa: 'us', us: 'us', 'united states': 'us', america: 'us',
  uk: 'uk', 'united kingdom': 'uk', britain: 'uk', england: 'uk', scotland: 'uk',
  canada: 'canada', germany: 'germany', france: 'france', japan: 'japan', china: 'china',
  italy: 'italy', spain: 'spain', netherlands: 'netherlands', holland: 'netherlands',
  sweden: 'sweden', norway: 'norway', denmark: 'denmark', finland: 'finland',
  switzerland: 'switzerland', austria: 'austria', belgium: 'belgium', poland: 'poland',
  portugal: 'portugal', ireland: 'ireland', australia: 'australia', 'new zealand': 'new zealand',
  'south korea': 'south korea', korea: 'south korea', singapore: 'singapore',
  malaysia: 'malaysia', india: 'india', pakistan: 'pakistan', bangladesh: 'bangladesh',
  turkey: 'turkey', egypt: 'egypt', 'south africa': 'south africa', kenya: 'kenya',
  nigeria: 'nigeria', ghana: 'ghana', uae: 'uae', dubai: 'uae', 'saudi arabia': 'saudi arabia',
  qatar: 'qatar', brazil: 'brazil', mexico: 'mexico', argentina: 'argentina', chile: 'chile',
  indonesia: 'indonesia', thailand: 'thailand', vietnam: 'vietnam', philippines: 'philippines',
  taiwan: 'taiwan', 'hong kong': 'hong kong', russia: 'russia', ukraine: 'ukraine',
  greece: 'greece', czech: 'czechia', hungary: 'hungary', romania: 'romania',
  luxembourg: 'luxembourg', iceland: 'iceland', estonia: 'estonia', latvia: 'latvia',
  lithuania: 'lithuania', croatia: 'croatia', slovenia: 'slovenia', slovakia: 'slovakia',
  bulgaria: 'bulgaria', serbia: 'serbia', morocco: 'morocco', tunisia: 'tunisia',
  algeria: 'algeria', jordan: 'jordan', lebanon: 'lebanon', israel: 'israel',
  iran: 'iran', iraq: 'iraq', armenia: 'armenia', georgia: 'georgia',
  azerbaijan: 'azerbaijan', kazakhstan: 'kazakhstan', uzbekistan: 'uzbekistan',
  mongolia: 'mongolia', nepal: 'nepal', 'sri lanka': 'sri lanka', myanmar: 'myanmar',
  cambodia: 'cambodia', laos: 'laos', brunei: 'brunei',
};

function titleCountries(title) {
  const text = ` ${String(title ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const found = new Set();
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (text.includes(` ${alias} `)) found.add(code);
  }
  return found;
}

/** True when two headlines describe the same program (same tokens, or close). */
export function similarTitles(left, right) {
  const countriesA = titleCountries(left);
  const countriesB = titleCountries(right);
  if (countriesA.size && countriesB.size) {
    const shared = [...countriesA].some((country) => countriesB.has(country));
    if (!shared) return false;
  }

  const a = titleTokens(left);
  const b = titleTokens(right);
  if (a.size === 0 || b.size === 0) return false;
  if (a.size < 3 || b.size < 3) {
    return [...a].join(' ').toLowerCase() === [...b].join(' ').toLowerCase();
  }
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  if (intersection < 3) return false;
  const union = a.size + b.size - intersection;
  return intersection / union >= 0.5;
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
