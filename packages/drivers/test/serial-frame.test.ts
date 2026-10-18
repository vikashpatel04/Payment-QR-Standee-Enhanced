import { type DisplayContent, getProfile, ManualClock, type PayScene, type Scene } from '@counterpay/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type FrameRequest, type FrameRenderer, SerialFrameDriver, type SerialLink, type SerialPorts } from '../src';

/** A board on a fake serial port that answers like the frame-generic firmware. */
class FakeBoard implements SerialLink {
  written: Array<string | Uint8Array> = [];
  closed = false;
  autoAck = true;
  /** What the firmware reports about its panel: `silent` when it isn't drawing. */
  panel = 'ok';
  private dataHandler: (chunk: Uint8Array) => void = () => {};
  private closeHandler: () => void = () => {};

  constructor(private readonly hello = true) {}

  write(data: string | Uint8Array): void {
    this.written.push(data);
    if (typeof data !== 'string') return;
    const message = JSON.parse(data) as { t: string; seq?: number; scene?: string };
    if (message.t === 'who' && this.hello) this.say({ t: 'hello', fw: '1.0.0', w: 250, h: 122, profile: 'waveshare-2in13-v4', panel: this.panel });
    if (message.t === 'frame' && this.autoAck) {
      void Promise.resolve().then(() => this.say({ t: 'ack', seq: message.seq, scene: message.scene, panel: this.panel }));
    }
  }
  onData(handler: (chunk: Uint8Array) => void): void {
    this.dataHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  say(message: object): void {
    const text = `${JSON.stringify(message)}\n`;
    this.dataHandler(Uint8Array.from([...text].map((c) => c.charCodeAt(0))));
  }
  unplug(): void {
    this.closeHandler();
  }
  headers(): Array<Record<string, unknown>> {
    return this.written
      .filter((w): w is string => typeof w === 'string')
      .map((w) => JSON.parse(w) as Record<string, unknown>)
      .filter((m) => m.t === 'frame');
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const content: DisplayContent = {
  shopName: 'YOUR SHOP',
  payeeLabel: 'YOUR SHOP',
  accent: '#14B37D',
  languages: ['en'],
  ambient: { slideSeconds: 8, items: [{ k: 'logo' }, { k: 'text', text: { en: 'Free alteration' } }] },
  thanks: { seconds: 10 },
};

describe('SerialFrameDriver', () => {
  let clock: ManualClock;
  let board: FakeBoard;
  let renders: FrameRequest[];
  let opened: string[];
  let ports: SerialPorts;
  const renderer: FrameRenderer = {
    async render(request) {
      renders.push(request);
      return { bits: new Uint8Array(32 * 122), preview: `data:image/png;base64,${request.scene.kind}` };
    },
  };

  const make = (port = 'auto') =>
    new SerialFrameDriver({ id: 'eink', port, profile: getProfile('waveshare-2in13-v4'), rotation: 0, ports, renderer, clock });

  const pay = (): PayScene => ({
    kind: 'pay',
    id: 5,
    shownAt: clock.now(),
    expiresAt: clock.now() + 180_000,
    amountPaise: 114000,
    ref: 'CP2610120001',
    uri: 'upi://pay?pa=shop@okaxis&am=1140.00',
  });

  beforeEach(() => {
    clock = new ManualClock();
    board = new FakeBoard();
    renders = [];
    opened = [];
    ports = {
      detect: async () => 'COM3',
      open: async (path) => {
        opened.push(path);
        return board;
      },
    };
  });

  it('finds the board, says who, and is connected after its hello', async () => {
    const driver = make();
    await driver.connect();
    await flush();
    expect(opened).toEqual(['COM3']);
    expect(board.written[0]).toBe('{"v":1,"t":"who"}\n');
    expect(driver.status()).toMatchObject({ state: 'connected', clients: 1, fw: '1.0.0', size: { w: 250, h: 122 }, port: 'COM3' });
  });

  it('reports a board whose panel is not drawing as offline, and fails its acks', async () => {
    board.panel = 'silent';
    const driver = make();
    await driver.connect();
    await flush();
    expect(driver.status()).toMatchObject({ state: 'offline', detail: 'panelSilent', port: 'COM3', fw: '1.0.0' });
    expect(await driver.show(pay())).toMatchObject({ ok: false, reason: 'panelSilent' });

    // Rewired: the next full refresh works and the display is back.
    board.panel = 'ok';
    expect(await driver.show(pay())).toMatchObject({ ok: true, scene: 'pay' });
    expect(driver.status()).toMatchObject({ state: 'connected' });
  });

  it('shows "pair again" when a Wi-Fi display no longer knows this PC', async () => {
    ports.open = async () => {
      throw Object.assign(new Error('refused'), { detail: 'unpaired' as const });
    };
    const driver = make();
    await driver.connect();
    await flush();
    expect(driver.status()).toMatchObject({ state: 'offline', detail: 'unpaired' });
    await driver.disconnect();
  });

  it('sends an Ambient frame first, so the board has something to fall back to', async () => {
    const driver = make();
    driver.setContent(content);
    await driver.connect();
    await flush();
    expect(board.headers()[0]).toMatchObject({ scene: 'ambient', w: 250, h: 122, fmt: '1bpp', len: 3904, refresh: 'full', rot: 0 });
  });

  it('sends a pay frame with its ttl, full refresh, header then pixels, and resolves on the ack', async () => {
    const driver = make();
    await driver.connect();
    await flush();
    const ack = await driver.show(pay());
    expect(ack).toMatchObject({ ok: true, scene: 'pay' });
    const header = board.headers().at(-1)!;
    expect(header).toMatchObject({ t: 'frame', scene: 'pay', ttl: 180, refresh: 'full' });
    const last = board.written.at(-1);
    expect(last).toBeInstanceOf(Uint8Array);
    expect((last as Uint8Array).length).toBe(3904);
    expect(renders.at(-1)).toMatchObject({ width: 250, height: 122, scene: { kind: 'pay' } });
    expect(driver.status().preview).toBe('data:image/png;base64,pay');
  });

  it('still renders a preview, but reports offline, with no board', async () => {
    ports.detect = async () => null;
    const driver = make();
    await driver.connect();
    await flush();
    expect(await driver.show(pay())).toMatchObject({ ok: false, reason: 'offline' });
    expect(driver.status()).toMatchObject({ state: 'waiting', preview: 'data:image/png;base64,pay' });
    await driver.disconnect();
  });

  it('gives up on a board without the firmware (no hello) and keeps retrying', async () => {
    board = new FakeBoard(false);
    const driver = make('COM7');
    await driver.connect();
    await flush();
    clock.advance(6_000);
    await flush();
    expect(driver.status().state).toBe('waiting');
    expect(board.closed).toBe(true);
    clock.advance(3_000);
    await flush();
    expect(opened).toEqual(['COM7', 'COM7']);
    await driver.disconnect();
  });

  it('times out when the board never acks', async () => {
    const driver = make();
    await driver.connect();
    await flush();
    board.autoAck = false;
    const shown = driver.show(pay());
    await flush();
    clock.advance(7_000);
    expect(await shown).toMatchObject({ ok: false, reason: 'timeout' });
    await driver.disconnect();
  });

  it('reports link loss 10 s after the cable is pulled during Pay, then reconnects', async () => {
    const driver = make();
    await driver.connect();
    await flush();
    await driver.show(pay());
    let lost = 0;
    driver.onLinkLost(() => lost++);
    ports.detect = async () => null;
    board.unplug();
    expect(driver.status().state).toBe('waiting');
    clock.advance(9_999);
    expect(lost).toBe(0);
    clock.advance(1);
    await flush();
    expect(lost).toBe(1);
    expect(driver.status().detail).toBe('linkLost');

    board = new FakeBoard();
    ports.detect = async () => 'COM3';
    clock.advance(3_000);
    await flush();
    expect(driver.status().state).toBe('connected');
    // Back on: Ambient first, then the scene that should be showing.
    expect(board.headers().map((h) => h.scene)).toEqual(['ambient', 'pay']);
    await driver.disconnect();
  });

  it('pings every 5 seconds while connected', async () => {
    const driver = make();
    await driver.connect();
    await flush();
    clock.advance(15_000);
    const pings = board.written.filter((w) => typeof w === 'string' && w.includes('"ping"'));
    expect(pings).toHaveLength(3);
    await driver.disconnect();
  });

  it('rotates Ambient slides slowly with partial refreshes, but never during Pay', async () => {
    const driver = make();
    driver.setContent(content);
    await driver.connect();
    await flush();
    const ambient: Scene = { kind: 'ambient', id: 1, shownAt: 0, reason: 'idle' };
    await driver.show(ambient);
    clock.advance(60_000);
    await flush();
    const slide = board.headers().at(-1)!;
    expect(slide).toMatchObject({ scene: 'ambient', refresh: 'partial' });
    expect(renders.at(-1)!.slide).toBe(1);

    await driver.show(pay());
    const before = board.headers().length;
    clock.advance(120_000);
    await flush();
    expect(board.headers().length).toBe(before);
    await driver.disconnect();
  });

  it('sends frames at portrait size when the panel is mounted at 90°', async () => {
    const driver = new SerialFrameDriver({ id: 'eink', port: 'auto', profile: getProfile('waveshare-2in13-v4'), rotation: 90, ports, renderer, clock });
    await driver.connect();
    await flush();
    expect(board.headers()[0]).toMatchObject({ w: 122, h: 250, len: 16 * 250, rot: 90 });
    await driver.disconnect();
  });
});
