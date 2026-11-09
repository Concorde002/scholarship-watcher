import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { paths } from './config.js';

export const LABEL = 'com.scholarshipwatcher.daily';

export function parseScheduleTime(value = '08:00') {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) throw new Error(`Invalid time "${value}". Use HH:MM, for example 08:00.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${value}". Use HH:MM (24-hour).`);
  return { hour, minute };
}

/** Next local occurrence of the configured daily run time. */
export function nextRunAt(time = '08:00', now = new Date()) {
  const { hour, minute } = parseScheduleTime(time);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function commandPath(command) {
  try {
    return execFileSync('/usr/bin/which', [command], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function buildPath() {
  const dirs = [
    dirname(process.execPath),
    dirname(commandPath('opencode') || process.execPath),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set(dirs.filter(Boolean))].join(':');
}

export function launchAgentFile() {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function plistXml({ hour, minute }) {
  mkdirSync(paths.logs, { recursive: true });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(join(paths.root, 'src', 'index.js'))}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(paths.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(buildPath())}</string>
    <key>HOME</key>
    <string>${xmlEscape(homedir())}</string>
    <key>TZ</key>
    <string>${xmlEscape(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(paths.logs, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(paths.logs, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

function uid() {
  return typeof process.getuid === 'function' ? process.getuid() : 501;
}

function quietExec(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export function installSchedule({ time = '08:00' } = {}) {
  const { hour, minute } = parseScheduleTime(time);

  if (process.platform === 'darwin') {
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    const file = launchAgentFile();
    writeFileSync(file, plistXml({ hour, minute }), { mode: 0o644 });
    quietExec('launchctl', ['bootout', `gui/${uid()}`, file]);
    quietExec('launchctl', ['bootstrap', `gui/${uid()}`, file]);
    quietExec('launchctl', ['enable', `gui/${uid()}/${LABEL}`]);
    const state = quietExec('launchctl', ['print', `gui/${uid()}/${LABEL}`]);
    return {
      platform: 'darwin',
      file,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      loaded: Boolean(state),
      command: `launchctl kickstart -k gui/${uid()}/${LABEL}`,
    };
  }

  if (process.platform === 'linux') {
    mkdirSync(paths.logs, { recursive: true });
    const marker = '# scholarship-watcher';
    const line = `${minute} ${hour} * * * cd "${paths.root}" && "${process.execPath}" "${join(paths.root, 'src', 'index.js')}" run >> "${join(paths.logs, 'cron.log')}" 2>&1 ${marker}`;
    const current = quietExec('crontab', ['-l']);
    const kept = current
      .split('\n')
      .filter((entry) => entry.trim() && !entry.includes(marker));
    kept.push(line);
    execFileSync('crontab', ['-'], { input: `${kept.join('\n')}\n` });
    return {
      platform: 'linux',
      file: 'crontab',
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      loaded: true,
      command: `node ${join(paths.root, 'src', 'index.js')} run`,
    };
  }

  throw new Error(
    `Automatic scheduling is not supported on ${process.platform}. On Windows, create a Task Scheduler job that runs: node ${join(paths.root, 'src', 'index.js')} run`,
  );
}

export function removeSchedule() {
  if (process.platform === 'darwin') {
    const file = launchAgentFile();
    quietExec('launchctl', ['bootout', `gui/${uid()}`, file]);
    if (existsSync(file)) unlinkSync(file);
    return { platform: 'darwin', removed: true, file };
  }

  if (process.platform === 'linux') {
    const marker = '# scholarship-watcher';
    const current = quietExec('crontab', ['-l']);
    const kept = current.split('\n').filter((entry) => entry.trim() && !entry.includes(marker));
    execFileSync('crontab', ['-'], { input: `${kept.join('\n')}\n` });
    return { platform: 'linux', removed: true, file: 'crontab' };
  }

  return { platform: process.platform, removed: false, file: null };
}

export function scheduleStatus() {  if (process.platform === 'darwin') {
    const file = launchAgentFile();
    const installed = existsSync(file);
    const loaded = installed ? Boolean(quietExec('launchctl', ['print', `gui/${uid()}/${LABEL}`])) : false;
    return { platform: 'darwin', installed, loaded, file };
  }
  if (process.platform === 'linux') {
    const current = quietExec('crontab', ['-l']);
    const installed = current.includes('# scholarship-watcher');
    return { platform: 'linux', installed, loaded: installed, file: 'crontab' };
  }
  return { platform: process.platform, installed: false, loaded: false, file: null };
}
