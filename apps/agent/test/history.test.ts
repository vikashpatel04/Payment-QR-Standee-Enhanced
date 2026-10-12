import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryDb } from '../src/main/history';
import { mergePatch } from '../src/main/merge';

const T0 = Date.UTC(2026, 9, 12, 6, 0, 0);

describe('HistoryDb', () => {
  let dir: string;
  let db: HistoryDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'counterpay-history-'));
    db = new HistoryDb(join(dir, 'history.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const start = (ref: string, amountPaise: number, shownAt: number, source: 'popup' | 'api' = 'popup') =>
    db.start({ ref, amountPaise, shownAt, displays: ['sim', 'phone-1'], source });

  it('records a QR from start to end', () => {
    start('CP2610120001', 114000, T0);
    db.end('CP2610120001', 'cleared', T0 + 42_000);
    expect(db.query()).toEqual([
      {
        id: 1,
        ref: 'CP2610120001',
        amountPaise: 114000,
        shownAt: T0,
        endedAt: T0 + 42_000,
        endReason: 'cleared',
        displays: ['sim', 'phone-1'],
        source: 'popup',
        note: null,
      },
    ]);
  });

  it('never overwrites how a QR ended', () => {
    start('CP2610120001', 100, T0);
    db.end('CP2610120001', 'replaced', T0 + 1_000);
    db.end('CP2610120001', 'expired', T0 + 180_000);
    expect(db.query()[0]).toMatchObject({ endReason: 'replaced', endedAt: T0 + 1_000 });
  });

  it('rejects a duplicate reference and a zero amount', () => {
    start('CP2610120001', 100, T0);
    expect(() => start('CP2610120001', 100, T0)).toThrow();
    expect(() => start('CP2610120002', 0, T0)).toThrow();
  });

  it('closes rows left open by a crash as expired at their ttl', () => {
    start('CP2610120001', 100, T0);
    start('CP2610120002', 200, T0 + 170_000);
    expect(db.closeDangling(T0 + 200_000, 180_000)).toBe(2);
    const [second, first] = db.query();
    expect(first).toMatchObject({ endReason: 'expired', endedAt: T0 + 180_000 });
    expect(second).toMatchObject({ endReason: 'expired', endedAt: T0 + 200_000 });
  });

  it('filters by time, amount and outcome, newest first', () => {
    start('CP2610110001', 50000, T0 - 86_400_000);
    start('CP2610120001', 114000, T0);
    start('CP2610120002', 5000, T0 + 60_000, 'api');
    db.end('CP2610120001', 'cleared', T0 + 10_000);
    db.end('CP2610120002', 'expired', T0 + 240_000);

    expect(db.query({ from: T0 }).map((e) => e.ref)).toEqual(['CP2610120002', 'CP2610120001']);
    expect(db.query({ to: T0 }).map((e) => e.ref)).toEqual(['CP2610110001']);
    expect(db.query({ minPaise: 10000, maxPaise: 100000 }).map((e) => e.ref)).toEqual(['CP2610110001']);
    expect(db.query({ reasons: ['expired'] }).map((e) => e.ref)).toEqual(['CP2610120002']);
    expect(db.query({ reasons: ['open'] }).map((e) => e.ref)).toEqual(['CP2610110001']);
    expect(db.query({ reasons: ['cleared', 'open'] })).toHaveLength(2);
    expect(db.query({ limit: 1 })).toHaveLength(1);
  });

  it('ignores reasons it does not know instead of building SQL from them', () => {
    start('CP2610120001', 100, T0);
    expect(db.query({ reasons: ["cleared') OR 1=1 --" as never] })).toEqual([]);
  });

  it('sums a day', () => {
    start('CP2610120001', 114000, T0);
    start('CP2610120002', 5050, T0 + 1_000);
    start('CP2610130001', 999, T0 + 86_400_000);
    expect(db.stats(T0, T0 + 86_400_000)).toEqual({ count: 2, totalPaise: 119050 });
    expect(db.stats(T0 + 172_800_000, T0 + 259_200_000)).toEqual({ count: 0, totalPaise: 0 });
  });

  it('finds the newest reference for a prefix, escaping LIKE wildcards', () => {
    start('CP2610120007', 100, T0);
    start('CP2610120012', 100, T0 + 1);
    start('XX2610120099', 100, T0 + 2);
    expect(db.lastRefStartingWith('CP261012')).toBe('CP2610120012');
    expect(db.lastRefStartingWith('C_261012')).toBeNull();
    expect(db.lastRefStartingWith('ZZ')).toBeNull();
  });

  it('purges rows past the retention period', () => {
    start('CP2510010001', 100, T0 - 400 * 86_400_000);
    start('CP2610120001', 100, T0);
    expect(db.purge(365, T0)).toBe(1);
    expect(db.query().map((e) => e.ref)).toEqual(['CP2610120001']);
  });
});

describe('mergePatch', () => {
  it('merges objects key by key and replaces arrays', () => {
    const base = { a: { x: 1, y: 2 }, list: [1, 2, 3], keep: 'yes' };
    expect(mergePatch(base, { a: { y: 5 }, list: [9] })).toEqual({ a: { x: 1, y: 5 }, list: [9], keep: 'yes' });
  });

  it('leaves keys alone when the patch says undefined', () => {
    expect(mergePatch({ a: 1, b: 2 }, { a: undefined, b: 3 })).toEqual({ a: 1, b: 3 });
  });
});
