import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageProfile,
  describeAge,
  detectFormat,
  extractAgePolicy,
  extractAgeRange,
  isConference,
  matchesAudience,
} from '../src/eligibility.js';
import { prepareDigest, renderHtml, renderText, subjectFor } from '../src/digest.js';

test('age policy recognises an under-18 age range', () => {
  const policy = extractAgePolicy('Open to high-school delegates aged 15–17 from any country.');
  assert.equal(policy.under18, 'yes');
  assert.equal(policy.label, 'Ages 15–17');
  assert.equal(policy.minAge, 15);
  assert.equal(policy.maxAge, 17);
});

test('age policy recognises an adult-only age range', () => {
  const policy = extractAgePolicy('Applicants must be between 18 and 40 years old.');
  assert.equal(policy.under18, 'no');
  assert.equal(policy.label, 'Ages 18–40');
});

test('age policy recognises 18+ wording', () => {
  assert.equal(extractAgePolicy('This conference is open to delegates 18+ only.').under18, 'no');
  assert.equal(extractAgePolicy('You must be at least 18 to apply.').under18, 'no');
});

test('age policy recognises high-school and teenage audiences', () => {
  assert.equal(extractAgePolicy('A summit for high school students in Brussels.').under18, 'yes');
  assert.equal(extractAgePolicy('Open to teenagers aged 14 to 19.').under18, 'yes');
  assert.equal(extractAgePolicy('Submit your high school transcripts and degree certificates.').under18, 'unknown');
});

test('age policy keeps "no age limit" as unstated rather than confirmed under-18', () => {
  const policy = extractAgePolicy('There is no age limit for this fellowship.');
  assert.equal(policy.under18, 'unknown');
  assert.equal(policy.label, 'No age limit');
});

test('age policy stays unknown when nothing is stated', () => {
  const policy = extractAgePolicy('Fully funded conference in Germany. Deadline 15 January 2027.');
  assert.equal(policy.under18, 'unknown');
  assert.equal(policy.label, null);
  assert.match(describeAge(policy), /not stated/i);
});

test('age ranges ignore durations and dates', () => {
  assert.equal(extractAgeRange('The programme runs for between 2 and 3 months.'), null);
  assert.equal(extractAgeRange('Between October 1, 2027 and March 31, 2028.'), null);
  assert.deepEqual(extractAgeRange('Eligible ages 16 to 24.'), { min: 16, max: 24 });
});

test('stored or LLM age verdicts take priority over text parsing', () => {
  const policy = ageProfile({
    title: 'Youth Summit 2027',
    summary: 'No age limit stated.',
    under18: 'no',
    ageLabel: '18–35',
  });
  assert.equal(policy.under18, 'no');
  assert.equal(policy.label, '18–35');
});

test('conference detection uses titles and categories, not noisy summaries', () => {
  assert.equal(isConference({ title: 'World Leaders Convention 2027' }), true);
  assert.equal(isConference({ title: 'Future Diplomats Forum 2027, Geneva' }), true);
  assert.equal(isConference({ title: 'Fully Funded PhD Programme', summary: 'Attend a conference in Berlin.' }), false);
  assert.equal(isConference({ title: 'Anything', category: 'Summit' }), true);
  assert.equal(detectFormat({ title: 'Global Youth Summit 2027' }), 'Summit');
});

test('audience matching can include or exclude unknown ages', () => {
  const conference = { title: 'Global Youth Forum 2027', under18: 'unknown' };
  const adults = { title: 'Global Youth Forum 2027', under18: 'no' };

  assert.equal(matchesAudience(conference, { under18: true, conferencesOnly: true }), true);
  assert.equal(matchesAudience(conference, { under18: true, conferencesOnly: true, strict: true }), false);
  assert.equal(matchesAudience(adults, { under18: true, conferencesOnly: true }), false);
  assert.equal(matchesAudience({ title: 'Fully Funded Scholarship', under18: 'yes' }, { conferencesOnly: true }), false);
});

function digestItem(id, overrides = {}) {
  return {
    id,
    title: `Opportunity ${id}`,
    url: `https://example.com/${id}`,
    sourceName: 'Test',
    deadline: '2027-01-15',
    firstSeen: '2026-11-09',
    reason: 'States fully funded.',
    ...overrides,
  };
}

test('digest applies the under-18 conference filter', () => {
  const now = new Date(2026, 10, 9, 8, 0, 0);
  const items = [
    digestItem('adult', { title: 'Adults Only Summit 2027', category: 'Summit', under18: 'no' }),
    digestItem('teen', { title: 'Teen Leaders Summit 2027', category: 'Summit', under18: 'yes', ageLabel: '15–17' }),
    digestItem('unknown', { title: 'Global Forum 2027', category: 'Conference', under18: 'unknown' }),
    digestItem('scholarship', { title: 'Fully Funded Scholarship 2027', under18: 'yes' }),
  ];

  const practical = prepareDigest({
    now,
    accepted: items,
    newIds: new Set(items.map((item) => item.id)),
    filters: { under18: true, conferencesOnly: true },
  });
  assert.equal(practical.audience.active, true);
  assert.equal(practical.audience.label, 'Under-18 conferences');
  assert.deepEqual(
    practical.sections.flatMap((section) => section.items.map((item) => item.id)).sort(),
    ['teen', 'unknown'],
  );
  assert.equal(practical.counts.filteredOut, 2);
  assert.match(subjectFor(practical), /Under-18 conferences/);
  assert.match(renderText(practical), /Age: 15–17 · under-18 eligible/);
  assert.match(renderText(practical), /Age not stated/);
  assert.match(renderHtml(practical), /<strong>Age:<\/strong>/);

  const strict = prepareDigest({
    now,
    accepted: items,
    newIds: new Set(items.map((item) => item.id)),
    filters: { under18: true, conferencesOnly: true, strict: true },
  });
  assert.deepEqual(
    strict.sections.flatMap((section) => section.items.map((item) => item.id)),
    ['teen'],
  );
});

test('empty audience digest does not advertise the adult watchlist', () => {
  const digest = prepareDigest({
    now: new Date(2026, 10, 9),
    accepted: [],
    newIds: new Set(),
    filters: { under18: true, conferencesOnly: true },
  });
  assert.equal(digest.empty, true);
  const text = renderText(digest);
  assert.doesNotMatch(text, /One Young World/);
  assert.match(text, /under-18 conferences/i);
});

test('under-18 opportunities includes scholarships, fellowships and conferences', () => {
  const now = new Date(2026, 10, 9, 8, 0, 0);
  const items = [
    digestItem('scholarship', { title: 'Fully Funded Scholarship 2027', under18: 'yes', ageLabel: '16–18' }),
    digestItem('fellowship', { title: 'Fully Funded Fellowship 2027', under18: 'yes', ageLabel: '15–17' }),
    digestItem('conference', { title: 'Global Youth Summit 2027', category: 'Summit', under18: 'yes', ageLabel: '14–18' }),
    digestItem('adult', { title: 'Adults Only Summit 2027', category: 'Summit', under18: 'no' }),
    digestItem('unknown', { title: 'Age Unstated Fellowship 2027', under18: 'unknown' }),
  ];

  const digest = prepareDigest({
    now,
    accepted: items,
    newIds: new Set(items.map((item) => item.id)),
    filters: { under18: true, strict: true },
  });

  assert.equal(digest.audience.label, 'Under-18 opportunities');
  assert.equal(digest.audience.noun, 'under-18 opportunities');
  assert.deepEqual(
    [...digest.sections.flatMap((section) => section.items.map((item) => item.id))].sort(),
    ['conference', 'fellowship', 'scholarship'],
  );
  assert.match(renderText(digest), /Age: 15–17/);
  assert.match(subjectFor(digest), /Under-18 opportunities/);
});

test('an empty under-18 opportunity digest still produces a sendable email', () => {
  const digest = prepareDigest({
    now: new Date(2026, 10, 9),
    accepted: [],
    newIds: new Set(),
    filters: { under18: true, strict: true },
  });
  assert.equal(digest.empty, true);
  assert.match(subjectFor(digest), /no under-18 opportunities today/);
  const text = renderText(digest);
  assert.match(text, /No under-18 opportunities passed the filter today/);
  assert.match(text, /explicitly state under-18 eligibility/);
  assert.match(renderHtml(digest), /No under-18 opportunities passed the filter today/);
});
