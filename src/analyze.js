import { collapseWhitespace, dateKey, daysUntil, truncate } from './util.js';

const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_PATTERN = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const DEADLINE_CONTEXT =
  /(application\s+deadline|deadline|apply\s+by|applications?\s+(?:close|closes|due|accepted|must\s+be\s+(?:sent|submitted))|closing\s+date|last\s+date|due\s+date|submission\s+deadline|apply\s+before|no\s+later\s+than|submit(?:ted)?\s+by)/gi;

const ROLLING =
  /\b(rolling\s+deadline|rolling\s+basis|applications?\s+(?:are\s+)?(?:reviewed|accepted)\s+on\s+a\s+rolling|ongoing\s+(?:basis|deadline)|open\s+until\s+filled|no\s+(?:fixed\s+)?deadline|deadline\s*:\s*(?:rolling|ongoing|open))\b/i;

const FULLY_FUNDED = [
  /\bfully[\s-]?funded/gi,
  /\b100\s*%\s*(?:fully\s*)?funded/gi,
  /\bfully[\s-]?sponsored/gi,
  /\ball[\s-]?(?:expenses?|costs?)[\s-]?paid/gi,
  /\bfully[\s-]?covered/gi,
  /\bfull[\s-]?funding/gi,
  /\b(?:covers?|includes?|provides?)\s+(?:all|full)\s+(?:costs?|expenses?|travel|flights?|accommodation|tuition)\b/gi,
];

const NOT_FULLY_FUNDED = [
  /\bself[\s-]?funded\b/gi,
  /\bself[\s-]?financed\b/gi,
  /\bself[\s-]?sponsored\b/gi,
  /\bpartially[\s-]?funded\b/gi,
  /\bpart(?:ial)?[\s-]?funded\b/gi,
  /\bpartial\s+(?:scholarship|funding|grant)\b/gi,
  /\bunfunded\b/gi,
  /\bpay\s+(?:your|their|his|her)\s+own\b/gi,
  /\bat\s+your\s+own\s+expense\b/gi,
  /\btuition[\s-]?only\b/gi,
];

const FEE_TERMS =
  /\b(?:application|processing|registration|program(?:me)?|participation|entry|admin(?:istration)?|service|booking|seat|late)\s+fees?\b|\bfee\s+of\s+(?:US\$|USD|EUR|GBP|€|£|\$)?\s?\d[\d,.]*/gi;

const NEGATION =
  /\b(no|not|none|never|zero|without|free|exempt|does\s*n[o']?t\s+charge|do\s*n[o']?t\s+charge|is\s*n[o']?t|are\s*n[o']?t)\b/i;

// "The program fee is covered by the host" means the fee is not charged to you.
const FEE_COVERED_AFTER =
  /^\s*(?:is|are|will\s+be|shall\s+be)?\s*(?:fully\s+|entirely\s+)?(?:covered|waived|included|reimbursed|paid\s+by\s+(?:the\s+)?(?:host|organi[sz]ers?|program(?:me)?|university))\b/i;

const OPPORTUNITY_TERMS =
  /\b(scholarships?|fellowships?|grants?|conferences?|summits?|forums?|exchanges?|internships?|summer\s+schools?|winter\s+schools?|programs?|programmes?|awards?|competitions?|delegates?|opportunit(?:y|ies)|symposium|symposia|workshops?|trainings?)\b/i;

const LISTICLE =
  /^\s*(?:top\s+\d+|\d+\s+(?:best\s+)?(?:scholarships|fellowships|grants|conferences|summits|opportunities)|(?:latest|new)\s+(?:scholarships|opportunities|fellowships))/i;

const STRONG_PROGRAM_TERMS =
  /\b(scholarships?|fellowships?|grants?|conferences?|summits?|exchanges?|summer\s+schools?|winter\s+schools?|internships?|delegates?)\b/i;

function positions(re, text) {
  const found = [];
  if (!re.global) re = new RegExp(re.source, re.flags + 'g');
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    found.push({ index: match.index, text: match[0] });
    if (found.length >= 12) break;
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return found;
}

/**
 * A term is negated when the closest clause around it contains a negation.
 * The clause is re-started at sentence/semicolon/newline boundaries so that
 * "no application fee, but a $200 program fee" still catches the program fee.
 */
function isNegated(text, index, length, { checkAfter = true } = {}) {
  const beforeRaw = text.slice(Math.max(0, index - 55), index);
  const boundary = Math.max(
    beforeRaw.lastIndexOf('.'),
    beforeRaw.lastIndexOf(';'),
    beforeRaw.lastIndexOf('\n'),
    beforeRaw.lastIndexOf('!'),
    beforeRaw.lastIndexOf('?'),
  );
  // Contrast words start a new clause: "no application fee, but a $200 program fee".
  let contrastEnd = -1;
  for (const match of beforeRaw.matchAll(/\b(?:but|however|although|yet|while)\b/gi)) {
    contrastEnd = Math.max(contrastEnd, (match.index ?? 0) + match[0].length);
  }
  const clauseStart = Math.max(boundary + 1, contrastEnd);
  const before = beforeRaw.slice(clauseStart);
  const after = checkAfter ? text.slice(index + length, index + length + 48) : '';
  if (checkAfter && FEE_COVERED_AFTER.test(after)) return true;
  return NEGATION.test(`${before} ${after}`);
}

function activeHits(patterns, text, options = {}) {
  const hits = [];
  for (const pattern of patterns) {
    for (const hit of positions(pattern, text)) {
      if (!isNegated(text, hit.index, hit.text.length, options)) hits.push(hit);
    }
  }
  return hits;
}

function buildIsoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function inferYear(month, day, now) {
  const year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return candidate < today ? year + 1 : year;
}

/** Parse the first plausible calendar date inside a short snippet. */
export function parseDateIn(text, now = new Date()) {
  if (!text) return null;

  let match = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) {
    const iso = buildIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (iso) return iso;
  }

  match = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})[a-z]*\\.?,?\\s*(20\\d{2})?\\b`, 'i'),
  );
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    const year = match[3] ? Number(match[3]) : inferYear(month, day, now);
    const iso = buildIsoDate(year, month, day);
    if (iso) return iso;
  }

  match = text.match(
    new RegExp(`\\b(${MONTH_PATTERN})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})?\\b`, 'i'),
  );
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = match[3] ? Number(match[3]) : inferYear(month, day, now);
    const iso = buildIsoDate(year, month, day);
    if (iso) return iso;
  }

  match = text.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (match) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const year = Number(match[3]);
    let day = a;
    let month = b;
    if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      day = b;
      month = a;
    }
    const iso = buildIsoDate(year, month, day);
    if (iso) return iso;
  }

  return null;
}

/**
 * Extract the application deadline, preferring dates that appear next to a
 * deadline keyword. Event dates elsewhere in the page are intentionally ignored.
 */
export function extractDeadline(text, now = new Date()) {
  if (!text) return { date: null, label: null };
  const clean = collapseWhitespace(text);

  if (ROLLING.test(clean)) return { date: null, label: 'Rolling' };

  const windows = [];
  DEADLINE_CONTEXT.lastIndex = 0;
  let match;
  while ((match = DEADLINE_CONTEXT.exec(clean)) !== null) {
    windows.push(clean.slice(Math.max(0, match.index - 45), match.index + 190));
    if (windows.length >= 10) break;
  }

  for (const window of windows) {
    const iso = parseDateIn(window, now);
    if (iso) return { date: iso, label: null };
  }
  return { date: null, label: null };
}

function analyzeFees(text) {
  const mentions = positions(FEE_TERMS, text);
  if (mentions.length === 0) return { charged: false, explicitFree: false, evidence: null };

  let charged = false;
  let evidence = null;
  let explicitFree = false;
  for (const mention of mentions) {
    if (isNegated(text, mention.index, mention.text.length)) {
      explicitFree = true;
      continue;
    }
    charged = true;
    evidence = mention.text;
    break;
  }
  return { charged, explicitFree, evidence };
}

function pickReason({ fullyFunded, feeCharged, feeEvidence, deadline, listicle }) {
  if (feeCharged) return `Mentions a ${feeEvidence ?? 'fee'} — excluded by your no-fee rule.`;
  if (fullyFunded === 'mixed') return 'Mentions both fully funded and self-funded/partial options — possible bait-and-switch.';
  if (fullyFunded === false) return 'Explicitly self-funded, partial, or unfunded.';
  if (listicle) return 'Roundup article, not a single opportunity — pick one manually.';
  if (fullyFunded === true) {
    return deadline
      ? 'States fully funded; no application/registration fee mentioned.'
      : 'States fully funded; no fee mentioned. Confirm the deadline on the official page.';
  }
  return 'Funding level is not explicit — needs a manual check.';
}

/**
 * Strict heuristic classifier. The rule the user cares about:
 * only keep programs that state full funding AND show no application/registration fee.
 */
export function classify(item, { now = new Date() } = {}) {
  const text = collapseWhitespace(
    `${item.title ?? ''}\n${item.summary ?? ''}\n${item.pageText ?? ''}`,
  );

  const deadlineInfo = extractDeadline(text, now);
  const fee = analyzeFees(text);
  const fullHits = activeHits(FULLY_FUNDED, text, { checkAfter: false });
  const negativeHits = activeHits(NOT_FULLY_FUNDED, text, { checkAfter: false });

  let fullyFunded = 'unknown';
  if (fullHits.length && negativeHits.length) fullyFunded = 'mixed';
  else if (fullHits.length) fullyFunded = true;
  else if (negativeHits.length) fullyFunded = false;

  const relevant = OPPORTUNITY_TERMS.test(text);
  const strong = STRONG_PROGRAM_TERMS.test(text);
  const listicle = LISTICLE.test(item.title ?? '');

  let status = 'rejected';
  if (!relevant) {
    status = 'rejected';
  } else if (fee.charged) {
    status = 'rejected';
  } else if (fullyFunded === false) {
    status = 'rejected';
  } else if (fullyFunded === 'mixed') {
    status = 'review';
  } else if (listicle) {
    status = 'review';
  } else if (fullyFunded === true) {
    status = 'accepted';
  } else if (strong && fullHits.length === 0) {
    status = 'review';
  }

  // A deadline that is already in the past means the call is closed.
  const daysLeft = deadlineInfo.date ? daysUntil(deadlineInfo.date, now) : null;
  if (status !== 'rejected' && daysLeft !== null && daysLeft < -1) {
    status = 'expired';
  }

  const reason = pickReason({
    fullyFunded,
    feeCharged: fee.charged,
    feeEvidence: fee.evidence,
    deadline: deadlineInfo.date,
    listicle,
  });

  return {
    ...item,
    status,
    fullyFunded,
    applicationFee: fee.charged ? 'charged' : fee.explicitFree ? 'none-stated' : 'not-mentioned',
    deadline: deadlineInfo.date,
    deadlineLabel: deadlineInfo.label,
    daysLeft,
    reason,
    confidence:
      status === 'accepted' && fullHits.length > 0 && !fee.charged ? (fee.explicitFree ? 0.9 : 0.75) : 0.5,
    signals: {
      fullyFunded: fullHits.slice(0, 3).map((h) => h.text),
      negative: negativeHits.slice(0, 3).map((h) => h.text),
      fee: fee.evidence,
    },
  };
}

/** Merge an LLM verdict into a heuristic classification. */
export function mergeVerdict(item, verdict) {
  if (!verdict || typeof verdict !== 'object') return item;
  if (typeof verdict.fullyFunded !== 'boolean' || typeof verdict.applicationFee !== 'boolean') {
    return item;
  }

  const accepted = verdict.fullyFunded === true && verdict.applicationFee === false;
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(verdict.deadline ?? ''))
    ? verdict.deadline
    : item.deadline;

  return {
    ...item,
    status: accepted ? 'accepted' : 'rejected',
    fullyFunded: verdict.fullyFunded,
    applicationFee: verdict.applicationFee ? 'charged' : 'none-stated',
    deadline,
    daysLeft: deadline ? daysUntil(deadline) : null,
    reason: truncate(verdict.reason || (accepted ? 'Verified fully funded, no fee.' : 'Rejected by AI review.'), 180),
    location: truncate(verdict.location || item.location || '', 80),
    category: truncate(verdict.category || item.category || '', 40),
    confidence: Number.isFinite(verdict.confidence) ? Math.min(1, Math.max(0, verdict.confidence)) : item.confidence,
    verifiedBy: 'opencode',
  };
}

export function isNewToday(item, now = new Date()) {
  return item.firstSeen === dateKey(now);
}
