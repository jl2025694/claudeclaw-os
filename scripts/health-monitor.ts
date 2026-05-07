import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const STORE_DIR = path.join(PROJECT_ROOT, 'store');
const STATE_PATH = path.join(STORE_DIR, 'health-monitor-state.json');
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const UID = typeof process.getuid === 'function' ? process.getuid() : 501;

type CheckStatus = {
  ok: boolean;
  label: string;
  detail: string;
  restartable?: boolean;
  restartLabel?: string;
};

type State = {
  statuses: Record<string, boolean>;
  restartAttempts: Record<string, number>;
};

function displayName(env = readEnv()): string {
  return env.HEALTH_MONITOR_DISPLAY_NAME || env.WORKSPACE_NAME || 'ClaudeClaw';
}

function normalizeAlertText(text: string, env = readEnv()): string {
  const name = displayName(env);
  return text
    .replace(/staxis/gi, name)
    .replace(/hanscorp/gi, name);
}

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

function loadState(): State {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as Partial<State>;
    return {
      statuses: parsed.statuses || {},
      restartAttempts: parsed.restartAttempts || {},
    };
  } catch {
    return { statuses: {}, restartAttempts: {} };
  }
}

function saveState(state: State): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function telegram(text: string): Promise<void> {
  const env = readEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.ALLOWED_CHAT_ID;
  if (!token || !chatId) {
    console.log('[health-monitor] Telegram not configured; alert skipped');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      text: normalizeAlertText(text, env),
    }),
  });
  if (!res.ok) {
    console.error('[health-monitor] Telegram alert failed:', res.status, await res.text());
  }
}

function launchdLabels(): string[] {
  if (process.platform !== 'darwin' || !fs.existsSync(LAUNCH_AGENTS_DIR)) return [];
  return fs.readdirSync(LAUNCH_AGENTS_DIR)
    .filter((name) => /^com\.claudeclaw\..+\.plist$/.test(name))
    .map((name) => name.replace(/\.plist$/, ''))
    .filter((label) => label !== 'com.claudeclaw.health-monitor')
    .sort();
}

function checkLaunchd(label: string): CheckStatus {
  try {
    const out = execFileSync('launchctl', ['print', `gui/${UID}/${label}`], { encoding: 'utf8', timeout: 5000 });
    const running = /\bstate = running\b/.test(out);
    if (!running && label === 'com.claudeclaw.backup' && out.includes('calendarinterval')) {
      return {
        ok: true,
        label: `service:${label}`,
        detail: 'scheduled',
      };
    }
    const pid = out.match(/\bpid = (\d+)/)?.[1];
    return {
      ok: running,
      label: `service:${label}`,
      detail: running ? `running${pid ? ` pid=${pid}` : ''}` : 'loaded but not running',
      restartable: label !== 'com.claudeclaw.backup',
      restartLabel: label,
    };
  } catch (err: any) {
    return {
      ok: false,
      label: `service:${label}`,
      detail: `not loaded (${err?.status ?? 'error'})`,
    };
  }
}

function autoRestart(check: CheckStatus, env: Record<string, string>, state: State): string | null {
  if ((env.HEALTH_MONITOR_AUTO_RESTART || 'true').toLowerCase() !== 'true') return null;
  if (!check.restartable || !check.restartLabel || check.ok) return null;
  const maxAttempts = Math.max(1, parseInt(env.HEALTH_MONITOR_RESTART_MAX_ATTEMPTS || '3', 10) || 3);
  const attempts = state.restartAttempts[check.label] || 0;
  if (attempts >= maxAttempts) return `auto-restart skipped: max attempts ${maxAttempts}`;

  try {
    execFileSync('launchctl', ['kickstart', '-k', `gui/${UID}/${check.restartLabel}`], { encoding: 'utf8', timeout: 15_000 });
    state.restartAttempts[check.label] = attempts + 1;
    return `auto-restart attempted (${state.restartAttempts[check.label]}/${maxAttempts})`;
  } catch (err: any) {
    state.restartAttempts[check.label] = attempts + 1;
    return `auto-restart failed (${state.restartAttempts[check.label]}/${maxAttempts}): ${err?.status ?? 'error'}`;
  }
}

async function checkDashboard(): Promise<CheckStatus[]> {
  const env = readEnv();
  const token = env.DASHBOARD_TOKEN;
  const port = env.DASHBOARD_PORT || '3141';
  if (!token) return [{ ok: false, label: 'dashboard', detail: 'DASHBOARD_TOKEN missing' }];
  try {
    const res = await fetchJson(`http://127.0.0.1:${port}/api/health?token=${encodeURIComponent(token)}`, 5000);
    if (!res.ok) return [{ ok: false, label: 'dashboard', detail: `HTTP ${res.status}` }];
    const body = res.body || {};
    return [
      { ok: true, label: 'dashboard', detail: `ok context=${body.contextPct ?? 0}%` },
      { ok: !!body.telegramConnected, label: 'telegram', detail: body.telegramConnected ? 'connected' : 'not connected' },
      { ok: body.memoryIngestion?.suspended !== true, label: 'memory-ingestion', detail: body.memoryIngestion?.suspended ? 'suspended' : 'ok' },
    ];
  } catch (err: any) {
    return [{ ok: false, label: 'dashboard', detail: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) }];
  }
}

async function checkWhatsApp(): Promise<CheckStatus[]> {
  const env = readEnv();
  if ((env.WHATSAPP_ENABLED || '').toLowerCase() !== 'true') return [];
  try {
    const res = await fetchJson('http://127.0.0.1:4242/status', 5000);
    const ready = res.ok && res.body?.ready === true;
    return [{ ok: ready, label: 'whatsapp', detail: ready ? 'ready' : `not ready HTTP ${res.status}` }];
  } catch (err: any) {
    return [{ ok: false, label: 'whatsapp', detail: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) }];
  }
}

async function runCheck(): Promise<CheckStatus[]> {
  const checks: CheckStatus[] = [];
  checks.push(...await checkDashboard());
  checks.push(...await checkWhatsApp());
  for (const label of launchdLabels()) checks.push(checkLaunchd(label));
  return checks;
}

function formatAlert(changes: CheckStatus[], all: CheckStatus[]): string {
  const name = displayName();
  const bad = all.filter((c) => !c.ok);
  const lines = [
    `<b>${escapeHtml(name)} health monitor</b>`,
    '',
    ...changes.map((c) => `${c.ok ? '[OK]' : '[WARN]'} <b>${escapeHtml(c.label)}</b>: ${escapeHtml(c.detail)}`),
  ];
  if (bad.length > 0) {
    lines.push('', '<b>Current issues</b>');
    for (const c of bad) lines.push(`- ${escapeHtml(c.label)}: ${escapeHtml(c.detail)}`);
  }
  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function tick(notifyOnFirstRun: boolean): Promise<void> {
  const env = readEnv();
  const state = loadState();
  const checks = await runCheck();
  const changes: CheckStatus[] = [];
  for (const check of checks) {
    const previous = state.statuses[check.label];
    if (!check.ok) {
      const restartDetail = autoRestart(check, env, state);
      if (restartDetail) check.detail = `${check.detail}; ${restartDetail}`;
    } else if (state.restartAttempts[check.label]) {
      delete state.restartAttempts[check.label];
    }
    if (previous === undefined) {
      if (notifyOnFirstRun && !check.ok) changes.push(check);
    } else if (previous !== check.ok) {
      changes.push(check);
    }
    state.statuses[check.label] = check.ok;
  }
  saveState(state);
  if (changes.length > 0) {
    await telegram(formatAlert(changes, checks));
  }
  console.log('[health-monitor]', new Date().toISOString(), checks.map((c) => `${c.label}=${c.ok ? 'ok' : 'bad'}`).join(' '));
}

async function main(): Promise<void> {
  const env = readEnv();
  const intervalSec = Math.max(30, parseInt(env.HEALTH_MONITOR_INTERVAL_SECONDS || '60', 10) || 60);
  const once = process.argv.includes('--once') || process.env.HEALTH_MONITOR_ONCE === '1';
  const notifyOnFirstRun = (env.HEALTH_MONITOR_NOTIFY_ON_START || 'true').toLowerCase() === 'true';

  await tick(notifyOnFirstRun);
  if (once) return;

  setInterval(() => {
    tick(false).catch((err) => console.error('[health-monitor] tick failed:', err));
  }, intervalSec * 1000);
}

main().catch((err) => {
  console.error('[health-monitor] fatal:', err);
  process.exit(1);
});
