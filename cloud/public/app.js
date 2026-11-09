const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  subscribed: false,
  data: null,
  watchlist: new Set(),
  query: '',
  source: 'all',
  urgency: 'all',
  sort: 'deadline',
  savedOnly: false,
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
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
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
  return `Deadline ${item.deadline}`;
}

let toastTimer = null;
function showToast(message, error = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3800);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 401) {
    showLogin();
    throw new Error(data.error || 'Your session expired. Sign in again.');
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showLogin() {
  state.user = null;
  state.data = null;
  $('app-view').hidden = true;
  $('login-view').hidden = false;
  $('login-error').hidden = true;
}

function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('user-email').textContent = state.user?.email || 'Private watchlist';
}

function updateSubscribeButton() {
  const button = $('subscribe-btn');
  button.textContent = state.subscribed ? 'Email list: on' : 'Email list: off';
  button.classList.toggle('saved-toggle-active', state.subscribed);
}

function renderStats() {
  const counts = state.data?.counts ?? {};
  const stats = [
    ['open', 'Open now', counts.open],
    ['urgent', 'Today / tomorrow', counts.urgent],
    ['week', 'Days 2–7', counts.week],
    ['month', 'Days 8–30', counts.month],
    ['later', '31+ days', counts.later],
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
}

function renderSourceOptions() {
  const select = $('source-filter');
  const names = [...new Set((state.data?.items ?? []).map((item) => item.sourceName).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  select.innerHTML =
    `<option value="all">All sources</option>` +
    names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
  if (state.source !== 'all' && !names.includes(state.source)) state.source = 'all';
  select.value = state.source;
}

function filteredItems() {
  const items = (state.data?.items ?? []).filter((item) => {
    if (state.savedOnly && !state.watchlist.has(item.id)) return false;
    if (state.source !== 'all' && item.sourceName !== state.source) return false;
    if (state.urgency === 'today' && !(item.daysLeft !== null && item.daysLeft <= 1)) return false;
    if (state.urgency === 'week' && !(item.daysLeft !== null && item.daysLeft >= 2 && item.daysLeft <= 7)) return false;
    if (state.urgency === 'month' && !(item.daysLeft !== null && item.daysLeft >= 8 && item.daysLeft <= 30)) return false;
    if (state.urgency === 'later' && !(item.daysLeft !== null && item.daysLeft > 30)) return false;
    if (state.urgency === 'none' && item.daysLeft !== null) return false;
    if (!state.query.trim()) return true;
    const query = state.query.trim().toLowerCase();
    return `${item.title} ${item.sourceName} ${item.location} ${item.category} ${item.eventDate ?? ''} ${item.reason}`
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
  $('empty-copy').textContent = state.savedOnly
    ? 'Nothing saved yet. Tap the star on an opportunity to keep it here.'
    : 'Clear the filters, or wait for the next data update.';

  $('items').innerHTML = items
    .map((item) => {
      const tone = toneFor(item.daysLeft);
      const saved = state.watchlist.has(item.id);
      const countdown =
        item.deadline && item.daysLeft !== null
          ? `<span class="countdown" data-deadline="${esc(item.deadline)}">${formatRemaining(
              deadlineEnd(item.deadline) - Date.now(),
            )}</span>`
          : `<span class="countdown">No deadline</span>`;
      const exact = item.deadline ? `<span class="exact-date">${esc(item.deadline)}</span>` : '';
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
            <button class="save-btn ${saved ? 'saved' : ''}" type="button" data-save="${esc(item.id)}" title="${saved ? 'Remove from watchlist' : 'Save to watchlist'}" aria-label="${saved ? 'Remove from watchlist' : 'Save to watchlist'}">${saved ? '★' : '☆'}</button>
          </div>
        </div>
      </article>`;
    })
    .join('');

  updateDeadlineCountdowns();
}

function updateDeadlineCountdowns() {
  document.querySelectorAll('[data-deadline]').forEach((node) => {
    const end = deadlineEnd(node.dataset.deadline);
    node.textContent = end ? formatRemaining(end - Date.now()) : '—';
  });
}

function renderHeader() {
  const counts = state.data?.counts ?? {};
  const saved = state.watchlist.size;
  $('saved-toggle').textContent = `Saved (${saved})`;
  $('saved-toggle').classList.toggle('saved-toggle-active', state.savedOnly);
  $('hero-sub').textContent = `${counts.open ?? 0} open · ${counts.urgent ?? 0} closing today or tomorrow · ${saved} saved`;
  $('last-sync').textContent = state.data?.updatedAt ? timeAgo(state.data.updatedAt) : '—';
  $('sync-note').textContent = state.data?.updatedAt
    ? `Published ${new Date(state.data.updatedAt).toLocaleString('en-GB')}`
    : 'Waiting for the watcher to publish';
}

function renderAll() {
  renderHeader();
  renderStats();
  renderSourceOptions();
  renderItems();
  updateSubscribeButton();
  if (state.user) $('user-email').textContent = state.user.email;
}

async function loadData() {
  const data = await api('/api/opportunities');
  state.data = data;
  state.watchlist = new Set(data.watchlist ?? []);
  if (data.user?.email) state.user = data.user;
  renderAll();
}

async function toggleSave(id) {
  const saved = state.watchlist.has(id);
  try {
    const data = await api('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ id, action: saved ? 'remove' : 'add' }),
    });
    state.watchlist = new Set(data.watchlist ?? []);
    renderAll();
    showToast(saved ? 'Removed from watchlist.' : 'Saved to watchlist.');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function init() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.subscribed = Boolean(me.subscribed);
    showApp();
    await loadData();
  } catch {
    showLogin();
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('login-btn');
  const errorBox = $('login-error');
  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = 'Checking…';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        code: $('access-code').value,
        email: $('login-email').value,
        subscribe: $('subscribe').checked,
      }),
    });
    state.user = data.user;
    state.subscribed = Boolean(data.subscribed);
    $('access-code').value = '';
    showApp();
    await loadData();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Enter watchlist';
  }
});

$('logout-btn').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  showLogin();
});

$('subscribe-btn').addEventListener('click', async () => {
  try {
    const data = await api('/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ active: !state.subscribed }),
    });
    state.subscribed = Boolean(data.subscribed);
    updateSubscribeButton();
    showToast(state.subscribed ? 'You are on the email list.' : 'You are off the email list.');
  } catch (error) {
    showToast(error.message, true);
  }
});

$('saved-toggle').addEventListener('click', () => {
  state.savedOnly = !state.savedOnly;
  renderHeader();
  renderItems();
});

$('items').addEventListener('click', (event) => {
  const button = event.target.closest('[data-save]');
  if (!button) return;
  toggleSave(button.dataset.save);
});

$('refresh-btn')?.addEventListener('click', () => loadData().catch((error) => showToast(error.message, true)));

$('reset-filters').addEventListener('click', () => {
  state.query = '';
  state.source = 'all';
  state.urgency = 'all';
  state.sort = 'deadline';
  state.savedOnly = false;
  $('search').value = '';
  $('source-filter').value = 'all';
  $('urgency-filter').value = 'all';
  $('sort-filter').value = 'deadline';
  renderAll();
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

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    $('search')?.focus();
  }
});

setInterval(updateDeadlineCountdowns, 1_000);
init();
