import {
  type Clock,
  contentToMessages,
  type DisplayContent,
  type DisplayMessage,
  type DisplayProfile,
  type DriverKind,
  EventHub,
  type HelloMessage,
  LINK_LOSS_MS,
  type PcMessage,
  PING_INTERVAL_MS,
  type Scene,
  sceneToMessage,
  systemClock,
} from '@counterpay/core';
import type { Ack, DisplayDriver, DisplayLink, DriverStatus } from './types';

export interface LinkedDriverOptions {
  id: string;
  kind: DriverKind;
  profile: DisplayProfile;
  /** Web transports carry the full UPI link; smart devices build it from their own payee. */
  includeUri: boolean;
  clock?: Clock;
  /** How long `show` waits for the first device ack. */
  ackTimeoutMs?: number;
}

interface PendingAck {
  sentAt: number;
  resolve: (ack: Ack) => void;
  timer: unknown;
}

interface Events extends Record<string, unknown> {
  status: DriverStatus;
  linkLost: undefined;
}

/**
 * Shared behaviour for every driver that talks the line protocol over one or more
 * links: sequence numbers, acks with a timeout, pings, replaying the current scene to
 * a device that (re)connects, and the 10-second link-loss rule.
 */
export abstract class LinkedDriver implements DisplayDriver {
  readonly id: string;
  readonly kind: DriverKind;
  readonly profile: DisplayProfile;

  protected readonly clock: Clock;
  protected readonly links = new Set<DisplayLink>();
  protected hello: HelloMessage | null = null;
  protected scene: Scene | null = null;
  protected content: DisplayContent | null = null;

  private readonly events = new EventHub<Events>();
  private readonly includeUri: boolean;
  private readonly ackTimeoutMs: number;
  private seq = 0;
  private pending = new Map<number, PendingAck>();
  private pingTimer: unknown = null;
  private lossTimer: unknown = null;
  private lastAckMs: number | undefined;
  private linkLost = false;
  private running = false;

  constructor(options: LinkedDriverOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.profile = options.profile;
    this.includeUri = options.includeUri;
    this.clock = options.clock ?? systemClock;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 1500;
  }

  async connect(): Promise<void> {
    this.running = true;
    this.schedulePing();
  }

  async disconnect(): Promise<void> {
    this.running = false;
    this.clearTimer('pingTimer');
    this.clearTimer('lossTimer');
    for (const link of [...this.links]) link.close();
    this.links.clear();
    for (const [seq, pending] of this.pending) this.settle(seq, pending, { ok: false, seq, reason: 'offline' });
    this.emitStatus();
  }

  attach(link: DisplayLink): void {
    this.links.add(link);
    link.onMessage((message) => this.handleMessage(link, message));
    link.onClose(() => this.detach(link));

    if (this.content) for (const message of contentToMessages(this.content)) link.send(message);
    if (this.scene) link.send(sceneToMessage(this.scene, this.nextSeq(), this.clock.now(), { includeUri: this.includeUri }));

    if (link.role === 'display') {
      this.clearTimer('lossTimer');
      this.linkLost = false;
    }
    this.emitStatus();
  }

  async show(scene: Scene): Promise<Ack> {
    this.scene = scene;
    const seq = this.nextSeq();
    const message = sceneToMessage(scene, seq, this.clock.now(), { includeUri: this.includeUri });
    this.broadcast(message);

    for (const [oldSeq, pending] of this.pending) this.settle(oldSeq, pending, { ok: false, seq: oldSeq, reason: 'superseded' });
    if (this.displayLinkCount() === 0) return { ok: false, seq, reason: 'offline' };

    return new Promise<Ack>((resolve) => {
      const timer = this.clock.setTimeout(() => {
        const pending = this.pending.get(seq);
        if (pending) this.settle(seq, pending, { ok: false, seq, reason: 'timeout' });
      }, this.ackTimeoutMs);
      this.pending.set(seq, { sentAt: this.clock.now(), resolve, timer });
    });
  }

  setContent(content: DisplayContent): void {
    this.content = content;
    for (const message of contentToMessages(content)) this.broadcast(message);
  }

  testPattern(): void {
    this.broadcast({ v: 1, t: 'test', seq: this.nextSeq(), seconds: 5 });
  }

  status(): DriverStatus {
    const clients = this.displayLinkCount();
    const status: DriverStatus = {
      id: this.id,
      kind: this.kind,
      state: clients > 0 ? 'connected' : 'waiting',
      clients,
      previews: this.links.size - clients,
    };
    if (clients === 0) status.detail = this.linkLost ? 'linkLost' : 'noClients';
    if (this.hello) {
      status.fw = this.hello.fw;
      status.size = { w: this.hello.w, h: this.hello.h };
      if (this.hello.vpa) status.vpa = this.hello.vpa;
    }
    if (this.lastAckMs !== undefined) status.lastAckMs = this.lastAckMs;
    return status;
  }

  onStatus(callback: (status: DriverStatus) => void): () => void {
    return this.events.on('status', callback);
  }

  onLinkLost(callback: () => void): () => void {
    return this.events.on('linkLost', callback);
  }

  protected broadcast(message: PcMessage): void {
    for (const link of this.links) link.send(message);
  }

  protected nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  protected displayLinkCount(): number {
    let count = 0;
    for (const link of this.links) if (link.role === 'display') count += 1;
    return count;
  }

  protected emitStatus(): void {
    this.events.fire('status', this.status());
  }

  private handleMessage(link: DisplayLink, message: DisplayMessage): void {
    if (link.role !== 'display') return;
    switch (message.t) {
      case 'hello':
        this.hello = message;
        this.emitStatus();
        break;
      case 'ack': {
        const pending = this.pending.get(message.seq);
        if (pending) {
          this.lastAckMs = this.clock.now() - pending.sentAt;
          this.settle(message.seq, pending, { ok: true, seq: message.seq, scene: message.scene, latencyMs: this.lastAckMs });
          this.emitStatus();
        }
        break;
      }
      case 'state':
        // The device fell back to Ambient by itself (ttl or link loss on its side). The agent's
        // own timers already cover both, so this is informational.
        break;
    }
  }

  private detach(link: DisplayLink): void {
    if (!this.links.delete(link)) return;
    if (link.role === 'display' && this.displayLinkCount() === 0) {
      this.hello = null;
      if (this.running && this.scene?.kind === 'pay') {
        this.clearTimer('lossTimer');
        this.lossTimer = this.clock.setTimeout(() => {
          this.lossTimer = null;
          if (this.displayLinkCount() === 0) {
            this.linkLost = true;
            this.emitStatus();
            this.events.fire('linkLost', undefined);
          }
        }, LINK_LOSS_MS);
      }
    }
    this.emitStatus();
  }

  private settle(seq: number, pending: PendingAck, ack: Ack): void {
    this.clock.clearTimeout(pending.timer);
    this.pending.delete(seq);
    pending.resolve(ack);
  }

  private schedulePing(): void {
    this.clearTimer('pingTimer');
    if (!this.running) return;
    this.pingTimer = this.clock.setTimeout(() => {
      this.pingTimer = null;
      this.broadcast({ v: 1, t: 'ping', seq: this.nextSeq() });
      this.schedulePing();
    }, PING_INTERVAL_MS);
  }

  private clearTimer(name: 'pingTimer' | 'lossTimer'): void {
    if (this[name] !== null) {
      this.clock.clearTimeout(this[name]);
      this[name] = null;
    }
  }
}
