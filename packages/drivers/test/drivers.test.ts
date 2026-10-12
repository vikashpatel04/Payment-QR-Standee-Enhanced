import {
  type DisplayContent,
  type DisplayMessage,
  ManualClock,
  type PayScene,
  type PcMessage,
  type Scene,
} from '@counterpay/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDriver, type DisplayLink, SimulatorDriver, WebDriver, WindowDriver, type WindowHost } from '../src';

class FakeLink implements DisplayLink {
  static count = 0;
  readonly id = `link-${++FakeLink.count}`;
  sent: PcMessage[] = [];
  closed = false;
  private messageHandler: (m: DisplayMessage) => void = () => {};
  private closeHandler: () => void = () => {};

  constructor(readonly role: 'display' | 'preview' = 'display') {}

  send(message: PcMessage): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
    this.closeHandler();
  }
  onMessage(handler: (m: DisplayMessage) => void): void {
    this.messageHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  reply(message: DisplayMessage): void {
    this.messageHandler(message);
  }
  ackLast(): void {
    const last = [...this.sent].reverse().find((m) => m.t === 'pay' || m.t === 'clear');
    if (last && (last.t === 'pay' || last.t === 'clear')) {
      this.reply({ t: 'ack', seq: last.seq, scene: last.t === 'pay' ? 'pay' : last.then });
    }
  }
}

const pay = (clock: ManualClock, ref = 'CP2610120001'): PayScene => ({
  kind: 'pay',
  id: 2,
  shownAt: clock.now(),
  expiresAt: clock.now() + 180_000,
  amountPaise: 114000,
  ref,
  uri: `upi://pay?pa=shop@okaxis&tr=${ref}&am=1140.00&cu=INR`,
});

const content: DisplayContent = {
  shopName: 'YOUR SHOP',
  payeeLabel: 'YOUR SHOP',
  accent: '#14B37D',
  languages: ['en', 'ta'],
  ambient: { slideSeconds: 8, items: [{ k: 'logo' }] },
  thanks: { seconds: 10 },
};

describe('LinkedDriver (via WebDriver)', () => {
  let clock: ManualClock;
  let driver: WebDriver;

  beforeEach(async () => {
    clock = new ManualClock();
    driver = new WebDriver('phone', clock);
    await driver.connect();
  });

  it('reports offline at once when nothing is connected', async () => {
    expect(await driver.show(pay(clock))).toMatchObject({ ok: false, reason: 'offline' });
    expect(driver.status()).toMatchObject({ state: 'waiting', detail: 'noClients', clients: 0 });
  });

  it('resolves show() on the device ack, with latency', async () => {
    const link = new FakeLink();
    driver.attach(link);
    const shown = driver.show(pay(clock));
    clock.time += 40;
    link.ackLast();
    expect(await shown).toMatchObject({ ok: true, scene: 'pay', latencyMs: 40 });
    expect(driver.status()).toMatchObject({ state: 'connected', clients: 1, lastAckMs: 40 });
  });

  it('sends the full UPI link to web displays', async () => {
    const link = new FakeLink();
    driver.attach(link);
    void driver.show(pay(clock));
    expect(link.sent.at(-1)).toMatchObject({ t: 'pay', amt: 114000, ttl: 180, uri: expect.stringContaining('am=1140.00') });
  });

  it('times out when no ack comes', async () => {
    driver.attach(new FakeLink());
    const shown = driver.show(pay(clock));
    clock.advance(1500);
    expect(await shown).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('settles an older show() as superseded when a newer scene goes out', async () => {
    driver.attach(new FakeLink());
    const first = driver.show(pay(clock));
    void driver.show(pay(clock, 'CP2610120002'));
    expect(await first).toMatchObject({ ok: false, reason: 'superseded' });
  });

  it('replays content and the current scene, with the time left, to a device that joins late', async () => {
    driver.setContent(content);
    await driver.show(pay(clock));
    clock.time += 60_000;
    const late = new FakeLink();
    driver.attach(late);
    expect(late.sent.map((m) => m.t)).toEqual(['content', 'playlist', 'pay']);
    expect(late.sent[2]).toMatchObject({ ttl: 120 });
  });

  it('pings every 5 seconds', () => {
    const link = new FakeLink();
    driver.attach(link);
    clock.advance(15_000);
    expect(link.sent.filter((m) => m.t === 'ping')).toHaveLength(3);
  });

  it('reports link loss 10 s after the last device drops during Pay', async () => {
    const link = new FakeLink();
    driver.attach(link);
    const shown = driver.show(pay(clock));
    link.ackLast();
    await shown;

    let lost = 0;
    driver.onLinkLost(() => lost++);
    link.close();
    clock.advance(9_999);
    expect(lost).toBe(0);
    clock.advance(1);
    expect(lost).toBe(1);
    expect(driver.status()).toMatchObject({ state: 'waiting', detail: 'linkLost' });
  });

  it('cancels link loss when a device comes back in time', async () => {
    const link = new FakeLink();
    driver.attach(link);
    void driver.show(pay(clock));
    let lost = 0;
    driver.onLinkLost(() => lost++);
    link.close();
    clock.advance(5_000);
    driver.attach(new FakeLink());
    clock.advance(10_000);
    expect(lost).toBe(0);
  });

  it('does not report link loss outside Pay', async () => {
    const link = new FakeLink();
    driver.attach(link);
    void driver.show({ kind: 'ambient', id: 1, shownAt: 0, reason: 'idle' });
    let lost = 0;
    driver.onLinkLost(() => lost++);
    link.close();
    clock.advance(20_000);
    expect(lost).toBe(0);
  });

  it('mirrors scenes to previews but never counts them as connected', async () => {
    const preview = new FakeLink('preview');
    driver.attach(preview);
    preview.reply({ t: 'ack', seq: 99, scene: 'pay' });
    expect(await driver.show(pay(clock))).toMatchObject({ ok: false, reason: 'offline' });
    expect(preview.sent.at(-1)).toMatchObject({ t: 'pay' });
    expect(driver.status()).toMatchObject({ clients: 0, previews: 1 });
  });

  it('records the device hello', () => {
    const link = new FakeLink();
    driver.attach(link);
    link.reply({ t: 'hello', fw: '1.0.0', w: 320, h: 480, vpa: 'sh…@ok…' });
    expect(driver.status()).toMatchObject({ fw: '1.0.0', vpa: 'sh…@ok…', size: { w: 320, h: 480 } });
  });

  it('closes links and settles pending acks on disconnect', async () => {
    const link = new FakeLink();
    driver.attach(link);
    const shown = driver.show(pay(clock));
    await driver.disconnect();
    expect(link.closed).toBe(true);
    expect(await shown).toMatchObject({ ok: false, reason: 'offline' });
    expect(clock.pending).toBe(0);
  });
});

describe('SimulatorDriver', () => {
  it('is always connected and acknowledges at once', async () => {
    const clock = new ManualClock();
    const sim = new SimulatorDriver('sim', clock);
    await sim.connect();
    expect(sim.status()).toMatchObject({ state: 'connected', clients: 0 });
    expect(await sim.show(pay(clock))).toMatchObject({ ok: true, virtual: true, scene: 'pay' });
  });

  it('pushes scenes to its viewers', async () => {
    const clock = new ManualClock();
    const sim = new SimulatorDriver('sim', clock);
    const viewer = new FakeLink('preview');
    sim.attach(viewer);
    await sim.show(pay(clock));
    expect(viewer.sent.at(-1)).toMatchObject({ t: 'pay', uri: expect.any(String) });
    expect(sim.status()).toMatchObject({ previews: 1 });
  });
});

describe('WindowDriver', () => {
  const host = (available: { value: boolean }) => {
    const listeners = new Set<() => void>();
    const calls: string[] = [];
    const windowHost: WindowHost = {
      open: ({ displayId, monitor }) => {
        calls.push(`open ${displayId} ${monitor}`);
        return available.value;
      },
      close: (displayId) => calls.push(`close ${displayId}`),
      onMonitorsChanged: (callback) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    };
    return { windowHost, calls, changeMonitors: () => listeners.forEach((l) => l()) };
  };

  it('opens its window on connect and closes it on disconnect', async () => {
    const h = host({ value: true });
    const driver = new WindowDriver({ id: 'monitor-2', monitor: 2, rotation: 90, host: h.windowHost });
    await driver.connect();
    await driver.disconnect();
    expect(h.calls).toEqual(['open monitor-2 2', 'close monitor-2']);
    expect(driver.profile.rotation).toBe(90);
  });

  it('reports a missing monitor, then recovers when it is plugged in', async () => {
    const available = { value: false };
    const h = host(available);
    const driver = new WindowDriver({ id: 'monitor-2', monitor: 2, rotation: 0, host: h.windowHost });
    await driver.connect();
    expect(driver.status()).toMatchObject({ state: 'offline', detail: 'monitorMissing' });
    available.value = true;
    h.changeMonitors();
    expect(driver.status()).toMatchObject({ state: 'waiting' });
    await driver.disconnect();
  });
});

describe('createDriver', () => {
  const windowHost: WindowHost = { open: () => true, close: () => {}, onMonitorsChanged: () => () => {} };

  it('builds the right driver for each config', () => {
    expect(createDriver({ id: 'sim', driver: 'simulator', enabled: true }, { windowHost }).kind).toBe('simulator');
    expect(createDriver({ id: 'm', driver: 'window', enabled: true, monitor: 2 }, { windowHost }).kind).toBe('window');
    expect(createDriver({ id: 'p', driver: 'web', enabled: true }, { windowHost }).kind).toBe('web');
  });

  it('marks serial drivers as Phase 2', async () => {
    const eink = createDriver({ id: 'e', driver: 'serial-frame', enabled: true, profile: 'waveshare-4in2' }, { windowHost });
    expect(eink.status()).toMatchObject({ state: 'unsupported', detail: 'phase2' });
    expect(eink.profile).toMatchObject({ tech: 'eink', w: 400, h: 300 });
    const scene: Scene = { kind: 'ambient', id: 1, shownAt: 0, reason: 'idle' };
    expect(await eink.show(scene)).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});
