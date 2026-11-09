import { spawn } from 'node:child_process';
import { truncate } from './util.js';

const SYSTEM_INSTRUCTIONS = `You are a strict scholarship eligibility filter. Do not use any tools. Read each item and decide:

1. fullyFunded: true ONLY if the program explicitly says it is fully funded, fully sponsored, 100% funded, or all expenses paid (travel, accommodation, and/or fees covered). Partial funding, tuition-only, or "scholarship available" is false. If unsure, false.
2. applicationFee: true if there is ANY application, registration, participation, program, processing, seat or deposit fee, even if a waiver exists. "No application fee" is false.
3. deadline: the APPLICATION deadline as YYYY-MM-DD, or null. Never use the event date. If no deadline is stated, null.
4. eventDates: when the conference, summit or programme actually takes place, as a short human string (e.g. "10–12 March 2027", "May 28 – June 11, 2027", "September 2027 – August 2028"), or null. Never put the application deadline here.
5. location: host country or "Online" (max 6 words, or null).
6. category: one of Scholarship, Fellowship, Conference, Summit, Exchange, Grant, Internship, Other.
7. confidence: 0 to 1.
8. reason: max 15 words, why accepted or rejected.

Return ONLY a JSON array. No markdown, no prose:
[{"id":"...","fullyFunded":true,"applicationFee":false,"deadline":"2026-01-15","eventDates":"10–12 March 2027","location":"Germany","category":"Conference","confidence":0.9,"reason":"..."}]

Items:`;

function buildPrompt(batch) {
  const blocks = batch.map((item, index) => {
    const text = truncate(item.pageText || item.summary || item.title, 2600);
    return [
      `--- ITEM ${index + 1} ---`,
      `id: ${item.id}`,
      `title: ${item.title}`,
      `source: ${item.sourceName}`,
      `url: ${item.url}`,
      `text: ${text}`,
    ].join('\n');
  });
  return `${SYSTEM_INSTRUCTIONS}\n\n${blocks.join('\n\n')}`;
}

function extractJsonArray(output) {
  const text = String(output ?? '').replace(/```(?:json)?/gi, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function runOpencode(prompt, { bin, model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = ['run'];
    if (model) args.push('-m', model);
    args.push(prompt);

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      reject(new Error(`opencode timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 100_000) stderr = stderr.slice(-50_000);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`opencode exited with ${code}: ${truncate(stderr || stdout, 300)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Ask the local opencode CLI to verify candidates and extract deadlines.
 * Returns a Map of item id -> verdict. Failures are non-fatal.
 */
export async function reviewWithLlm(items, config, logger = console) {
  const results = new Map();
  const batchSize = 6;
  const queue = items.slice(0, config.limit ?? 24);
  if (queue.length === 0) return results;

  for (let offset = 0; offset < queue.length; offset += batchSize) {
    const batch = queue.slice(offset, offset + batchSize);
    const number = Math.floor(offset / batchSize) + 1;
    const total = Math.ceil(queue.length / batchSize);
    logger.log(`[llm] Reviewing batch ${number}/${total} (${batch.length} items)…`);

    try {
      const output = await runOpencode(buildPrompt(batch), {
        bin: config.bin || 'opencode',
        model: config.model || '',
        timeoutMs: config.timeoutMs ?? 240_000,
      });
      const verdicts = extractJsonArray(output);
      if (!verdicts) throw new Error('No JSON array in model output');

      for (const verdict of verdicts) {
        if (verdict && typeof verdict.id === 'string') {
          results.set(verdict.id, verdict);
        }
      }
    } catch (error) {
      logger.warn(`[llm] Batch ${number} failed: ${error.message}. Keeping heuristic verdicts.`);
    }
  }

  return results;
}
