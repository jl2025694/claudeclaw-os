import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = readEnv();
const BACKUP_DIR = env.BACKUP_DIR || path.join(os.homedir(), 'Backups', 'straxis');
const KEEP_DAYS = parseInt(env.BACKUP_KEEP_DAYS || '14', 10) || 14;
const KEEP_COUNT = parseInt(env.BACKUP_KEEP_COUNT || '30', 10) || 30;
const DRIVE_UPLOAD_ENABLED = (env.BACKUP_GDRIVE_ENABLED || 'true').toLowerCase() === 'true';
const DRIVE_FOLDER_ID_FILE = path.join(BACKUP_DIR, '.gdrive-folder-id');

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function copyIfExists(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true, force: true });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function prune(): void {
  if (!fs.existsSync(BACKUP_DIR)) return;
  const now = Date.now();
  const maxAgeMs = KEEP_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((name) => /^straxis-backup-.+\.tgz$/.test(name))
    .map((name) => {
      const full = path.join(BACKUP_DIR, name);
      return { name, full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files) {
    if (now - file.mtime > maxAgeMs) fs.rmSync(file.full, { force: true });
  }

  const remaining = files
    .filter((file) => fs.existsSync(file.full))
    .sort((a, b) => b.mtime - a.mtime);
  for (const file of remaining.slice(KEEP_COUNT)) {
    fs.rmSync(file.full, { force: true });
  }
}

function readDriveFolderId(): string {
  if (env.BACKUP_GDRIVE_FOLDER_ID) return env.BACKUP_GDRIVE_FOLDER_ID;
  try {
    return fs.readFileSync(DRIVE_FOLDER_ID_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function pythonPath(): string {
  const venv = path.join(os.homedir(), '.venv', 'bin', 'python3');
  if (fs.existsSync(venv)) return venv;
  return process.env.PYTHON || 'python3';
}

function ensureDriveFolder(): string {
  const existing = readDriveFolderId();
  if (existing) return existing;

  const name = env.BACKUP_GDRIVE_FOLDER_NAME || 'Straxis Backups';
  const gdrive = path.join(os.homedir(), '.config', 'drive', 'gdrive.py');
  const raw = execFileSync(
    pythonPath(),
    [gdrive, 'mkdir', name],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CLAUDECLAW_DIR: PROJECT_ROOT },
      timeout: 60_000,
    },
  );
  const parsed = JSON.parse(raw) as { id?: string };
  if (!parsed.id) throw new Error('Google Drive folder creation did not return an id');
  fs.writeFileSync(DRIVE_FOLDER_ID_FILE, parsed.id);
  fs.chmodSync(DRIVE_FOLDER_ID_FILE, 0o600);
  console.log(`[backup] Google Drive folder ready: ${name}`);
  return parsed.id;
}

function uploadToDrive(archive: string): void {
  if (!DRIVE_UPLOAD_ENABLED) {
    console.log('[backup] Google Drive upload disabled');
    return;
  }

  const gdrive = path.join(os.homedir(), '.config', 'drive', 'gdrive.py');
  if (!fs.existsSync(gdrive)) {
    console.log('[backup] Google Drive CLI not found; skipping upload');
    return;
  }

  const folderId = ensureDriveFolder();
  const raw = execFileSync(
    pythonPath(),
    [gdrive, 'upload', archive, '--parent', folderId],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, CLAUDECLAW_DIR: PROJECT_ROOT },
      timeout: 5 * 60_000,
    },
  );
  const parsed = JSON.parse(raw) as { id?: string; webViewLink?: string };
  console.log(`[backup] uploaded to Google Drive${parsed.id ? ` id=${parsed.id}` : ''}${parsed.webViewLink ? ` link=${parsed.webViewLink}` : ''}`);
}

function main(): void {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.chmodSync(BACKUP_DIR, 0o700);

  const staging = path.join(BACKUP_DIR, `.staging-${process.pid}-${stamp()}`);
  fs.mkdirSync(staging, { recursive: true });

  copyIfExists(path.join(PROJECT_ROOT, '.env'), path.join(staging, 'project/.env'));
  copyIfExists(path.join(PROJECT_ROOT, 'store/claudeclaw.db'), path.join(staging, 'project/store/claudeclaw.db'));
  copyIfExists(path.join(PROJECT_ROOT, 'store/claudeclaw.db-wal'), path.join(staging, 'project/store/claudeclaw.db-wal'));
  copyIfExists(path.join(PROJECT_ROOT, 'store/claudeclaw.db-shm'), path.join(staging, 'project/store/claudeclaw.db-shm'));
  copyIfExists(path.join(PROJECT_ROOT, 'launchd'), path.join(staging, 'project/launchd'));
  copyIfExists(path.join(os.homedir(), '.claudeclaw/agents'), path.join(staging, 'home/.claudeclaw/agents'));
  copyIfExists(path.join(os.homedir(), '.claude/skills'), path.join(staging, 'home/.claude/skills'));
  copyIfExists(path.join(os.homedir(), '.claude/.credentials.json'), path.join(staging, 'home/.claude/.credentials.json'));
  copyIfExists(path.join(os.homedir(), '.config/gmail'), path.join(staging, 'home/.config/gmail'));
  copyIfExists(path.join(os.homedir(), '.config/drive'), path.join(staging, 'home/.config/drive'));
  copyIfExists(path.join(os.homedir(), '.config/calendar'), path.join(staging, 'home/.config/calendar'));
  copyIfExists(path.join(os.homedir(), '.config/twilio'), path.join(staging, 'home/.config/twilio'));

  const manifest = {
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    projectRoot: PROJECT_ROOT,
    includesSecrets: true,
    retention: { keepDays: KEEP_DAYS, keepCount: KEEP_COUNT },
  };
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const archive = path.join(BACKUP_DIR, `straxis-backup-${stamp()}.tgz`);
  try {
    execFileSync('tar', ['-czf', archive, '-C', staging, '.'], { stdio: 'pipe' });
    fs.chmodSync(archive, 0o600);
    console.log(`[backup] created ${archive}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  uploadToDrive(archive);
  prune();
}

main();
