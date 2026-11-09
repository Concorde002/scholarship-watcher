import test from 'node:test';
import assert from 'node:assert/strict';
import { firstExternalUrl, pickTitle, titleFromUrl } from '../src/instagram.js';

test('titleFromUrl turns an opportunity slug into a clean headline', () => {
  assert.equal(
    titleFromUrl('https://www.youthop.com/fellowships/harvard-lead-fellowship-for-global-health-leaders-2027-2028'),
    'Harvard Lead Fellowship for Global Health Leaders 2027–2028',
  );
  assert.equal(
    titleFromUrl('https://opportunitydesk.org/2026/11/06/ibci-fellowship-program-2027/'),
    'IBCI Fellowship Program 2027',
  );
  assert.equal(titleFromUrl('https://opd.to/4zEjDSW'), null);
  assert.equal(titleFromUrl('https://play.google.com/store/apps/details?id=x'), null);
  assert.equal(titleFromUrl('https://www.oyaop.com'), null);
});

test('firstExternalUrl skips social links and unwraps the Instagram redirector', () => {
  assert.equal(
    firstExternalUrl('Apply: https://example.com/apply?x=1. Follow us on instagram.com'),
    'https://example.com/apply?x=1',
  );
  const wrapped =
    'https://l.instagram.com/?u=https%3A%2F%2Fexample.org%2Ffellowship-2027&e=abc';
  assert.equal(firstExternalUrl(`Link: ${wrapped}`), 'https://example.org/fellowship-2027');
});

test('pickTitle prefers the sentence naming the program', () => {
  const caption =
    '🌍 Want to change the world? The Harvard LEAD Fellowship for Global Health Leaders 2027–2028 is a one-year programme. Apply through the link in bio.';
  assert.match(pickTitle(caption), /Harvard LEAD Fellowship/);
});

test('pickTitle ignores "Opportunity Link" boilerplate lines', () => {
  const caption =
    'A new fully funded fellowship is open.\nOpportunity Link: [ https://example.com ]\nDeadline: 1 March 2027.';
  assert.match(pickTitle(caption), /fully funded fellowship/i);
});

test('titleFromUrl handles "program" without a year', () => {
  assert.equal(
    titleFromUrl('https://scholarshipscorner.website/crossculture-program-germany/'),
    'Crossculture Program Germany',
  );
  assert.equal(
    titleFromUrl('https://scholarshipscorner.website/faspe-fellowship/'),
    'Faspe Fellowship',
  );
});
