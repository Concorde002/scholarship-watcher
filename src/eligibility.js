/**
 * Audience filtering.
 *
 * The watcher should be able to answer one narrow question: "is this
 * conference actually open to someone under 18?" Sources are inconsistent
 * about age limits, so the result is deliberately three-state:
 *
 *   yes     - explicitly open to under-18s (age range includes 17 or below,
 *             or the audience is high-school / teenage students)
 *   no      - explicitly restricted to 18+ / adults
 *   unknown - no age policy stated
 *
 * "unknown" is kept separate instead of being guessed either way. The digest
 * can either include those with an "age not stated" note or drop them.
 */

const CONFERENCE_TERMS =
  /\b(conferences?|summits?|forums?|congress(?:es)?|conventions?|symposium|symposia|model\s+united\s+nations|\bmun\b|youth\s+assembly|assemblies|conclave|policy\s+dialogue|roundtables?)\b/i;

const UNDER_18_TERMS = [
  /\bunder\s+(?:the\s+age\s+of\s+)?(?:18|eighteen)\b/i,
  /\bbelow\s+(?:the\s+age\s+of\s+)?(?:18|eighteen)\b/i,
  /\byounger\s+than\s+(?:18|eighteen)\b/i,
  /\b(?:18|eighteen)\s*(?:and|or)\s*(?:under|younger)\b/i,
  /\bminors?\b/i,
  /\bteenagers?\b/i,
  /\bhigh[\s-]?school(?:ers?|\s+students?|\s+pupils?)?\b/i,
  /\bsecondary[\s-]?school\s+(?:students?|pupils?)\b/i,
  /(?:^|\s)(?:primary|middle)\s+school\s+students?\b/i,
];

const ADULT_ONLY_TERMS = [
  /\b(?:18|eighteen)\s*\+/i,
  /\b(?:18|eighteen)\s*(?:years?|yrs?)?\s*(?:or|and)\s*(?:older|above|over|more)\b/i,
  /\b(?:at\s+least|minimum(?:\s+age)?(?:\s+of)?|must\s+be(?:\s+at\s+least)?|aged?|age\s+of|over|above)\s*(?:18|eighteen)\b/i,
  /\bnot\s+(?:be\s+)?(?:under|younger\s+than)\s*(?:18|eighteen)\b/i,
  /\bmust\s+(?:have\s+)?(?:turned|be)\s*(?:18|eighteen)\b/i,
];

const NO_AGE_LIMIT =
  /\b(?:no|without\s+(?:an?\s+)?)\s*age\s*(?:limit|restriction|requirement)\b|\b(?:all|any)\s+ages\b|\bopen\s+to\s+(?:all|any)\s+ages\b/i;

/** "between 2 and 3 months" is not an age range. */
const NON_AGE_UNIT = /^\s*(?:days?|weeks?|months?|hours?|minutes?|%|percent|participants?|delegates?|seats?)\b/i;

function normalizeDashes(value) {
  return String(value ?? '').replace(/[–—]/g, '-');
}

function validAgeRange(min, max) {
  return (
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 10 &&
    max <= 80 &&
    min <= max
  );
}

/**
 * Pull the first credible age range out of a piece of text.
 * Returns { min, max } or null.
 */
export function extractAgeRange(text) {
  if (!text) return null;
  const clean = normalizeDashes(text);

  // "aged 15-17", "ages 14 to 18", "between 18 and 40", "age: 16 - 30".
  const contextual =
    /(?:aged?|ages?|age\s+(?:group|range|limit)|between|open\s+to)\s*:?\s*(\d{1,2})\s*(?:-|to|and)\s*(\d{1,2})\b/gi;
  let match;
  while ((match = contextual.exec(clean)) !== null) {
    const min = Number(match[1]);
    const max = Number(match[2]);
    const after = clean.slice(match.index + match[0].length);
    if (NON_AGE_UNIT.test(after)) continue;
    if (validAgeRange(min, max)) return { min, max };
  }

  // "15-17 years old", "18 to 35 years of age".
  const withUnit = /\b(\d{1,2})\s*(?:-|to|and)\s*(\d{1,2})\s*(?:years?|yrs?)\s*(?:old|of\s+age)\b/gi;
  while ((match = withUnit.exec(clean)) !== null) {
    const min = Number(match[1]);
    const max = Number(match[2]);
    if (validAgeRange(min, max)) return { min, max };
  }

  return null;
}

/**
 * Extract an age policy from free text.
 * @returns {{under18: 'yes'|'no'|'unknown', label: string|null, minAge: number|null, maxAge: number|null, evidence: string|null}}
 */
export function extractAgePolicy(text) {
  const clean = String(text ?? '');
  if (!clean) {
    return { under18: 'unknown', label: null, minAge: null, maxAge: null, evidence: null };
  }

  const range = extractAgeRange(clean);
  if (range) {
    return {
      under18: range.min <= 17 ? 'yes' : 'no',
      label: `Ages ${range.min}–${range.max}`,
      minAge: range.min,
      maxAge: range.max,
      evidence: `ages ${range.min}–${range.max}`,
    };
  }

  const under = UNDER_18_TERMS.map((pattern) => pattern.exec(clean)).find(Boolean);
  if (under) {
    const evidence = under[0].trim();
    let label = 'Under 18';
    if (/high[\s-]?school|secondary[\s-]?school|primary|middle\s+school/i.test(evidence)) {
      label = 'High-school students';
    } else if (/teenager|minor|adolescent/i.test(evidence)) {
      label = 'Teenagers';
    }
    return { under18: 'yes', label, minAge: null, maxAge: 17, evidence };
  }

  const adult = ADULT_ONLY_TERMS.map((pattern) => pattern.exec(clean)).find(Boolean);
  if (adult) {
    return {
      under18: 'no',
      label: '18+',
      minAge: 18,
      maxAge: null,
      evidence: adult[0].trim(),
    };
  }

  if (NO_AGE_LIMIT.test(clean)) {
    return {
      under18: 'yes',
      label: 'All ages',
      minAge: null,
      maxAge: null,
      evidence: NO_AGE_LIMIT.exec(clean)?.[0] ?? 'no age limit',
    };
  }

  return { under18: 'unknown', label: null, minAge: null, maxAge: null, evidence: null };
}

/** Text fields that are available both before and after the item is stored. */
function itemText(item = {}) {
  return [
    item.title,
    item.summary,
    item.pageText,
    item.reason,
    item.eventDate,
    item.category,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Resolve an item's age policy, preferring an explicit stored/LLM verdict over
 * re-parsing the (possibly truncated) stored summary.
 */
export function ageProfile(item = {}) {
  const inferred = extractAgePolicy(itemText(item));
  if (item.under18 === 'yes' || item.under18 === 'no') {
    return {
      ...inferred,
      under18: item.under18,
      label: item.ageLabel || inferred.label,
    };
  }
  if (item.under18 === 'unknown') {
    return { ...inferred, under18: 'unknown', label: item.ageLabel || inferred.label };
  }
  return inferred;
}

/** Human sentence for the email and dashboard. */
export function describeAge(profile) {
  if (!profile || profile.under18 === 'unknown') return 'Age not stated — confirm under-18 eligibility';
  if (profile.under18 === 'yes') return `${profile.label ?? 'Under 18'} · under-18 eligible`;
  return `${profile.label ?? '18+'} · adults only`;
}

/** Conference / summit / forum style event, as opposed to a degree scholarship. */
export function isConference(item = {}) {
  const category = String(item.category ?? '').toLowerCase();
  if (category.includes('conference') || category.includes('summit')) return true;
  // Titles only. Summaries routinely mention "conference" in unrelated posts,
  // which would sweep PhD programmes and scholarships into the conference filter.
  return CONFERENCE_TERMS.test(String(item.title ?? ''));
}

/** Broad display format, used for labels and filters. */
export function detectFormat(item = {}) {
  const category = String(item.category ?? '').toLowerCase();
  if (category.includes('conference')) return 'Conference';
  if (category.includes('summit')) return 'Summit';
  if (category.includes('fellowship')) return 'Fellowship';
  if (category.includes('scholarship')) return 'Scholarship';
  if (category.includes('internship')) return 'Internship';
  if (category.includes('exchange')) return 'Exchange';
  if (category.includes('grant')) return 'Grant';

  const text = [item.title, item.summary].filter(Boolean).join('\n');
  if (/\bsummit\b/i.test(text)) return 'Summit';
  if (/\bconference\b/i.test(text)) return 'Conference';
  if (/\bforum\b/i.test(text)) return 'Forum';
  if (/\bfellowship\b/i.test(text)) return 'Fellowship';
  if (/\bscholarship\b/i.test(text)) return 'Scholarship';
  if (/\binternship\b/i.test(text)) return 'Internship';
  if (/\bgrant\b/i.test(text)) return 'Grant';
  return 'Other';
}

/**
 * Should this item be included for a given audience?
 * `under18` is three-state; `strict` decides what happens to unknown ages.
 */
export function matchesAudience(item, { under18 = false, conferencesOnly = false, strict = false } = {}) {
  if (conferencesOnly && !isConference(item)) return false;
  if (!under18) return true;
  const profile = ageProfile(item);
  if (profile.under18 === 'no') return false;
  if (strict && profile.under18 !== 'yes') return false;
  return true;
}
