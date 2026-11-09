import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, cleanTitle, daysUntil, fingerprint, similarTitles, stripHtml } from '../src/util.js';
import { parseRss, parseTelegram } from '../src/fetch-sources.js';
import { prepareDigest, renderHtml, renderText, subjectFor } from '../src/digest.js';

test('canonicalUrl removes tracking parameters and trailing slashes', () => {
  assert.equal(
    canonicalUrl('https://Example.com/opportunity/?utm_source=x&fbclid=1'),
    'https://example.com/opportunity',
  );
});

test('stripHtml converts markup to readable text', () => {
  assert.equal(stripHtml('<p>Hello <strong>world</strong>&nbsp;&amp; friends</p>'), 'Hello world & friends');
});

test('fingerprint ignores stop words and punctuation', () => {
  assert.equal(
    fingerprint('Fully Funded Conference in Germany 2027'),
    fingerprint('fully-funded conference, germany 2027'),
  );
});

test('daysUntil works on calendar dates', () => {
  const now = new Date(2026, 10, 9);
  assert.equal(daysUntil('2026-11-09', now), 0);
  assert.equal(daysUntil('2026-11-10', now), 1);
  assert.equal(daysUntil('2026-11-02', now), -7);
});

test('parseRss handles an RSS 2.0 feed', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title>Fully Funded Summit 2027</title>
      <link>https://example.com/summit?utm_source=rss</link>
      <description><![CDATA[<p>Deadline: 15 January 2027. Fully funded.</p>]]></description>
      <pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;
  const source = { id: 'test', name: 'Test', type: 'rss', url: 'https://example.com/feed' };
  const items = parseRss(xml, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/summit');
  assert.match(items[0].summary, /Fully funded/);
  assert.ok(items[0].publishedAt);
});

test('parseRss handles an Atom feed', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Fully Funded Fellowship</title>
      <link rel="alternate" href="https://example.com/fellowship"/>
      <summary>All expenses paid. Apply by 1 March 2027.</summary>
      <updated>2026-11-08T10:00:00Z</updated>
    </entry>
  </feed>`;
  const source = { id: 'test', name: 'Test', type: 'rss', url: 'https://example.com/feed' };
  const items = parseRss(xml, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/fellowship');
});

test('parseTelegram extracts posts and timestamps', () => {
  const html = `<div class="tgme_widget_message" data-post="scholarshipscorner/42">
    <div class="tgme_widget_message_text">Fully Funded Youth Summit 2027\nDeadline: 15 January 2027\nApply: https://example.com</div>
    <time datetime="2026-11-08T10:00:00+00:00"></time>
  </div>`;
  const source = { id: 'tg', name: 'Telegram', type: 'telegram', channel: 'scholarshipscorner' };
  const items = parseTelegram(html, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://t.me/scholarshipscorner/42');
  assert.match(items[0].title, /Fully Funded/);
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

test('digest puts same-day deadlines in the urgent section', () => {
  const now = new Date(2026, 10, 9, 8, 0, 0);
  const item = digestItem('a', { deadline: '2026-11-09' });
  const digest = prepareDigest({ now, accepted: [item], newIds: new Set(['a']) });
  assert.equal(digest.sections[0].key, 'urgent');
  assert.equal(digest.counts.new, 1);
  assert.match(subjectFor(digest), /1 new fully funded/);
});

test('digest renders text and HTML with escape safety', () => {
  const now = new Date(2026, 10, 9, 8, 0, 0);
  const item = digestItem('a', { title: '<script>alert(1)</script> Fully Funded' });
  const digest = prepareDigest({ now, accepted: [item], newIds: new Set(['a']) });
  const text = renderText(digest);
  const html = renderHtml(digest);
  assert.match(text, /SCHOLARSHIP WATCHER/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('digest shows the watchlist when empty', () => {
  const digest = prepareDigest({ now: new Date(2026, 10, 9), accepted: [], newIds: new Set() });
  assert.equal(digest.empty, true);
  assert.match(renderText(digest), /One Young World/);
});

test('cleanTitle removes concatenated article body from feed titles', () => {
  assert.equal(
    cleanTitle(
      'Fully Funded FASPE Fellowship 2027 in Germany & Poland Duration: 2 WeeksProgram Dates: May 2027',
    ),
    'Fully Funded FASPE Fellowship 2027 in Germany & Poland',
  );
  assert.equal(
    cleanTitle(
      'Fully Funded Stanford Summer Research Program 2027 in USAApply for the Stanford fellowship',
    ),
    'Fully Funded Stanford Summer Research Program 2027 in USA',
  );
  assert.equal(
    cleanTitle(
      'Generation Regen Challenge 2027: presented by BMO Application deadline: 24 February 2027',
    ),
    'Generation Regen Challenge 2027: presented by BMO Application deadline: 24 February 2027',
  );
});

test('similarTitles catches reposts but not different countries', () => {
  assert.equal(
    similarTitles(
      'Fully Funded Stanford Summer Research Program 2027 in USA',
      'Stanford Summer Research Program 2027 in USA (Fully Funded)',
    ),
    true,
  );
  assert.equal(
    similarTitles('Top 10 Scholarships in Japan for International Students', 'Top 10 Scholarships in France for International Students'),
    false,
  );
  assert.equal(
    similarTitles(
      'MCW Young Leaders Fellowship 2027 in USA | Fully Funded',
      'MCW Global Young Leaders Fellowship 2027 (Funded)',
    ),
    true,
  );
});

test('similarTitles understands UN / United Nations abbreviations', () => {
  assert.equal(
    similarTitles(
      'FULLY FUNDED UN Journalism Fellowship 2027 in Qatar',
      'United Nations Journalism Fellowship 2027 in Qatar (Fully Funded)',
    ),
    true,
  );
});

test('digest shows a separate apply link when Instagram provides one', () => {
  const now = new Date(2026, 10, 9, 8, 0, 0);
  const item = digestItem('ig', {
    sourceType: 'instagram',
    url: 'https://www.instagram.com/p/abc/',
    applyUrl: 'https://example.org/apply-now',
  });
  const digest = prepareDigest({ now, accepted: [item], newIds: new Set(['ig']) });
  const text = renderText(digest);
  const html = renderHtml(digest);
  assert.match(text, /Apply: https:\/\/example\.org\/apply-now/);
  assert.match(html, /https:\/\/example\.org\/apply-now/);
  assert.match(html, /Apply on example\.org/);
});

test('cleanTitle cuts a polluted Telegram "Apply:" suffix', () => {
  assert.equal(
    cleanTitle('07 Day Leadership Program 2027 in Belgium (Fully Funded)Apply: Application Fees. Open'),
    '07 Day Leadership Program 2027 in Belgium (Fully Funded)',
  );
});

test('digest includes the event date when present', () => {
  const now = new Date(2026, 10, 9, 8, 0, 0);
  const item = digestItem('event', { eventDate: '10–12 March 2027' });
  const digest = prepareDigest({ now, accepted: [item], newIds: new Set(['event']) });
  assert.match(renderText(digest), /When: 10–12 March 2027/);
  assert.match(renderHtml(digest), /When:<\/strong> 10–12 March 2027/);
});

test('similarTitles does not merge different programme years', () => {
  assert.equal(
    similarTitles('Harvard LEAD Fellowship 2026 in USA', 'Harvard LEAD Fellowship 2027 in USA'),
    false,
  );
  assert.equal(
    similarTitles('Harvard LEAD Fellowship 2027–2028', 'Harvard LEAD Fellowship 2027'),
    true,
  );
});
