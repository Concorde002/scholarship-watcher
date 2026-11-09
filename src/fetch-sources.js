import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import {
  canonicalUrl,
  cleanTitle,
  collapseWhitespace,
  isHttpUrl,
  sleep,
  stripHtml,
  truncate,
} from './util.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 ScholarshipWatcher/1.0';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

async function fetchText(url, { timeout = 18_000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1200);
    }
  }
  throw lastError;
}

function textOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  if (typeof value === 'object') {
    return textOf(value['#cdata'] ?? value['#text'] ?? value.value ?? '');
  }
  return '';
}

function atomLink(node) {
  if (!node) return '';
  const links = Array.isArray(node) ? node : [node];
  const usable = links.filter((link) => link && typeof link === 'object');
  const alternate = usable.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate');
  const chosen = alternate ?? usable[0];
  return textOf(chosen?.['@_href'] ?? chosen?.['#text'] ?? '');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = textOf(value);
    if (text.trim()) return text;
  }
  return '';
}

function toIsoDate(value) {
  const text = textOf(value).trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeItem({ title, url, summary, publishedAt, source }) {
  const clean = truncate(cleanTitle(title), 200);
  if (!clean) return null;
  const absoluteUrl = canonicalUrl(url, source.url);
  if (!isHttpUrl(absoluteUrl)) return null;
  return {
    id: null,
    title: clean,
    url: absoluteUrl,
    summary: truncate(stripHtml(summary), 1200),
    publishedAt: publishedAt || null,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    fetchedAt: new Date().toISOString(),
  };
}

export function parseRss(xml, source) {
  const document = xmlParser.parse(xml);
  const root = document.rss?.channel ?? document.feed ?? document['rdf:RDF'];
  if (!root) throw new Error('Not a recognized RSS/Atom feed');

  const rawItems = root.item ?? root.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  const normalized = [];

  for (const entry of items) {
    const link =
      typeof entry.link === 'string'
        ? entry.link
        : atomLink(entry.link) || firstNonEmpty(entry.guid, entry.id);
    const summary = firstNonEmpty(
      entry['content:encoded'],
      entry.content,
      entry.description,
      entry.summary,
    );
    const item = normalizeItem({
      title: firstNonEmpty(entry.title),
      url: link,
      summary,
      publishedAt: toIsoDate(entry.pubDate ?? entry.published ?? entry.updated ?? entry['dc:date']),
      source,
    });
    if (item) normalized.push(item);
  }

  return dedupe(normalized).slice(0, source.maxItems ?? 60);
}

export function parseTelegram(html, source) {
  const $ = cheerio.load(html);
  const items = [];

  $('.tgme_widget_message').each((_, element) => {
    const node = $(element);
    const textEl = node.find('.tgme_widget_message_text').first();
    const text = collapseWhitespace(textEl.text());
    if (text.length < 20) return;

    const post = node.attr('data-post');
    const url = post ? `https://t.me/${post}` : source.url;
    const lines = textEl
      .text()
      .split('\n')
      .map((line) => collapseWhitespace(line))
      .filter((line) => line.length > 12);
    const title = truncate(lines[0] ?? text, 240);
    const publishedAt = toIsoDate(node.find('time').attr('datetime'));

    const item = normalizeItem({ title, url, summary: text, publishedAt, source });
    if (item) items.push(item);
  });

  return dedupe(items).slice(0, source.maxItems ?? 40);
}

export function parseHtml(html, source) {
  const $ = cheerio.load(html);
  const pattern = source.linkPattern ? new RegExp(source.linkPattern, 'i') : null;
  const exclude = source.excludePattern ? new RegExp(source.excludePattern, 'i') : null;
  const titleMin = source.titleMin ?? 20;
  const titleMax = source.titleMax ?? 240;
  const items = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;

    let absolute;
    try {
      absolute = new URL(href, source.url).href;
    } catch {
      return;
    }
    if (exclude && exclude.test(absolute)) return;
    if (pattern && !pattern.test(absolute)) return;
    if (!pattern && !/conference|summit|fellow|scholarship|grant|program|opportunit/i.test(absolute)) {
      return;
    }

    const title = collapseWhitespace(anchor.text());
    if (title.length < titleMin || title.length > titleMax) return;

    const url = canonicalUrl(absolute);
    if (seen.has(url)) return;
    seen.add(url);

    const parentText = collapseWhitespace(anchor.closest('article, li, div').first().text());
    const summary = parentText.length > title.length ? parentText.slice(0, 700) : '';

    const item = normalizeItem({ title, url, summary, publishedAt: null, source });
    if (item) items.push(item);
  });

  return items.slice(0, source.maxItems ?? 40);
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export async function fetchSource(source) {
  const started = Date.now();
  try {
    let items;
    if (source.type === 'rss') {
      const xml = await fetchText(source.url);
      items = parseRss(xml, source);
    } else if (source.type === 'telegram') {
      const html = await fetchText(`https://t.me/s/${source.channel}`);
      items = parseTelegram(html, { ...source, url: `https://t.me/s/${source.channel}` });
    } else if (source.type === 'html') {
      const html = await fetchText(source.url);
      items = parseHtml(html, source);
    } else if (source.type === 'instagram') {
      const { fetchInstagramProfile } = await import('./instagram.js');
      const posts = await fetchInstagramProfile(source);
      items = posts
        .map((post) => {
          const item = normalizeItem({
            title: post.title,
            url: post.url,
            summary: post.summary,
            publishedAt: post.publishedAt,
            source,
          });
          if (item) item.applyUrl = post.applyUrl ?? null;
          return item;
        })
        .filter(Boolean);
    } else {
      throw new Error(`Unknown source type: ${source.type}`);
    }

    if (source.requiredKeyword) {
      const keyword = new RegExp(source.requiredKeyword, 'i');
      items = items.filter((item) => keyword.test(`${item.title} ${item.summary}`));
    }

    return { source, items, error: null, ms: Date.now() - started };
  } catch (error) {
    return { source, items: [], error: error.message, ms: Date.now() - started };
  }
}

/** Pull the readable body of an article so the classifier can see fee/deadline text. */
export async function fetchPageText(url) {
  const html = await fetchText(url, { timeout: 20_000, retries: 0 });
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, footer, header, aside, form, svg, iframe').remove();

  const article = $('article').first();
  const main = article.length ? article : $('main').first();
  const container = main.length ? main : $('body');
  const text = collapseWhitespace(container.text());
  return text.slice(0, 9000);
}
