import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig, loadSources, paths } from './config.js';
import { loadStore } from './store.js';
import { loadStatus } from './status.js';
import { nextRunAt, scheduleStatus } from './schedule.js';
import { describeMailConfig } from './mailer.js';
import { hasInstagramSession, instagramSessionInfo } from './instagram.js';
import { dateKey, daysUntil, formatDate } from './util.js';

const PUBLIC_DIR = join(ROOT, 'public');
const portArgIndex = process.argv.indexOf('--port');
const rawPort = portArgIndex >= 0 ? process.argv[portArgIndex + 1] : process.env.DASHBOARD_PORT || 8787;
const PORT = Number(rawPort);
const HOST = '127.0.0.1';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid dashboard port "${rawPort}". Try DASHBOARD_PORT=8787.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

let scheduleCache = { at: 0, value: null };

function currentSchedule() {
  if (Date.now() - scheduleCache.at > 15_000) {
    scheduleCache = { at: Date.now(), value: scheduleStatus() };
  }
  return scheduleCache.value;
}

function nextRunLabel(next, now) {
  const today = dateKey(now);
  const tomorrow = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const target = dateKey(next);
  const prefix =
    target === today
      ? 'Today'
      : target === tomorrow
        ? 'Tomorrow'
        : next.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${prefix} at ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}

function buildOverview() {
  const now = new Date();
  const store = loadStore();
  const status = loadStatus();
  const config = loadConfig();
  const allSources = loadSources();
  const schedule = currentSchedule();

  const statusById = new Map((status?.sources ?? []).map((source) => [source.id, source]));
  const sources = allSources.map((source) => {
    const state = statusById.get(source.id);
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      enabled: Boolean(source.enabled),
      tags: source.tags ?? [],
      note: source.note ?? null,
      status: !source.enabled ? 'disabled' : state?.status ?? 'unknown',
      items: state?.items ?? null,
      ms: state?.ms ?? null,
      error: state?.error ?? null,
    };
  });

  const allItems = Object.values(store.items).map((item) => {
    const daysLeft = item.deadline ? daysUntil(item.deadline, now) : null;
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      applyUrl: item.applyUrl || null,
      sourceName: item.sourceName,
      sourceType: item.sourceType || '',
      location: item.location || '',
      category: item.category || '',
      deadline: item.deadline || null,
      daysLeft,
      deadlineLabel: item.deadline ? formatDate(item.deadline) : null,
      eventDate: item.eventDate || null,
      reason: item.reason || '',
      confidence: item.confidence ?? null,
      verifiedBy: item.verifiedBy || 'heuristic',
      firstSeen: item.firstSeen || null,
      lastSeen: item.lastSeen || null,
      expired: daysLeft !== null && daysLeft < 0,
    };
  });

  const items = allItems
    .filter((item) => !item.expired)
    .sort((a, b) => {
      const aDays = a.daysLeft ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysLeft ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return String(b.firstSeen ?? '').localeCompare(String(a.firstSeen ?? ''));
    });

  const counts = {
    open: items.length,
    urgent: items.filter((item) => item.daysLeft !== null && item.daysLeft <= 1).length,
    week: items.filter((item) => item.daysLeft !== null && item.daysLeft >= 2 && item.daysLeft <= 7).length,
    month: items.filter((item) => item.daysLeft !== null && item.daysLeft >= 8 && item.daysLeft <= 30).length,
    later: items.filter((item) => item.daysLeft !== null && item.daysLeft > 30).length,
    noDeadline: items.filter((item) => item.daysLeft === null).length,
    expired: allItems.length - items.length,
    sourcesLive: sources.filter((source) => source.status === 'live').length,
    sourcesFailed: sources.filter((source) => source.status === 'failed').length,
    sourcesSkipped: sources.filter((source) => source.status === 'skipped').length,
    sourcesDisabled: sources.filter((source) => source.status === 'disabled').length,
    sourcesEnabled: sources.filter((source) => source.enabled).length,
    sourcesTotal: sources.length,
  };

  const lastRun =
    status?.kind === 'run'
      ? status
      : status?.lastRun
        ? {
            ...status.lastRun,
            kind: 'run',
          }
        : null;
  const lastCheck = status?.kind === 'check' ? status : null;

  let watcherState = 'never-run';
  if (lastRun) {
    const ageHours = (now.getTime() - Date.parse(lastRun.finishedAt)) / 3_600_000;
    const emailFailed = lastRun.email?.configured && lastRun.email?.sent === false;
    const failureRatio = counts.sourcesFailed / Math.max(1, counts.sourcesEnabled);
    watcherState = ageHours <= 30 && !emailFailed && failureRatio < 0.5 ? 'healthy' : 'degraded';
  } else if (lastCheck) {
    watcherState = counts.sourcesFailed > 0 ? 'degraded' : 'check-only';
  }

  const scheduleTime = status?.scheduleTime || process.env.SCHEDULE_TIME || '08:00';
  let next = null;
  try {
    next = nextRunAt(scheduleTime, now);
  } catch {
    next = null;
  }

  const mailConfig = describeMailConfig(config.mail);
  const email =
    lastRun?.email ??
    status?.email ?? {
      configured: mailConfig.configured,
      sent: null,
      to: config.mail.to || null,
      transport: mailConfig.transport ?? null,
      error: null,
      at: null,
    };

  const igInfo = instagramSessionInfo();
  const instagram = {
    session: hasInstagramSession(),
    loggedInAt: igInfo?.loggedInAt ?? null,
    username: igInfo?.username ?? null,
  };

  return {
    generatedAt: now.toISOString(),
    today: dateKey(now),
    storeUpdatedAt: store.updatedAt ?? null,
    watcher: {
      status: watcherState,
      lastRun: lastRun
        ? {
            finishedAt: lastRun.finishedAt,
            startedAt: lastRun.startedAt,
            durationMs: lastRun.durationMs,
            counts: lastRun.counts ?? null,
            digestDay: lastRun.digestDay ?? null,
          }
        : null,
      lastCheck: lastCheck
        ? {
            finishedAt: lastCheck.finishedAt,
            durationMs: lastCheck.durationMs,
            counts: lastCheck.counts ?? null,
          }
        : null,
      nextRun: next
        ? {
            at: next.toISOString(),
            time: scheduleTime,
            label: nextRunLabel(next, now),
            installed: Boolean(schedule.installed),
            loaded: Boolean(schedule.loaded),
          }
        : null,
      schedule: {
        installed: Boolean(schedule.installed),
        loaded: Boolean(schedule.loaded),
        time: scheduleTime,
      },
      email,
      instagram,
    },
    counts,
    sources,
    items,
  };
}

function latestDigestFile() {
  try {
    const files = readdirSync(paths.digests)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.html$/.test(name))
      .sort()
      .reverse();
    return files[0] ? join(paths.digests, files[0]) : null;
  } catch {
    return null;
  }
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-cache',
};

async function sendFile(res, file, type = 'text/html; charset=utf-8', extraHeaders = {}) {
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': type,
      ...extraHeaders,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  let url;
  let pathname;
  try {
    url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, { error: 'Method not allowed' }, 405);
    return;
  }

  if (pathname === '/api/overview') {
    try {
      sendJson(res, buildOverview());
    } catch (error) {
      sendJson(res, { error: error.message }, 500);
    }
    return;
  }

  if (pathname === '/health') {
    sendJson(res, {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  if (pathname === '/digest/latest') {
    const file = latestDigestFile();
    if (!file) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      res.end('No digest has been generated yet.');
      return;
    }
    await sendFile(res, file);
    return;
  }

  const digestMatch = /^\/digest\/(\d{4}-\d{2}-\d{2})$/.exec(pathname);
  if (digestMatch) {
    const file = normalize(join(paths.digests, `${digestMatch[1]}.html`));
    if (!file.startsWith(normalize(paths.digests))) {
      sendJson(res, { error: 'Not found' }, 404);
      return;
    }
    await sendFile(res, file);
    return;
  }

  if (pathname === '/') {
    await sendFile(res, join(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8', {
      'content-security-policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    });
    return;
  }

  if (pathname === '/styles.css') {
    await sendFile(res, join(PUBLIC_DIR, 'styles.css'), 'text/css; charset=utf-8');
    return;
  }
  if (pathname === '/app.js') {
    await sendFile(res, join(PUBLIC_DIR, 'app.js'), 'text/javascript; charset=utf-8');
    return;
  }
  if (pathname === '/favicon.ico') {
    res.writeHead(204, SECURITY_HEADERS);
    res.end();
    return;
  }

  res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: DASHBOARD_PORT=8788 npm run dashboard`);
  } else {
    console.error(`Dashboard error: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Scholarship Watcher dashboard: http://${HOST}:${PORT}`);
  console.log(`API: http://${HOST}:${PORT}/api/overview`);
  console.log('Press Ctrl+C to stop.');
  if (process.argv.includes('--open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
    if (command) {
      spawn(command, [`http://${HOST}:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    }
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
