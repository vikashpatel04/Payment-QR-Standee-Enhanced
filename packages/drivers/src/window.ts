import { type Clock, getProfile, type Rotation } from '@counterpay/core';
import { LinkedDriver } from './linked-driver';
import type { DriverStatus } from './types';

/**
 * What the Window driver needs from the app shell. The agent implements it with
 * Electron; keeping it abstract lets the driver run in tests and on other shells.
 */
export interface WindowHost {
  /**
   * Opens (or moves) a full-screen, frameless window on `monitor` that loads the
   * display page for `displayId`. The page connects back and is attached as a link.
   * Returns false when that monitor isn't plugged in.
   */
  open(request: { displayId: string; monitor: number; rotation: Rotation }): boolean;
  close(displayId: string): void;
  /** Called when monitors are added or removed. */
  onMonitorsChanged(callback: () => void): () => void;
}

export interface WindowDriverOptions {
  id: string;
  monitor: number;
  rotation: Rotation;
  host: WindowHost;
  clock?: Clock;
}

/** Any monitor on the PC: HDMI, USB-C or a small HDMI LCD, showing scenes full screen. */
export class WindowDriver extends LinkedDriver {
  private readonly host: WindowHost;
  private readonly monitor: number;
  private readonly rotation: Rotation;
  private monitorMissing = false;
  private stopWatching: (() => void) | null = null;

  constructor(options: WindowDriverOptions) {
    super({
      id: options.id,
      kind: 'window',
      profile: { ...getProfile('browser'), rotation: options.rotation },
      includeUri: true,
      ...(options.clock ? { clock: options.clock } : {}),
    });
    this.host = options.host;
    this.monitor = options.monitor;
    this.rotation = options.rotation;
  }

  override async connect(): Promise<void> {
    await super.connect();
    this.openWindow();
    this.stopWatching = this.host.onMonitorsChanged(() => this.openWindow());
  }

  override async disconnect(): Promise<void> {
    this.stopWatching?.();
    this.stopWatching = null;
    this.host.close(this.id);
    await super.disconnect();
  }

  override status(): DriverStatus {
    const status = super.status();
    if (this.monitorMissing && status.clients === 0) return { ...status, state: 'offline', detail: 'monitorMissing' };
    return status;
  }

  private openWindow(): void {
    const missing = !this.host.open({ displayId: this.id, monitor: this.monitor, rotation: this.rotation });
    if (missing !== this.monitorMissing) {
      this.monitorMissing = missing;
      this.emitStatus();
    }
  }
}
