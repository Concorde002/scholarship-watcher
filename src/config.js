import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: join(ROOT, '.env'), quiet: true });

export const paths = {
  root: ROOT,
  sources: join(ROOT, 'config', 'sources.json'),
  data: join(ROOT, 'data'),
  digests: join(ROOT, 'data', 'digests'),
  store: join(ROOT, 'data', 'opportunities.json'),
  seen: join(ROOT, 'data', 'seen.json'),
  env: join(ROOT, '.env'),
  logs: join(ROOT, 'data', 'logs'),
};

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function int(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadSources() {
  const raw = readFileSync(paths.sources, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.sources ?? [];
}

export function loadConfig() {
  return {
    enrichLimit: int(process.env.ENRICH_LIMIT, 30),
    maxAgeDays: int(process.env.MAX_AGE_DAYS, 60),
    sendEmpty: bool(process.env.SEND_EMPTY, true),
    saveWithoutEmail: bool(process.env.SAVE_WITHOUT_EMAIL, false),
    useLlm: bool(process.env.USE_LLM, false),
    llmModel: process.env.OPENCODE_MODEL?.trim() || '',
    llmBin: process.env.OPENCODE_BIN?.trim() || 'opencode',
    llmLimit: int(process.env.LLM_LIMIT, 24),
    llmTimeoutMs: int(process.env.LLM_TIMEOUT_MS, 240_000),
    mail: {
      to: process.env.DIGEST_TO?.trim() || '',
      from: process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '',
      smtpHost: process.env.SMTP_HOST?.trim() || '',
      smtpPort: int(process.env.SMTP_PORT, 465),
      smtpSecure: bool(process.env.SMTP_SECURE, true),
      smtpUser: process.env.SMTP_USER?.trim() || '',
      smtpPass: process.env.SMTP_PASS || '',
      resendKey: process.env.RESEND_API_KEY?.trim() || '',
    },
  };
}

export function hasEnvFile() {
  return existsSync(paths.env);
}

export function isMailConfigured(mail) {
  return Boolean(mail.to && mail.from && (mail.resendKey || (mail.smtpHost && mail.smtpUser && mail.smtpPass)));
}
