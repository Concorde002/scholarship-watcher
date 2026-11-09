import { dateKey, daysUntil, escapeHtml, formatDate } from './util.js';

const WATCHLIST = [
  ['One Young World Summit scholarships', 'https://www.oneyoungworld.com/scholarships'],
  ['Lindau Nobel Laureate Meetings', 'https://www.lindau-nobel.org/'],
  ['MCW Global Young Leaders Fellowship', 'https://mcwglobal.org/'],
  ['HPAIR conferences', 'https://www.hpair.org/'],
  ['Falling Walls Science Summit', 'https://falling-walls.com/'],
  ['World Youth Forum', 'https://wyfegypt.com/'],
  ['Hansen Leadership Institute', 'https://www.hansenleadership.org/'],
];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function deadlineBadge(item, now) {
  if (!item.deadline) {
    return { text: item.deadlineLabel || 'No deadline listed', tone: 'neutral' };
  }
  const days = daysUntil(item.deadline, now);
  if (days === null) return { text: `Deadline ${formatDate(item.deadline)}`, tone: 'neutral' };
  if (days < 0) return { text: 'Deadline passed', tone: 'neutral' };
  if (days === 0) return { text: 'Deadline today', tone: 'urgent' };
  if (days === 1) return { text: 'Deadline tomorrow', tone: 'urgent' };
  if (days <= 7) return { text: `Closes in ${days} days · ${formatDate(item.deadline)}`, tone: 'soon' };
  return { text: `Deadline ${formatDate(item.deadline)} (${days} days)`, tone: 'open' };
}

function decorate(item, now) {
  const actionUrl = item.applyUrl || item.url;
  const actionHost = hostOf(actionUrl);
  let actionLabel;
  if (item.applyUrl) actionLabel = `Apply on ${actionHost} →`;
  else if (item.sourceType === 'instagram') actionLabel = 'Open the post and use its link in bio →';
  else actionLabel = `Apply on ${actionHost} →`;

  return {
    ...item,
    host: hostOf(item.url),
    actionUrl,
    actionLabel,
    badge: deadlineBadge(item, now),
    meta: [item.sourceName, item.location, item.category].filter(Boolean).join(' · '),
  };
}

/**
 * Build the digest model: apply-today, closing-this-week, new, then recent.
 * Each opportunity appears once; the most urgent section wins.
 */
export function prepareDigest({ now = new Date(), accepted = [], newIds = new Set(), stats = {} }) {
  const byId = new Map();
  for (const item of accepted) if (item?.id) byId.set(item.id, item);
  const decorated = [...byId.values()].map((item) => decorate(item, now));

  const urgent = [];
  const closing = [];
  const fresh = [];
  const recent = [];

  const sorted = decorated.sort((a, b) => {
    const aDays = a.deadline ? daysUntil(a.deadline, now) : Number.POSITIVE_INFINITY;
    const bDays = b.deadline ? daysUntil(b.deadline, now) : Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return String(b.firstSeen ?? '').localeCompare(String(a.firstSeen ?? ''));
  });

  const placed = new Set();
  for (const item of sorted) {
    const days = item.deadline ? daysUntil(item.deadline, now) : null;
    if (days !== null && days <= 1 && days >= 0) {
      urgent.push(item);
      placed.add(item.id);
      continue;
    }
    if (days !== null && days >= 2 && days <= 7) {
      closing.push(item);
      placed.add(item.id);
    }
  }

  for (const item of sorted) {
    if (placed.has(item.id)) continue;
    if (newIds.has(item.id)) {
      fresh.push(item);
      placed.add(item.id);
    }
  }

  const tenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10);
  for (const item of sorted) {
    if (placed.has(item.id)) continue;
    const firstSeen = item.firstSeen ? new Date(`${item.firstSeen}T00:00:00`) : null;
    if (!firstSeen || firstSeen < tenDaysAgo) continue;
    recent.push(item);
    placed.add(item.id);
    if (recent.length >= 8) break;
  }

  const sections = [];
  if (urgent.length) {
    sections.push({
      key: 'urgent',
      title: 'Apply today or tomorrow',
      note: 'Verified fully funded with no application fee. Do not wait on these.',
      items: urgent,
    });
  }
  if (closing.length) {
    sections.push({
      key: 'closing',
      title: 'Closing this week',
      note: 'Deadline is seven days away or less.',
      items: closing,
    });
  }
  if (fresh.length) {
    sections.push({
      key: 'fresh',
      title: 'New today',
      note: 'Freshly discovered and matching your rules: fully funded, no application fee.',
      items: fresh.slice(0, 20),
    });
  }
  if (recent.length) {
    sections.push({
      key: 'recent',
      title: 'Still open from the last 10 days',
      note: 'A short backlog in case you missed one.',
      items: recent,
    });
  }

  const newCount = [...newIds].filter((id) => byId.has(id)).length;
  const closingCount = closing.length + urgent.length;

  return {
    day: dateKey(now),
    dateLabel: now.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    shortDate: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    sections,
    counts: {
      new: newCount,
      closing: closingCount,
      urgent: urgent.length,
      total: byId.size,
      ...stats,
    },
    empty: sections.length === 0,
  };
}

export function subjectFor(digest) {
  const { new: newCount, closing } = digest.counts;
  if (digest.empty) return `Scholarship Watcher · no new matches · ${digest.shortDate}`;
  if (newCount > 0) {
    return `Scholarship Watcher · ${newCount} new fully funded · ${closing} closing soon · ${digest.shortDate}`;
  }
  return `Scholarship Watcher · ${closing} closing soon · ${digest.shortDate}`;
}

function textItem(item) {
  const lines = [`• ${item.title}`];
  lines.push(`  ${item.meta || item.host}`);
  lines.push(`  ${item.badge.text}`);
  if (item.reason) lines.push(`  Why: ${item.reason}`);
  if (item.eventDate) lines.push(`  When: ${item.eventDate}`);
  lines.push(`  ${item.url}`);
  if (item.applyUrl && item.applyUrl !== item.url) lines.push(`  Apply: ${item.applyUrl}`);
  return lines.join('\n');
}

export function renderText(digest) {
  const out = [];
  out.push(`SCHOLARSHIP WATCHER — ${digest.dateLabel}`);
  out.push('Fully funded only. No application or registration fees.');
  out.push('');

  const { counts } = digest;
  out.push(
    `${counts.sourceCount ?? 0} sources checked · ${counts.scanned ?? 0} posts scanned · ${counts.rejected ?? 0} rejected (fees, partial or unfunded)${counts.review ? ` · ${counts.review} need manual review` : ''}${counts.sourceErrors ? ` · ${counts.sourceErrors} source(s) failed` : ''}`,
  );
  out.push('');

  if (digest.empty) {
    out.push('No new fully funded opportunities today. Permanent watchlist:');
    out.push('');
    for (const [name, url] of WATCHLIST) out.push(`• ${name}\n  ${url}`);
  } else {
    for (const section of digest.sections) {
      out.push(`${section.title.toUpperCase()}`);
      out.push(section.note);
      out.push('');
      for (const item of section.items) out.push(textItem(item), '');
    }
  }

  out.push('—');
  out.push('Before you apply: never pay an application/registration fee, apply only on the official host domain,');
  out.push('and treat "a few fully funded seats, the rest self-funded" as a red flag.');
  out.push('');
  out.push('Generated locally by scholarship-watcher. Verify every deadline and funding claim on the official page.');
  return out.join('\n');
}

function toneColors(tone) {
  if (tone === 'urgent') return { bg: '#fef3f2', fg: '#b42318', border: '#fecdca' };
  if (tone === 'soon') return { bg: '#fffaeb', fg: '#b54708', border: '#fedf89' };
  if (tone === 'open') return { bg: '#ecfdf3', fg: '#027a48', border: '#abefc6' };
  return { bg: '#f2f4f7', fg: '#475467', border: '#e4e7ec' };
}

function renderItemHtml(item) {
  const tone = toneColors(item.badge.tone);
  const title = escapeHtml(item.title);
  const url = escapeHtml(item.url);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #e7e3d9;border-radius:12px;background:#ffffff;">
    <tr>
      <td style="padding:16px 18px;">
        <a href="${url}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.35;font-weight:700;color:#15211c;text-decoration:none;">${title}</a>
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#8a8578;margin-top:5px;">${escapeHtml(item.meta || item.host)}</div>
        <div style="margin-top:10px;">
          <span style="display:inline-block;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;color:${tone.fg};background:${tone.bg};border:1px solid ${tone.border};border-radius:999px;padding:4px 10px;">${escapeHtml(item.badge.text)}</span>
        </div>
        ${item.eventDate ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#15211c;margin-top:10px;"><strong>When:</strong> ${escapeHtml(item.eventDate)}</div>` : ''}
        ${item.reason ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#5f5b51;margin-top:10px;">${escapeHtml(item.reason)}</div>` : ''}
        <div style="margin-top:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;">
          <a href="${escapeHtml(item.actionUrl)}" style="color:#0f6b4f;font-weight:600;text-decoration:none;">${escapeHtml(item.actionLabel)}</a>
        </div>
      </td>
    </tr>
  </table>`;
}

function renderSectionHtml(section) {
  return `
  <tr>
    <td style="padding:26px 28px 8px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#0f6b4f;font-weight:700;">${escapeHtml(section.title)}</div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#8a8578;margin-top:5px;">${escapeHtml(section.note)}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 28px 0;">${section.items.map(renderItemHtml).join('')}</td>
  </tr>`;
}

export function renderHtml(digest) {
  const { counts } = digest;
  const sectionsHtml = digest.sections.map(renderSectionHtml).join('');
  const emptyHtml = digest.empty
    ? `
  <tr>
    <td style="padding:26px 28px 10px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3f3b33;">
        No new fully funded opportunities passed the filter today. Here is the permanent watchlist of flagship programs worth checking directly:
      </div>
    </td>
  </tr>
  <tr>
    <td style="padding:6px 28px 10px;">
      <ul style="margin:0;padding-left:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.9;color:#15211c;">
        ${WATCHLIST.map(([name, url]) => `<li><a href="${escapeHtml(url)}" style="color:#0f6b4f;text-decoration:none;">${escapeHtml(name)}</a></li>`).join('')}
      </ul>
    </td>
  </tr>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scholarship Watcher — ${escapeHtml(digest.dateLabel)}</title>
</head>
<body style="margin:0;padding:0;background:#f2efe7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe7;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#fbf9f4;border-radius:16px;overflow:hidden;border:1px solid #e7e3d9;">
        <tr>
          <td style="background:#12211b;padding:28px;">
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8fd3b6;font-weight:700;">Scholarship Watcher</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;color:#ffffff;margin-top:10px;">Fully funded. Zero fee.</div>
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#b9c7c0;margin-top:8px;">${escapeHtml(digest.dateLabel)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;background:#ffffff;border-bottom:1px solid #ece8de;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#8a8578;line-height:1.6;">
                  <strong style="color:#15211c;font-size:15px;">${counts.new ?? 0}</strong> new &nbsp;·&nbsp;
                  <strong style="color:#15211c;font-size:15px;">${counts.closing ?? 0}</strong> closing soon &nbsp;·&nbsp;
                  <strong style="color:#15211c;font-size:15px;">${counts.sourceCount ?? 0}</strong> sources checked
                  <br>${counts.scanned ?? 0} posts scanned · ${counts.rejected ?? 0} rejected for fees, partial funding or no funding${counts.review ? ` · ${counts.review} need review` : ''}${counts.sourceErrors ? ` · ${counts.sourceErrors} source(s) failed` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ${sectionsHtml}
        ${emptyHtml}
        <tr>
          <td style="padding:26px 28px 30px;">
            <div style="border-top:1px solid #e7e3d9;padding-top:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#8a8578;">
              <strong style="color:#3f3b33;">Before you apply</strong><br>
              Never pay an application or registration fee. Apply only on the official host domain.<br>
              Treat “a few fully funded seats, the rest self-funded” as a red flag.<br>
              Funding claims and deadlines change; verify both on the official page.<br><br>
              Generated locally by <a href="https://github.com/Concorde002/scholarship-watcher" style="color:#0f6b4f;text-decoration:none;">scholarship-watcher</a>.
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export { WATCHLIST };
