import { type DisplayConfig, type DisplayContent, EventHub, type Scene } from '@counterpay/core';
import { type Ack, createDriver, type DisplayDriver, type DisplayLink, type DriverDeps, type DriverStatus } from '@counterpay/drivers';
import type { DisplayReach } from '../shared/api';

interface Entry {
  config: DisplayConfig;
  driver: DisplayDriver;
  unsubscribe: Array<() => void>;
}

export interface ShowOutcome {
  /** Real displays that acknowledged the scene. */
  acked: string[];
  reach: DisplayReach;
}

interface Events extends Record<string, unknown> {
  change: undefined;
  linkLost: string;
}

/**
 * Owns one driver per enabled display. Every scene goes to all of them at once;
 * a display that (re)connects later gets the current scene replayed by its driver.
 */
export class DisplayManager {
  private readonly entries = new Map<string, Entry>();
  private readonly events = new EventHub<Events>();
  private content: DisplayContent | null = null;
  private scene: Scene | null = null;

  constructor(private readonly deps: DriverDeps) {}

  /** Brings the running drivers in line with the config: adds, removes and restarts as needed. */
  async sync(configs: DisplayConfig[]): Promise<void> {
    const wanted = new Map(configs.filter((c) => c.enabled).map((c) => [c.id, c]));

    for (const [id, entry] of [...this.entries]) {
      const next = wanted.get(id);
      if (!next || JSON.stringify(next) !== JSON.stringify(entry.config)) {
        this.entries.delete(id);
        entry.unsubscribe.forEach((u) => u());
        await entry.driver.disconnect().catch((error) => console.error(`[displays] ${id} disconnect failed`, error));
      }
    }

    for (const [id, config] of wanted) {
      if (this.entries.has(id)) continue;
      const driver = createDriver(config, this.deps);
      const entry: Entry = {
        config,
        driver,
        unsubscribe: [
          driver.onStatus(() => this.events.fire('change', undefined)),
          driver.onLinkLost(() => this.events.fire('linkLost', id)),
        ],
      };
      this.entries.set(id, entry);
      if (this.content) driver.setContent(this.content);
      if (this.scene) void driver.show(this.scene);
      await driver.connect().catch((error) => console.error(`[displays] ${id} connect failed`, error));
    }
    this.events.fire('change', undefined);
  }

  async show(scene: Scene): Promise<ShowOutcome> {
    this.scene = scene;
    const results = await Promise.all(
      [...this.entries.values()].map(async ({ config, driver }) => {
        const ack: Ack = await driver.show(scene).catch(() => ({ ok: false, seq: 0, reason: 'offline' as const }));
        return { id: config.id, simulator: driver.kind === 'simulator', ack };
      }),
    );
    const real = results.filter((r) => !r.simulator);
    const acked = real.filter((r) => r.ack.ok).map((r) => r.id);
    return { acked, reach: acked.length ? 'online' : real.length ? 'offline' : 'simulatorOnly' };
  }

  setContent(content: DisplayContent): void {
    this.content = content;
    for (const { driver } of this.entries.values()) driver.setContent(content);
  }

  testPattern(id: string): void {
    this.entries.get(id)?.driver.testPattern?.();
  }

  /** Hands a connected page or device to its display's driver. */
  attach(id: string, link: DisplayLink): boolean {
    const driver = this.entries.get(id)?.driver;
    if (!driver?.attach) return false;
    driver.attach(link);
    return true;
  }

  kindOf(id: string): DisplayDriver['kind'] | null {
    return this.entries.get(id)?.driver.kind ?? null;
  }

  status(id: string): DriverStatus | null {
    return this.entries.get(id)?.driver.status() ?? null;
  }

  /** Before sending: can a customer see anything? */
  reach(): DisplayReach {
    const real = [...this.entries.values()].filter((e) => e.driver.kind !== 'simulator');
    if (real.some((e) => e.driver.status().state === 'connected')) return 'online';
    return real.length ? 'offline' : 'simulatorOnly';
  }

  /** Displays that are showing scenes now, for the History "displays" column. */
  showingIds(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.driver.kind === 'simulator' || e.driver.status().state === 'connected')
      .map((e) => e.config.id);
  }

  anyRealConnected(): boolean {
    return [...this.entries.values()].some((e) => e.driver.kind !== 'simulator' && e.driver.status().state === 'connected');
  }

  onChange(callback: () => void): () => void {
    return this.events.on('change', callback);
  }

  onLinkLost(callback: (id: string) => void): () => void {
    return this.events.on('linkLost', callback);
  }

  async dispose(): Promise<void> {
    await this.sync([]);
  }
}
