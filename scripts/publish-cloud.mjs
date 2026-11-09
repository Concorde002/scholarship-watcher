#!/usr/bin/env node
import { loadStore } from '../src/store.js';

const base = (process.env.CLOUD_URL || '').replace(/\/+$/, '');
const secret = process.env.CLOUD_ADMIN_SECRET || '';

if (!base || !secret) {
  console.error('Set CLOUD_URL and CLOUD_ADMIN_SECRET first. See .env.example.');
  process.exit(1);
}

const store = loadStore();
const items = Object.values(store.items).map((item) => ({
  id: item.id,
  title: item.title,
  url: item.url,
  applyUrl: item.applyUrl ?? null,
  sourceName: item.sourceName,
  sourceType: item.sourceType ?? '',
  deadline: item.deadline ?? null,
  eventDate: item.eventDate ?? null,
  location: item.location ?? '',
  category: item.category ?? '',
  reason: item.reason ?? '',
  verifiedBy: item.verifiedBy ?? 'heuristic',
  firstSeen: item.firstSeen ?? null,
}));

console.log(`Publishing ${items.length} opportunities to ${base}…`);

const response = await fetch(`${base}/api/admin/import`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-admin-secret': secret,
  },
  body: JSON.stringify({ items }),
});

const body = await response.text();
if (!response.ok) {
  console.error(`Publish failed (${response.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}

let result = {};
try {
  result = JSON.parse(body);
} catch {
  // ignore
}
console.log(`Published ${result.count ?? items.length} opportunities at ${result.importedAt ?? 'now'}.`);
