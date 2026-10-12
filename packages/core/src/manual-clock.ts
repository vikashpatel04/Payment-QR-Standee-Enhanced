import type { Clock } from './state';

/** A clock moved by hand, for tests of anything with timers (scenes, drivers, links). */
export class ManualClock implements Clock {
  private timers = new Map<number, { at: number; callback: () => void }>();
  private nextHandle = 1;

  constructor(public time = 1_000_000) {}

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.time + ms, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Timers still waiting to fire. */
  get pending(): number {
    return this.timers.size;
  }

  /** Moves time forward, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.timers) if (entry[1].at <= until && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = next[1].at;
      next[1].callback();
    }
    this.time = until;
  }
}
