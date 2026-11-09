import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractDeadline, mergeVerdict, parseDateIn } from '../src/analyze.js';

const NOW = new Date('2026-11-09T12:00:00');

function item(overrides = {}) {
  return {
    id: 'abc123',
    title: 'Fully Funded Conference in Germany 2027',
    summary: 'Deadline: 15 January 2027. Open to young leaders worldwide.',
    sourceName: 'Test',
    url: 'https://example.com/opportunity',
    publishedAt: '2026-11-08T00:00:00.000Z',
    ...overrides,
  };
}

test('accepts a fully funded program with no fee mention', () => {
  const result = classify(item(), { now: NOW });
  assert.equal(result.status, 'accepted');
  assert.equal(result.deadline, '2027-01-15');
  assert.equal(result.applicationFee, 'not-mentioned');
});

test('accepts when the post explicitly says there is no application fee', () => {
  const result = classify(
    item({ summary: 'Fully funded. There is no application fee. Deadline: 20 December 2026.' }),
    { now: NOW },
  );
  assert.equal(result.status, 'accepted');
  assert.equal(result.applicationFee, 'none-stated');
  assert.equal(result.deadline, '2026-12-20');
});

test('rejects a program that charges an application fee', () => {
  const result = classify(
    item({ summary: 'Fully funded conference. Application fee: $50. Deadline: 1 February 2027.' }),
    { now: NOW },
  );
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /fee/i);
});

test('still rejects a fee even when a waiver is mentioned', () => {
  const result = classify(
    item({ summary: 'Fully funded conference. Application fee of $50, waiver available.' }),
    { now: NOW },
  );
  assert.equal(result.status, 'rejected');
});

test('catches a paid program fee mixed with "no application fee"', () => {
  const result = classify(
    item({ summary: 'Fully funded? There is no application fee, but a $200 program fee applies.' }),
    { now: NOW },
  );
  assert.equal(result.status, 'rejected');
});

test('accepts when the host covers the program fee', () => {
  const result = classify(
    item({ summary: 'Fully funded. The program fee is covered by the host. Deadline: 5 March 2027.' }),
    { now: NOW },
  );
  assert.equal(result.status, 'accepted');
});

test('rejects self-funded programs', () => {
  const result = classify(
    item({
      title: 'Youth Summit 2027',
      summary: 'Selected delegates are self-funded and must cover their own travel.',
    }),
    { now: NOW },
  );
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /self-funded|partial|unfunded/i);
});

test('rejects partial funding', () => {
  const result = classify(
    item({
      title: 'Partially Funded Fellowship 2027',
      summary: 'The fellowship is partially funded and covers accommodation only.',
    }),
    { now: NOW },
  );
  assert.equal(result.status, 'rejected');
});

test('flags the bait-and-switch pattern for manual review', () => {
  const result = classify(
    item({
      title: 'Global Youth Summit 2027',
      summary: 'A few fully funded seats are available; most delegates are self-funded.',
    }),
    { now: NOW },
  );
  assert.equal(result.status, 'review');
  assert.match(result.reason, /bait/i);
});

test('marks a clearly expired call as expired', () => {
  const result = classify(
    item({ summary: 'Fully funded. Deadline: 1 January 2026.' }),
    { now: NOW },
  );
  assert.equal(result.status, 'expired');
});

test('ignores event dates that are not labelled as a deadline', () => {
  const result = classify(
    item({
      summary: 'The fully funded summit takes place 10-12 March 2027 in Berlin. Applications open soon.',
    }),
    { now: NOW },
  );
  assert.equal(result.deadline, null);
  assert.equal(result.status, 'accepted');
});

test('extracts several common deadline formats', () => {
  assert.equal(extractDeadline('Deadline: 5 March 2027', NOW).date, '2027-03-05');
  assert.equal(extractDeadline('Apply by March 5, 2027', NOW).date, '2027-03-05');
  assert.equal(extractDeadline('Application deadline: 2027-03-05', NOW).date, '2027-03-05');
  assert.equal(extractDeadline('Applications close 05/03/2027', NOW).date, '2027-03-05');
  assert.equal(extractDeadline('Deadline: 5 March', NOW).date, '2027-03-05');
});

test('handles rolling deadlines', () => {
  const result = extractDeadline('Deadline: Rolling', NOW);
  assert.equal(result.date, null);
  assert.equal(result.label, 'Rolling');
});

test('does not treat arbitrary "ongoing" text as a rolling deadline', () => {
  const result = extractDeadline(
    'An ongoing program. Application deadline: 12 April 2027.',
    NOW,
  );
  assert.equal(result.date, '2027-04-12');
});

test('parses day/month/year dates', () => {
  assert.equal(parseDateIn('15/01/2027', NOW), '2027-01-15');
  assert.equal(parseDateIn('01/15/2027', NOW), '2027-01-15');
  assert.equal(parseDateIn('31/02/2027', NOW), null);
});

test('LLM verdict overrides the heuristic verdict', () => {
  const base = classify(item(), { now: NOW });
  const merged = mergeVerdict(base, {
    id: 'abc123',
    fullyFunded: true,
    applicationFee: false,
    deadline: '2027-02-10',
    confidence: 0.91,
    reason: 'All costs covered; free to apply.',
  });
  assert.equal(merged.status, 'accepted');
  assert.equal(merged.deadline, '2027-02-10');
  assert.equal(merged.verifiedBy, 'opencode');
});

test('matches "Fully Funded" even when a feed concatenates the next word', () => {
  const result = classify(
    item({
      title: 'Fully FundedClimate Leadership Programme 2027 in Belgium (No Application Fee)',
      summary: 'Applications are now open. Deadline: 20 December 2026.',
    }),
    { now: NOW },
  );
  assert.equal(result.status, 'accepted');
});
