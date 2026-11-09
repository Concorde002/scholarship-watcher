const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  query: '',
  source: 'all',
  urgency: 'all',
  sort: 'deadline',
  loading: false,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function timeAgo(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatShortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function deadlineEnd(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function formatRemaining(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return 'closed';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${Math.max(1, minutes)}m`;
}

function toneFor(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return 'none';
  if (daysLeft <= 1) return 'urgent';
  if (daysLeft <= 7) return 'soon';
  return 'open';
}

function badgeFor(item) {
  const days = item.daysLeft;
  if (days === null || days === undefined) return 'No deadline listed';
  if (days < 0) return 'Closed';
  if (days === 0) return 'Deadline today';
  if (days === 1) return 'Deadline tomorrow';
  if (days <= 7) return `${days} days left`;
  return `Deadline ${item.deadlineLabel}`;
}

function setConnection(kind, text) {
  const pill = $('connection');
  const dot = $('conn-dot');
  $('conn-text').textContent = text;
  pill.classList.remove('ok', 'bad', 'warn');
  dot.classList.remove('live', 'failed', 'warn');
  if (kind === 'ok') {
    pill.classList.add('ok');
    dot.classList.add('live');
  } else if (kind === 'bad') {
    pill.classList.add('bad');
    dot.classList.add('failed');
  } else if (kind === 'warn') {
    pill.classList.add('warn');
    dot.classList.add('warn');
  }
}

function statusCard({ tone, label, value, detail, error = false }) {
  return `<article class="status-card ${tone}">
    <div class="status-head"><span>${esc(label)}</span><span class="dot ${tone === 'ok' ? 'live' : tone === 'bad' ? 'failed' : tone === 'warn' ? 'warn' : ''}"></span></div>
    <div class="status-value">${esc(value)}</div>
    <div class="status-detail ${error ? 'error' : ''}">${esc(detail)}</div>
  </article>`;
}

function renderStatus(data) {
  const watcher = data.watcher;
  const counts = data.counts;
  const lastRun = watcher.lastRun;
  const lastCheck = watcher.lastCheck;
  const email = watcher.email || {};
  const instagram = watcher.instagram || {};

  const watcherMap = {
    healthy: { tone: 'ok', value: 'Healthy' },
    degraded: { tone: 'bad', value: 'Degraded' },
    'check-only': { tone: 'warn', value: 'Source check only' },
    'never-run': { tone: 'neutral', value: 'No run yet' },
  };
  const watcherState = watcherMap[watcher.status] ?? watcherMap['never-run'];
  let watcherDetail = 'Run npm run run to populate the dashboard.';
  if (lastRun) {
    watcherDetail = `Last run ${timeAgo(lastRun.finishedAt)}`;
    if (Number.isFinite(lastRun.durationMs)) watcherDetail += ` · ${formatDuration(lastRun.durationMs)}`;
    if (lastRun.counts?.accepted != null) watcherDetail += ` · ${lastRun.counts.accepted} matches`;
    if (counts.sourcesFailed) watcherDetail += ` · ${counts.sourcesFailed} source(s) failing`;
  } else if (lastCheck) {
    watcherDetail = `Last source check ${timeAgo(lastCheck.finishedAt)} · no digest run yet`;
  }

  let emailTone = 'neutral';
  let emailValue = 'Not configured';
  let emailDetail = 'Run npm run setup to connect an inbox.';
  if (email.configured && email.sent === true) {
    emailTone = 'ok';
    emailValue = 'Delivered';
    emailDetail = `to ${email.to || 'your inbox'}${email.at ? ` · ${timeAgo(email.at)}` : ''}`;
  } else if (email.configured && email.sent === false) {
    emailTone = 'bad';
    emailValue = 'Failed';
    emailDetail = email.error || 'The last delivery attempt failed.';
  } else if (email.configured) {
    emailTone = 'warn';
    emailValue = 'Configured';
    emailDetail = `to ${email.to || 'your inbox'} · no delivery recorded yet`;
  }

  const igSources = data.sources.filter((source) => source.type === 'instagram' && source.enabled);
  const igProblems = igSources.filter((source) => source.status === 'failed' || source.status === 'skipped').length;
  let igTone = 'neutral';
  let igValue = 'Login needed';
  let igDetail = 'Run npm run instagram:login once.';
  if (instagram.session) {
    igTone = igProblems ? 'warn' : 'ok';
    igValue = 'Session saved';
    igDetail = `${instagram.loggedInAt ? `since ${formatShortDate(instagram.loggedInAt)}` : 'saved locally'}${
      igProblems ? ` · ${igProblems} handle(s) failing` : ' · 8 handles'
    }`;
  }

  $('status-grid').innerHTML = [
    statusCard({ tone: watcherState.tone, label: 'Watcher', value: watcherState.value, detail: watcherDetail }),
    statusCard({ tone: emailTone, label: 'Email', value: emailValue, detail: emailDetail, error: emailTone === 'bad' }),
    statusCard({
      tone: counts.sourcesFailed ? 'bad' : counts.sourcesSkipped ? 'warn' : 'ok',
      label: 'Sources',
      value: `${counts.sourcesLive} / ${counts.sourcesEnabled} live`,
      detail: `${counts.sourcesFailed} failed · ${counts.sourcesSkipped} skipped · ${counts.sourcesDisabled} disabled`,
    }),
    statusCard({ tone: igTone, label: 'Instagram', value: igValue, detail: igDetail }),
  ].join('');

  const stats = [
    ['open', 'Open now', counts.open],
    ['urgent', 'Today / tomorrow', counts.urgent],
    ['week', 'Next 7 days', counts.week],
    ['month', 'Next 30 days', counts.month],
    ['later', '30+ days', counts.later],
    ['none', 'No deadline', counts.noDeadline],
  ];
  $('stats-grid').innerHTML = stats
    .map(
      ([key, label, value]) => `<article class="stat stat-${key}">
        <strong>${Number(value) || 0}</strong>
        <span>${esc(label)}</span>
      </article>`,
    )
    .join('');

  const next = watcher.nextRun;
  if (next) {
    $('next-run-label').textContent = `${next.label}${next.installed ? '' : ' · schedule not installed'}`;
    updateNextRunCountdown();
  } else {
    $('next-run-countdown').textContent = '—';
    $('next-run-label').textContent = 'Schedule not installed';
  }

  $('hero-sub').textContent =
    `${counts.open} open opportunit${counts.open === 1 ? 'y' : 'ies'} · ` +
    `${counts.urgent} closing today or tomorrow · ` +
    `${counts.sourcesLive} sources live · updated ${timeAgo(data.storeUpdatedAt || data.generatedAt)}`;
}

function renderSourceOptions(data) {
  const select = $('source-filter');
  const previous = state.source;
  const names = [...new Set(data.items.map((item) => item.sourceName).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  select.innerHTML =
    `<option value="all">All sources</option>` +
    names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if (previous !== 'all' && !names.includes(previous)) state.source = 'all';
  select.value = state.source;
}

function filteredItems() {
  if (!state.data) return [];
  const query = state.query.trim().toLowerCase();
  const items = state.data.items.filter((item) => {
    if (state.source !== 'all' && item.sourceName !== state.source) return false;
    if (state.urgency === 'today' && !(item.daysLeft !== null && item.daysLeft <= 1)) return false;
    if (state.urgency === 'week' && !(item.daysLeft !== null && item.daysLeft <= 7)) return false;
    if (state.urgency === 'month' && !(item.daysLeft !== null && item.daysLeft <= 30)) return false;
    if (state.urgency === 'none' && item.daysLeft !== null) return false;
    if (!query) return true;
    return `${item.title} ${item.sourceName} ${item.location} ${item.category} ${item.reason}`
      .toLowerCase()
      .includes(query);
  });

  if (state.sort === 'newest') {
    items.sort((a, b) => String(b.firstSeen ?? '').localeCompare(String(a.firstSeen ?? '')));
  } else if (state.sort === 'source') {
    items.sort((a, b) => a.sourceName.localeCompare(b.sourceName) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  }
  return items;
}

function renderItems() {
  const items = filteredItems();
  const total = state.data?.items.length ?? 0;
  $('result-count').textContent = `${items.length} of ${total} shown`;
  $('empty').hidden = items.length > 0;

  $('items').innerHTML = items
    .map((item) => {
      const tone = toneFor(item.daysLeft);
      const countdown =
        item.deadline && item.daysLeft !== null
          ? `<span class="countdown" data-deadline="${esc(item.deadline)}">${formatRemaining(
              deadlineEnd(item.deadline) - Date.now(),
            )}</span>`
          : `<span class="countdown">No deadline</span>`;
      const exact = item.deadlineLabel ? `<span class="exact-date">${esc(item.deadlineLabel)}</span>` : '';
      const meta = [item.sourceName, item.location, item.category, item.verifiedBy === 'opencode' ? 'AI checked' : '']
        .filter(Boolean)
        .map(esc)
        .join(' · ');
      const applyUrl = item.applyUrl || item.url;
      const applyLabel = item.applyUrl ? 'Apply ↗' : item.sourceType === 'instagram' ? 'View post ↗' : 'Open ↗';
      const postLink =
        item.applyUrl && item.applyUrl !== item.url
          ? `<a class="post-link" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">Post</a>`
          : '';

      return `<article class="item ${tone}">
        <div class="item-main">
          <div class="item-top">
            <span class="badge ${tone}">${esc(badgeFor(item))}</span>
            ${item.category ? `<span class="source-pill">${esc(item.category)}</span>` : ''}
          </div>
          <h3><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a></h3>
          <p class="item-meta">${meta}</p>
          ${item.eventDate ? `<p class="item-when"><strong>When:</strong> ${esc(item.eventDate)}</p>` : ''}
          ${item.reason ? `<p class="item-reason">${esc(item.reason)}</p>` : ''}
        </div>
        <div class="item-side">
          ${countdown}
          ${exact}
          <div class="item-actions">
            <a class="apply-link" href="${esc(safeUrl(applyUrl))}" target="_blank" rel="noopener noreferrer">${esc(applyLabel)}</a>
            ${postLink}
          </div>
        </div>
      </article>`;
    })
    .join('');

  updateDeadlineCountdowns();
}

function statusLabel(status) {
  return {
    live: 'Live',
    failed: 'Failed',
    skipped: 'Skipped',
    disabled: 'Disabled',
    unknown: 'Unknown',
  }[status] ?? 'Unknown';
}

function renderSources(data) {
  const order = { failed: 0, live: 1, skipped: 2, unknown: 3, disabled: 4 };
  const sources = [...data.sources].sort(
    (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name),
  );

  $('source-summary').textContent =
    `${data.counts.sourcesLive} live · ${data.counts.sourcesFailed} failed · ` +
    `${data.counts.sourcesSkipped} skipped · ${data.counts.sourcesDisabled} disabled`;

  $('sources').innerHTML = sources
    .map((source) => {
      const stateText =
        source.status === 'live' || source.status === 'failed'
          ? `${source.items ?? 0} items${source.ms ? ` · ${formatDuration(source.ms)}` : ''}`
          : source.status === 'skipped'
            ? 'skipped'
            : '';
      return `<button class="source-row ${source.enabled ? '' : 'disabled'}" type="button" data-source="${esc(
        source.name,
      )}" ${source.enabled ? '' : 'disabled'}>
        <span class="dot ${source.status === 'live' ? 'live' : source.status === 'failed' ? 'failed' : source.status === 'skipped' ? 'warn' : ''}"></span>
        <span>
          <span class="source-name">${esc(source.name)}</span>
          <span class="source-type">${esc(source.type)}${source.tags?.length ? ` · ${esc(source.tags.join(', '))}` : ''}</span>
        </span>
        <span class="source-state">
          <strong class="${esc(source.status)}">${esc(statusLabel(source.status))}</strong>
          ${esc(stateText)}
        </span>
        ${source.error ? `<span class="source-error">${esc(source.error)}</span>` : ''}
        ${source.note ? `<span class="source-note">${esc(source.note)}</span>` : ''}
      </button>`;
    })
    .join('');
}

function updateNextRunCountdown() {
  const next = state.data?.watcher?.nextRun;
  const target = $('next-run-countdown');
  if (!next) {
    target.textContent = '—';
    return;
  }
  const remaining = Date.parse(next.at) - Date.now();
  if (!Number.isFinite(remaining)) {
    target.textContent = '—';
    return;
  }
  if (remaining <= 0) {
    target.textContent = 'starting…';
    return;
  }
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  target.textContent = `${hours}:${minutes}:${seconds}`;
}

function updateDeadlineCountdowns() {
  document.querySelectorAll('[data-deadline]').forEach((node) => {
    const end = deadlineEnd(node.dataset.deadline);
    node.textContent = end ? formatRemaining(end - Date.now()) : '—';
  });
}

function renderAll() {
  if (!state.data) return;
  renderStatus(state.data);
  renderSourceOptions(state.data);
  renderItems();
  renderSources(state.data);
}

async function loadData(silent = false) {
  if (state.loading) return;
  state.loading = true;
  const button = $('refresh-btn');
  if (!silent) {
    button.disabled = true;
    button.textContent = 'Refreshing…';
  }

  try {
    const response = await fetch('/api/overview', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    renderAll();
    setConnection('ok', `Live · updated ${timeAgo(state.data.generatedAt)}`);
  } catch (error) {
    setConnection('bad', 'Dashboard offline');
    if (!state.data) {
      $('hero-sub').textContent = 'Could not load /api/overview. Start the dashboard with npm run dashboard.';
    }
    console.error(error);
  } finally {
    state.loading = false;
    button.disabled = false;
    button.textContent = 'Refresh';
  }
}

$('refresh-btn').addEventListener('click', () => loadData(false));

$('reset-filters').addEventListener('click', () => {
  state.query = '';
  state.source = 'all';
  state.urgency = 'all';
  state.sort = 'deadline';
  $('search').value = '';
  $('source-filter').value = 'all';
  $('urgency-filter').value = 'all';
  $('sort-filter').value = 'deadline';
  renderItems();
});

$('search').addEventListener('input', (event) => {
  state.query = event.target.value;
  renderItems();
});

$('source-filter').addEventListener('change', (event) => {
  state.source = event.target.value;
  renderItems();
});

$('urgency-filter').addEventListener('change', (event) => {
  state.urgency = event.target.value;
  renderItems();
});

$('sort-filter').addEventListener('change', (event) => {
  state.sort = event.target.value;
  renderItems();
});

$('sources').addEventListener('click', (event) => {
  const row = event.target.closest('.source-row');
  if (!row || row.disabled) return;
  const source = row.dataset.source;
  if (!source) return;
  state.source = source;
  $('source-filter').value = source;
  renderItems();
  $('items').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $('search').focus();
  }
  if (event.key === 'Escape' && document.activeElement === $('search')) {
    $('search').value = '';
    state.query = '';
    renderItems();
    $('search').blur();
  }
});

setInterval(() => {
  updateNextRunCountdown();
  if (!state.loading) loadData(true);
}, 30_000);

setInterval(updateDeadlineCountdowns, 1_000);

loadData(false);
