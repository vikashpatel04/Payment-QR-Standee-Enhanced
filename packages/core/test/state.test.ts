import { beforeEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../src/manual-clock';
import type { Scene } from '../src/scenes';
import { type PayEnded, type PayStarted, SceneMachine } from '../src/state';

describe('SceneMachine', () => {
  let clock: ManualClock;
  let machine: SceneMachine;
  let scenes: Scene[];
  let started: PayStarted[];
  let ended: PayEnded[];
  let refCount: number;

  beforeEach(() => {
    clock = new ManualClock();
    refCount = 0;
    machine = new SceneMachine({
      clock,
      preparePay: (paise) => {
        refCount += 1;
        const ref = `CP261012${String(refCount).padStart(4, '0')}`;
        return { ref, uri: `upi://pay?pa=shop@okaxis&tr=${ref}&am=${paise / 100}` };
      },
      ttlSeconds: () => 180,
      thanksSeconds: () => 10,
    });
    scenes = [];
    started = [];
    ended = [];
    machine.on('scene', (s) => scenes.push(s));
    machine.on('payStarted', (e) => started.push(e));
    machine.on('payEnded', (e) => ended.push(e));
  });

  it('starts on Ambient', () => {
    expect(machine.current).toMatchObject({ kind: 'ambient', reason: 'idle' });
  });

  it('shows a pay QR with its reference, link and expiry', () => {
    const pay = machine.showAmount(114000, 'popup');
    expect(pay).toMatchObject({
      kind: 'pay',
      amountPaise: 114000,
      ref: 'CP2610120001',
      shownAt: clock.time,
      expiresAt: clock.time + 180_000,
    });
    expect(machine.current).toBe(pay);
    expect(started).toEqual([{ scene: pay, source: 'popup' }]);
  });

  it('expires a QR after its ttl and falls back to Ambient', () => {
    const pay = machine.showAmount(114000, 'popup');
    clock.advance(179_999);
    expect(machine.current.kind).toBe('pay');
    clock.advance(1);
    expect(machine.current).toMatchObject({ kind: 'ambient', reason: 'expired' });
    expect(ended).toEqual([{ scene: pay, reason: 'expired', endedAt: pay.expiresAt }]);
  });

  it('honours a per-QR ttl', () => {
    machine.showAmount(5000, 'api', 30);
    clock.advance(30_000);
    expect(machine.current).toMatchObject({ kind: 'ambient', reason: 'expired' });
  });

  it('replaces a QR in place when a new amount arrives', () => {
    const first = machine.showAmount(114000, 'popup');
    clock.advance(5_000);
    const second = machine.showAmount(105000, 'popup');
    expect(ended).toEqual([{ scene: first, reason: 'replaced', endedAt: clock.time }]);
    expect(machine.current).toBe(second);
    expect(second.ref).toBe('CP2610120002');
    // The new QR gets a full ttl and the old timer is gone.
    clock.advance(179_999);
    expect(machine.current).toBe(second);
    expect(ended).toHaveLength(1);
  });

  it('clears to Thanks, then Ambient after the thanks time', () => {
    const pay = machine.showAmount(114000, 'popup');
    expect(machine.clear()).toBe(true);
    expect(ended).toEqual([{ scene: pay, reason: 'cleared', endedAt: clock.time }]);
    expect(machine.current.kind).toBe('thanks');
    clock.advance(10_000);
    expect(machine.current).toMatchObject({ kind: 'ambient', reason: 'thanks-done' });
  });

  it('can clear straight to Ambient', () => {
    machine.showAmount(114000, 'popup');
    machine.clear('ambient');
    expect(machine.current).toMatchObject({ kind: 'ambient', reason: 'cleared' });
  });

  it('cuts Thanks short on clear-to-ambient, and reports nothing to clear on Ambient', () => {
    machine.showAmount(114000, 'popup');
    machine.clear();
    expect(machine.clear('ambient')).toBe(true);
    expect(machine.current.kind).toBe('ambient');
    expect(machine.clear()).toBe(false);
  });

  it('a new amount during Thanks shows the QR and cancels the thanks timer', () => {
    machine.showAmount(114000, 'popup');
    machine.clear();
    const pay = machine.showAmount(5000, 'popup');
    clock.advance(10_000);
    expect(machine.current).toBe(pay);
  });

  it('ends a QR on link loss, straight to Ambient', () => {
    const pay = machine.showAmount(114000, 'popup');
    expect(machine.linkLost()).toBe(true);
    expect(ended).toEqual([{ scene: pay, reason: 'link-lost', endedAt: clock.time }]);
    expect(machine.current).toMatchObject({ kind: 'ambient', reason: 'link-lost' });
    expect(machine.linkLost()).toBe(false);
  });

  it('ends a QR when the bill is saved and shows Thanks', () => {
    machine.showAmount(114000, 'popup');
    expect(machine.billSaved()).toBe(true);
    expect(ended[0]?.reason).toBe('bill-saved');
    expect(machine.current.kind).toBe('thanks');
    expect(machine.billSaved()).toBe(false);
  });

  it('skips Thanks when its time is zero', () => {
    const quick = new SceneMachine({
      clock,
      preparePay: () => ({ ref: 'CP2610120001', uri: 'upi://pay?pa=x@y' }),
      ttlSeconds: () => 180,
      thanksSeconds: () => 0,
    });
    quick.showAmount(100, 'popup');
    quick.clear();
    expect(quick.current).toMatchObject({ kind: 'ambient', reason: 'cleared' });
  });

  it('leaves the scene alone when preparing the QR fails', () => {
    const broken = new SceneMachine({
      clock,
      preparePay: () => {
        throw new Error('No payee set up');
      },
      ttlSeconds: () => 180,
      thanksSeconds: () => 10,
    });
    expect(() => broken.showAmount(100, 'popup')).toThrow('No payee set up');
    expect(broken.current.kind).toBe('ambient');
  });

  it('rejects amounts that are not positive integer paise', () => {
    expect(() => machine.showAmount(0, 'popup')).toThrow(RangeError);
    expect(() => machine.showAmount(1.5, 'popup')).toThrow(RangeError);
    expect(refCount).toBe(0);
  });

  it('ends every pay QR exactly once, whatever the sequence (no QR left showing)', () => {
    const actions = [
      () => machine.showAmount(100 + Math.floor(Math.random() * 1000) * 100, 'popup'),
      () => machine.clear(),
      () => machine.clear('ambient'),
      () => machine.linkLost(),
      () => machine.billSaved(),
      () => clock.advance(Math.floor(Math.random() * 200_000)),
    ];
    for (let i = 0; i < 2000; i += 1) actions[Math.floor(Math.random() * actions.length)]!();
    clock.advance(1_000_000);

    expect(machine.current.kind).toBe('ambient');
    expect(clock.pending).toBe(0);
    const endedRefs = ended.map((e) => e.scene.ref);
    expect(new Set(endedRefs).size).toBe(endedRefs.length);
    expect(endedRefs.sort()).toEqual(started.map((s) => s.scene.ref).sort());
  });

  it('emits a scene event for every change, with increasing ids', () => {
    machine.showAmount(100, 'popup');
    machine.clear();
    clock.advance(10_000);
    expect(scenes.map((s) => s.kind)).toEqual(['pay', 'thanks', 'ambient']);
    const ids = scenes.map((s) => s.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});
