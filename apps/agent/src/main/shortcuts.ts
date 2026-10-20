import { sameAccelerator, shortcutWarning } from '@counterpay/core';
import { globalShortcut } from 'electron';
import type { ShortcutState } from '../shared/api';

export interface ShortcutHandlers {
  summon(): void;
  clear(): void;
  /** The next standby slide, when slides change with a key. */
  next(): void;
}

type Name = keyof ShortcutHandlers;

/**
 * The global shortcuts. They work from anywhere, including while the billing software has focus.
 * Windows can refuse a key (F12 is reserved for debuggers); that is reported, not hidden.
 */
export class Shortcuts {
  private wanted: Record<Name, string> = { summon: '', clear: '', next: '' };
  private registered: Record<Name, boolean> = { summon: false, clear: false, next: false };
  private paused = false;
  private suspended = false;

  constructor(private readonly handlers: ShortcutHandlers) {}

  apply(accelerators: Record<Name, string>): void {
    this.wanted = { ...accelerators };
    this.refresh();
  }

  /** "Pause shortcuts" in the tray. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.refresh();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** While Settings records a new shortcut. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.refresh();
  }

  state(): { summon: ShortcutState; clear: ShortcutState; next: ShortcutState; paused: boolean } {
    const one = (name: Name): ShortcutState => ({
      accelerator: this.wanted[name],
      registered: this.registered[name],
      warning: this.wanted[name] ? shortcutWarning(this.wanted[name]) : 'needsKey',
    });
    return { summon: one('summon'), clear: one('clear'), next: one('next'), paused: this.paused };
  }

  dispose(): void {
    this.unregister();
  }

  private refresh(): void {
    this.unregister();
    if (this.paused || this.suspended) return;
    for (const name of ['summon', 'clear', 'next'] as const) {
      const accelerator = this.wanted[name];
      if (!accelerator) continue;
      if (name === 'clear' && sameAccelerator(accelerator, this.wanted.summon)) continue;
      if (name === 'next' && (sameAccelerator(accelerator, this.wanted.summon) || sameAccelerator(accelerator, this.wanted.clear))) continue;
      try {
        this.registered[name] = globalShortcut.register(accelerator, () => this.handlers[name]());
      } catch {
        // Electron throws on accelerators it can't parse.
        this.registered[name] = false;
      }
      if (!this.registered[name]) console.warn(`[shortcuts] Windows refused ${name} shortcut "${accelerator}"`);
    }
  }

  private unregister(): void {
    for (const name of ['summon', 'clear', 'next'] as const) {
      if (this.registered[name]) {
        try {
          globalShortcut.unregister(this.wanted[name]);
        } catch {
          // Already gone.
        }
      }
      this.registered[name] = false;
    }
  }
}
