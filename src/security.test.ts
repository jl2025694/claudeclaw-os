import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetSecurityForTests,
  getSecurityStatus,
  hashPin,
  initSecurity,
  touchActivity,
  unlock,
} from './security.js';

describe('security idle lock state', () => {
  let tmpDir: string;
  let statePath: string;
  let pinHash: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T00:00:00.000Z'));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeclaw-security-test-'));
    statePath = path.join(tmpDir, 'security-state.json');
    pinHash = hashPin('1234');
    _resetSecurityForTests();
  });

  afterEach(() => {
    _resetSecurityForTests();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps an unlocked session after restart until 12 hours after last activity', () => {
    initSecurity({ pinHash, idleLockMinutes: 720, statePath });
    expect(getSecurityStatus().locked).toBe(true);

    expect(unlock('1234')).toBe(true);
    expect(getSecurityStatus().locked).toBe(false);

    vi.setSystemTime(new Date('2026-05-07T11:59:00.000Z'));
    _resetSecurityForTests();
    initSecurity({ pinHash, idleLockMinutes: 720, statePath });
    expect(getSecurityStatus().locked).toBe(false);

    vi.setSystemTime(new Date('2026-05-07T12:01:00.000Z'));
    expect(getSecurityStatus().locked).toBe(true);
  });

  it('persists touchActivity as the start of the 12-hour idle window', () => {
    initSecurity({ pinHash, idleLockMinutes: 720, statePath });
    expect(unlock('1234')).toBe(true);

    vi.setSystemTime(new Date('2026-05-07T02:00:00.000Z'));
    touchActivity();

    vi.setSystemTime(new Date('2026-05-07T13:59:00.000Z'));
    _resetSecurityForTests();
    initSecurity({ pinHash, idleLockMinutes: 720, statePath });
    expect(getSecurityStatus().locked).toBe(false);

    vi.setSystemTime(new Date('2026-05-07T14:01:00.000Z'));
    expect(getSecurityStatus().locked).toBe(true);
  });

  it('reloads shared activity state before deciding idle lock status', () => {
    initSecurity({ pinHash, idleLockMinutes: 720, statePath });
    expect(unlock('1234')).toBe(true);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    state.locked = false;
    state.lastActivity = new Date('2026-05-07T02:00:00.000Z').getTime();
    fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });

    vi.setSystemTime(new Date('2026-05-07T13:59:00.000Z'));
    expect(getSecurityStatus().locked).toBe(false);

    vi.setSystemTime(new Date('2026-05-07T14:01:00.000Z'));
    expect(getSecurityStatus().locked).toBe(true);
  });
});
