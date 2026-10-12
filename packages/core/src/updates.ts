import type { SceneKind } from './scenes';

/**
 * Updates never interrupt billing. A downloaded update installs on quit, or by itself
 * at a quiet moment: inside the shop's quiet hours, with no QR showing and the popup
 * unused for a while.
 */

export const POPUP_IDLE_BEFORE_UPDATE_MS = 10 * 60_000;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `"22:30"` → minutes after midnight, or null when malformed. */
export function clockMinutes(hhmm: string): number | null {
  const match = CLOCK.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Quiet hours may run past midnight (`["22:00", "08:00"]`). Equal start and end means never. */
export function inQuietHours(now: Date, [start, end]: readonly [string, string]): boolean {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null || from === to) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export interface QuietMomentInput {
  now: Date;
  scene: SceneKind;
  /** When the popup was last opened, or null if never this run. */
  lastPopupAt: number | null;
  quietHours: readonly [string, string];
}

export function isQuietMoment({ now, scene, lastPopupAt, quietHours }: QuietMomentInput): boolean {
  if (scene === 'pay') return false;
  if (lastPopupAt !== null && now.getTime() - lastPopupAt < POPUP_IDLE_BEFORE_UPDATE_MS) return false;
  return inQuietHours(now, quietHours);
}
