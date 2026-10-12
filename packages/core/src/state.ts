import { Emitter } from './emitter';
import type { AmbientReason, PayScene, Scene } from './scenes';

/** How a Pay scene ended. Recorded in History. */
export type EndReason = 'cleared' | 'replaced' | 'expired' | 'link-lost' | 'bill-saved';

/** What asked for the QR. Recorded in History. */
export type PaySource = 'popup' | 'api' | 'cli' | 'watcher';

export type ClearThen = 'thanks' | 'ambient';

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

// Timers exist in every runtime Counter Pay targets; declared here so core needs neither DOM nor Node types.
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export interface PayStarted {
  scene: PayScene;
  source: PaySource;
}

export interface PayEnded {
  scene: PayScene;
  reason: EndReason;
  endedAt: number;
}

export interface SceneMachineEvents extends Record<string, unknown> {
  scene: Scene;
  payStarted: PayStarted;
  payEnded: PayEnded;
}

export interface SceneMachineOptions {
  clock?: Clock;
  /** Allocates the next reference and builds the UPI link for an amount. Called once per QR. */
  preparePay(amountPaise: number): { ref: string; uri: string };
  ttlSeconds(): number;
  thanksSeconds(): number;
}

/**
 * The scene state machine. Every Pay scene ends by exactly one of: Clear, a new
 * amount, its ttl, link loss or (Phase 4) bill saved. No path leaves a QR showing.
 */
export class SceneMachine extends Emitter<SceneMachineEvents> {
  private readonly clock: Clock;
  private scene: Scene;
  private nextId = 1;
  private timer: unknown = null;

  constructor(private readonly options: SceneMachineOptions) {
    super();
    this.clock = options.clock ?? systemClock;
    this.scene = { kind: 'ambient', id: this.nextId++, shownAt: this.clock.now(), reason: 'idle' };
  }

  get current(): Scene {
    return this.scene;
  }

  get pay(): PayScene | null {
    return this.scene.kind === 'pay' ? this.scene : null;
  }

  /** Shows a pay QR. A QR already showing is replaced in place. */
  showAmount(amountPaise: number, source: PaySource, ttlSeconds?: number): PayScene {
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
      throw new RangeError(`Amount must be positive integer paise, got ${amountPaise}`);
    }
    const { ref, uri } = this.options.preparePay(amountPaise);
    const now = this.clock.now();
    this.endPay('replaced', now);

    const ttl = Math.max(1, ttlSeconds ?? this.options.ttlSeconds());
    const scene: PayScene = {
      kind: 'pay',
      id: this.nextId++,
      shownAt: now,
      expiresAt: now + ttl * 1000,
      amountPaise,
      ref,
      uri,
    };
    this.setScene(scene);
    this.schedule(ttl * 1000, () => this.endTo('expired', 'ambient'));
    this.emit('payStarted', { scene, source });
    return scene;
  }

  /**
   * Ends the pay QR and shows Thanks (or goes straight to Ambient).
   * Returns false when there was nothing to clear.
   */
  clear(then: ClearThen = 'thanks'): boolean {
    if (this.scene.kind === 'pay') {
      this.endTo('cleared', then);
      return true;
    }
    if (this.scene.kind === 'thanks' && then === 'ambient') {
      this.toAmbient('cleared');
      return true;
    }
    return false;
  }

  /** Phase 4: the point-of-sale saved the bill. Only matters while a QR is showing. */
  billSaved(): boolean {
    if (this.scene.kind !== 'pay') return false;
    this.endTo('bill-saved', 'thanks');
    return true;
  }

  /** Every display showing the QR lost its link. The displays have already fallen back to Ambient. */
  linkLost(): boolean {
    if (this.scene.kind !== 'pay') return false;
    this.endTo('link-lost', 'ambient');
    return true;
  }

  dispose(): void {
    this.cancelTimer();
    this.removeAllListeners();
  }

  private endTo(reason: EndReason, then: ClearThen): void {
    const now = this.clock.now();
    this.endPay(reason, now);
    const thanksMs = this.options.thanksSeconds() * 1000;
    if (then === 'thanks' && thanksMs > 0) {
      this.setScene({ kind: 'thanks', id: this.nextId++, shownAt: now, endsAt: now + thanksMs });
      this.schedule(thanksMs, () => this.toAmbient('thanks-done'));
    } else {
      this.toAmbient(ambientReasonFor(reason));
    }
  }

  private endPay(reason: EndReason, now: number): void {
    if (this.scene.kind !== 'pay') return;
    const scene = this.scene;
    this.cancelTimer();
    this.emit('payEnded', { scene, reason, endedAt: now });
  }

  private toAmbient(reason: AmbientReason): void {
    this.cancelTimer();
    this.setScene({ kind: 'ambient', id: this.nextId++, shownAt: this.clock.now(), reason });
  }

  private setScene(scene: Scene): void {
    this.scene = scene;
    this.emit('scene', scene);
  }

  private schedule(ms: number, callback: () => void): void {
    this.cancelTimer();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      callback();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function ambientReasonFor(reason: EndReason): AmbientReason {
  switch (reason) {
    case 'expired':
      return 'expired';
    case 'link-lost':
      return 'link-lost';
    default:
      return 'cleared';
  }
}
