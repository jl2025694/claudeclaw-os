import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.env.CLAUDECLAW_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\b\d{7,}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TELEGRAM_TOKEN]')
      .replace(/\b(?:sk|ghp|github_pat|xox[baprs]|pat)[A-Za-z0-9_:-]{20,}\b/gi, '[REDACTED_TOKEN]')
      .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_JWT]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|secret|password|authorization|api[_-]?key/i.test(key)) out[key] = '[REDACTED]';
      else out[key] = redact(item);
    }
    return out;
  }
  return value;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 1500);
  });
}

async function main(): Promise<void> {
  const event = process.argv[2] || 'unknown';
  const env = readEnv();
  const enabled = (env.N8N_HOOKS_ENABLED || 'false').toLowerCase() === 'true';
  const url = env.N8N_WEBHOOK_URL || '';
  if (!enabled || !url) return;

  const raw = await readStdin();
  let hookPayload: unknown = raw;
  try {
    hookPayload = raw ? JSON.parse(raw) : {};
  } catch {
    hookPayload = { raw };
  }

  const payload = {
    source: 'straxis',
    event,
    agentId: process.env.CLAUDECLAW_AGENT_ID || process.env.CLAUDE_AGENT_ID || 'local',
    projectRoot: PROJECT_ROOT,
    timestamp: new Date().toISOString(),
    payload: redact(hookPayload),
  };

  const body = JSON.stringify(payload).slice(0, 200_000);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.N8N_WEBHOOK_SECRET) headers['x-straxis-secret'] = env.N8N_WEBHOOK_SECRET;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!res.ok) {
      console.error('[n8n-hook] webhook failed:', res.status, await res.text());
    }
  } finally {
    clearTimeout(timer);
  }
}

main().catch((err) => {
  console.error('[n8n-hook] error:', err?.message || err);
  process.exit(0);
});
