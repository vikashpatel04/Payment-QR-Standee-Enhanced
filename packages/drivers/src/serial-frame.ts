import {
  type Clock,
  type DisplayContent,
  type DisplayProfile,
  EventHub,
  type FrameMessage,
  frameLength,
  type HelloMessage,
  LineDecoder,
  LINK_LOSS_MS,
  parseDisplayMessage,
  PING_INTERVAL_MS,
  type Rotation,
  type Scene,
  secondsLeft,
  systemClock,
} from '@counterpay/core';
import type { Ack, DisplayDriver, DriverStatus } from './types';

/** An open USB serial port. The app implements it with `serialport`; tests use a fake. */
export interface SerialLink {
  write(data: string | Uint8Array): void;
  onData(handler: (chunk: Uint8Array) => void): void;
  onClose(handler: () => void): void;
  close(): Promise<void>;
}

export interface SerialPorts {
  /** The first USB serial board found (CH340, CP210x, FTDI, ESP32 native USB), or null. */
  detect(): Promise<string | null>;
  open(path: string): Promise<SerialLink>;
}

export interface FrameRequest {
  scene: Scene;
  content: DisplayContent | null;
  /** Panel size in the orientation it is mounted. */
  width: number;
  height: number;
  /** Which Ambient slide to draw. */
  slide: number;
  /** Draw the test pattern instead of the scene. */
  test?: boolean;
  now: number;
}

export interface RenderedFrame {
  /** 1 bpp, see core/frame.ts. */
  bits: Uint8Array;
  /** A data URL of the same pixels, for the live preview on Home. */
  preview: string;
}

/** Draws a scene at the panel's exact pixel size. The app renders the display page off-screen. */
export interface FrameRenderer {
  render(request: FrameRequest): Promise<RenderedFrame>;
}

export interface SerialFrameDriverOptions {
  id: string;
  /** The same driver serves USB boards and Wi-Fi displays; only how the link is found and opened differs. */
  kind?: 'serial-frame' | 'wifi-frame';
  /** A COM port, or `auto` to use the first USB serial board found. */
  port: string;
  profile: DisplayProfile;
  rotation: Rotation;
  ports: SerialPorts;
  renderer: FrameRenderer;
  clock?: Clock;
  helloTimeoutMs?: number;
  retryMs?: number;
}

interface Events extends Record<string, unknown> {
  status: DriverStatus;
  linkLost: undefined;
}

type LinkState = 'connecting' | 'connected' | 'waiting';

function bytesToText(chunk: Uint8Array): string {
  let text = '';
  for (const byte of chunk) text += String.fromCharCode(byte);
  return text;
}

/**
 * A frame-mode display: E-ink or any other panel on a board that shows PC-rendered pixels,
 * reached over USB serial (the frame-generic firmware) or Wi-Fi (an authenticated TCP link,
 * see net-display in core). The PC draws each scene; the board shows the pixels and enforces
 * the ttl and link-loss rules on its own.
 */
export class SerialFrameDriver implements DisplayDriver {
  readonly id: string;
  readonly kind: 'serial-frame' | 'wifi-frame';
  readonly profile: DisplayProfile;

  private readonly options: SerialFrameDriverOptions;
  private readonly clock: Clock;
  private readonly events = new EventHub<Events>();
  private readonly width: number;
  private readonly height: number;

  private running = false;
  private state: LinkState = 'waiting';
  private link: SerialLink | null = null;
  private portPath: string | null = null;
  private hello: HelloMessage | null = null;
  /** The board is there but its panel isn't drawing: a wiring or power fault the customer would see as a blank screen. */
  private panelSilent = false;
  /** Why the last attempt to open the link failed, when the link itself says so (a display that no longer knows this PC). */
  private refused: DriverStatus['detail'] = undefined;
  private helloWaiter: ((hello: HelloMessage | null) => void) | null = null;
  private scene: Scene | null = null;
  private content: DisplayContent | null = null;
  private slide = 0;
  private seq = 0;
  private sending: Promise<unknown> = Promise.resolve();
  private pendingAck: { seq: number; sentAt: number; resolve: (ack: Ack) => void; timer: unknown } | null = null;
  private lastAckMs: number | undefined;
  private preview: string | undefined;
  private linkLost = false;
  private timers: { ping: unknown; retry: unknown; loss: unknown; slide: unknown; test: unknown } = {
    ping: null,
    retry: null,
    loss: null,
    slide: null,
    test: null,
  };

  constructor(options: SerialFrameDriverOptions) {
    this.kind = options.kind ?? 'serial-frame';
    this.options = options;
    this.id = options.id;
    this.clock = options.clock ?? systemClock;
    this.profile = { ...options.profile, rotation: options.rotation };
    const portrait = options.rotation === 90 || options.rotation === 270;
    this.width = portrait ? options.profile.h : options.profile.w;
    this.height = portrait ? options.profile.w : options.profile.h;
  }

  async connect(): Promise<void> {
    this.running = true;
    void this.open();
  }

  async disconnect(): Promise<void> {
    this.running = false;
    for (const name of Object.keys(this.timers) as Array<keyof typeof this.timers>) this.clearTimer(name);
    this.settleAck({ ok: false, seq: this.pendingAck?.seq ?? 0, reason: 'offline' });
    const link = this.link;
    this.link = null;
    this.state = 'waiting';
    if (link) await link.close().catch(() => {});
    this.emitStatus();
  }

  async show(scene: Scene): Promise<Ack> {
    this.scene = scene;
    this.slide = 0;
    this.scheduleSlides();
    return this.sendScene(scene, false);
  }

  setContent(content: DisplayContent): void {
    this.content = content;
    this.scheduleSlides();
    // New wording or branding: redraw what's showing, unless a customer is looking at a QR.
    if (this.scene && this.scene.kind !== 'pay') void this.sendScene(this.scene, false);
  }

  testPattern(): void {
    if (!this.scene) return;
    void this.enqueue(() => this.transmit(this.scene!, { test: true }));
    this.clearTimer('test');
    this.timers.test = this.clock.setTimeout(() => {
      this.timers.test = null;
      if (this.scene) void this.sendScene(this.scene, false);
    }, 5_000);
  }

  status(): DriverStatus {
    const connected = this.state === 'connected';
    const status: DriverStatus = {
      id: this.id,
      kind: this.kind,
      state: connected ? 'connected' : 'waiting',
      clients: connected ? 1 : 0,
      previews: 0,
    };
    if (!connected) status.detail = this.linkLost ? 'linkLost' : 'noClients';
    if (!connected && this.refused) {
      status.state = 'offline';
      status.detail = this.refused;
    } else if (connected && this.panelSilent) {
      status.state = 'offline';
      status.detail = 'panelSilent';
    }
    if (this.hello) {
      status.fw = this.hello.fw;
      status.size = { w: this.hello.w, h: this.hello.h };
    }
    if (this.portPath) status.port = this.portPath;
    if (this.lastAckMs !== undefined) status.lastAckMs = this.lastAckMs;
    if (this.preview) status.preview = this.preview;
    return status;
  }

  onStatus(callback: (status: DriverStatus) => void): () => void {
    return this.events.on('status', callback);
  }

  onLinkLost(callback: () => void): () => void {
    return this.events.on('linkLost', callback);
  }

  // ---------- Link ----------

  private async open(): Promise<void> {
    if (!this.running || this.link) return;
    this.state = 'connecting';
    try {
      const path = this.options.port === 'auto' || !this.options.port ? await this.options.ports.detect() : this.options.port;
      if (!path) throw new Error('No USB display found');
      const link = await this.options.ports.open(path);
      if (!this.running) {
        await link.close();
        return;
      }
      this.link = link;
      this.portPath = path;
      const decoder = new LineDecoder(undefined, { skipNoise: true });
      link.onData((chunk) => {
        for (const value of decoder.push(bytesToText(chunk))) {
          const message = parseDisplayMessage(value);
          if (message) this.handle(message);
        }
      });
      link.onClose(() => this.lost(link));

      const hello = await this.waitForHello();
      if (!hello || this.link !== link) throw new Error('The board did not say hello. Is the Counter Pay firmware on it?');
      this.refused = undefined;
      this.connected();
    } catch (error) {
      this.refused = (error as { detail?: DriverStatus['detail'] } | null)?.detail;
      const link = this.link;
      this.link = null;
      if (link) await link.close().catch(() => {});
      this.state = 'waiting';
      this.emitStatus();
      this.retry();
    }
  }

  private waitForHello(): Promise<HelloMessage | null> {
    return new Promise((resolve) => {
      const timer = this.clock.setTimeout(() => {
        this.helloWaiter = null;
        resolve(null);
      }, this.options.helloTimeoutMs ?? 6_000);
      this.helloWaiter = (hello) => {
        this.clock.clearTimeout(timer);
        this.helloWaiter = null;
        resolve(hello);
      };
      // The firmware also says hello every 2 s until it hears from a PC; this gets an answer at once.
      this.link?.write(`${JSON.stringify({ v: 1, t: 'who' })}\n`);
    });
  }

  private connected(): void {
    this.state = 'connected';
    this.linkLost = false;
    this.clearTimer('loss');
    this.schedulePing();
    this.emitStatus();
    // The board keeps the last Ambient frame to fall back to, so it always gets one first.
    const ambient: Scene = { kind: 'ambient', id: 0, shownAt: this.clock.now(), reason: 'idle' };
    void this.enqueue(() => this.transmit(ambient, {}));
    if (this.scene && this.scene.kind !== 'ambient') void this.sendScene(this.scene, false);
  }

  private lost(link: SerialLink): void {
    if (this.link !== link) return;
    this.link = null;
    this.hello = null;
    this.state = 'waiting';
    this.clearTimer('ping');
    this.settleAck({ ok: false, seq: this.pendingAck?.seq ?? 0, reason: 'offline' });
    if (this.running && this.scene?.kind === 'pay') {
      this.clearTimer('loss');
      this.timers.loss = this.clock.setTimeout(() => {
        this.timers.loss = null;
        if (this.state !== 'connected') {
          this.linkLost = true;
          this.emitStatus();
          this.events.fire('linkLost', undefined);
        }
      }, LINK_LOSS_MS);
    }
    this.emitStatus();
    this.retry();
  }

  private retry(): void {
    if (!this.running || this.timers.retry) return;
    this.timers.retry = this.clock.setTimeout(() => {
      this.timers.retry = null;
      void this.open();
    }, this.options.retryMs ?? 3_000);
  }

  private handle(message: ReturnType<typeof parseDisplayMessage>): void {
    if (!message) return;
    switch (message.t) {
      case 'hello':
        this.hello = message;
        this.panelSilent = message.panel === 'silent';
        this.helloWaiter?.(message);
        this.emitStatus();
        break;
      case 'ack':
        if (this.pendingAck && message.seq === this.pendingAck.seq) {
          this.lastAckMs = this.clock.now() - this.pendingAck.sentAt;
          if (message.panel !== undefined) this.panelSilent = message.panel === 'silent';
          this.settleAck(
            this.panelSilent
              ? { ok: false, seq: message.seq, scene: message.scene, latencyMs: this.lastAckMs, reason: 'panelSilent' }
              : { ok: true, seq: message.seq, scene: message.scene, latencyMs: this.lastAckMs },
          );
          this.emitStatus();
        }
        break;
      case 'state':
        // The board fell back to Ambient by itself (ttl or link loss); the agent's timers cover both.
        break;
    }
  }

  // ---------- Frames ----------

  private sendScene(scene: Scene, partial: boolean): Promise<Ack> {
    return this.enqueue(() => this.transmit(scene, { partial }));
  }

  /** Header and pixels must go out back to back, so frames are sent one at a time. */
  private enqueue(job: () => Promise<Ack>): Promise<Ack> {
    const next = this.sending.then(job, job);
    this.sending = next.catch(() => {});
    return next;
  }

  private async transmit(scene: Scene, options: { partial?: boolean; test?: boolean }): Promise<Ack> {
    const frame = await this.options.renderer.render({
      scene,
      content: this.content,
      width: this.width,
      height: this.height,
      slide: this.slide,
      ...(options.test ? { test: true } : {}),
      now: this.clock.now(),
    });
    this.preview = frame.preview;
    this.emitStatus();

    const link = this.link;
    if (!link || this.state !== 'connected') return { ok: false, seq: this.seq, reason: 'offline' };

    const seq = ++this.seq;
    const header: FrameMessage = {
      v: 1,
      t: 'frame',
      seq,
      w: this.width,
      h: this.height,
      fmt: '1bpp',
      len: frameLength(this.width, this.height),
      // A pay QR always gets a full refresh so it scans first time; Ambient slides may refresh partially.
      refresh: options.partial && scene.kind === 'ambient' && !options.test ? 'partial' : 'full',
      scene: options.test ? 'thanks' : scene.kind,
      rot: this.options.rotation,
    };
    if (scene.kind === 'pay' && !options.test) header.ttl = Math.max(1, secondsLeft(scene, this.clock.now()));

    return new Promise<Ack>((resolve) => {
      const timeout = (this.profile.refresh?.fullMs ?? 2_000) + 5_000;
      const timer = this.clock.setTimeout(() => {
        if (this.pendingAck?.seq === seq) this.settleAck({ ok: false, seq, reason: 'timeout' });
      }, timeout);
      this.pendingAck = { seq, sentAt: this.clock.now(), resolve, timer };
      link.write(`${JSON.stringify(header)}\n`);
      link.write(frame.bits);
    });
  }

  private settleAck(ack: Ack): void {
    const pending = this.pendingAck;
    if (!pending) return;
    this.pendingAck = null;
    this.clock.clearTimeout(pending.timer);
    pending.resolve(ack);
  }

  /** Slow Ambient rotation for E-ink: the panel's own slide time, never faster than the config's. */
  private scheduleSlides(): void {
    this.clearTimer('slide');
    const items = this.content?.ambient.items.length ?? 0;
    if (!this.running || this.scene?.kind !== 'ambient' || items < 2) return;
    const seconds = Math.max(this.profile.slideSeconds ?? 0, this.content?.ambient.slideSeconds ?? 8);
    this.timers.slide = this.clock.setTimeout(() => {
      this.timers.slide = null;
      if (this.scene?.kind !== 'ambient') return;
      this.slide += 1;
      void this.sendScene(this.scene, true);
      this.scheduleSlides();
    }, seconds * 1000);
  }

  private schedulePing(): void {
    this.clearTimer('ping');
    if (!this.running || this.state !== 'connected') return;
    this.timers.ping = this.clock.setTimeout(() => {
      this.timers.ping = null;
      this.link?.write(`${JSON.stringify({ v: 1, t: 'ping', seq: ++this.seq })}\n`);
      this.schedulePing();
    }, PING_INTERVAL_MS);
  }

  private clearTimer(name: keyof typeof this.timers): void {
    if (this.timers[name] !== null) {
      this.clock.clearTimeout(this.timers[name]);
      this.timers[name] = null;
    }
  }

  private emitStatus(): void {
    this.events.fire('status', this.status());
  }
}
