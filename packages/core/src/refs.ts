/**
 * Every QR carries a unique `tr`: a prefix, the date as yyMMdd and a daily counter
 * of at least four digits. `nextRef("2026-10-12", 42, "DT")` is `DT2610120042`.
 */

export const DEFAULT_REF_PREFIX = 'CP';

const PREFIX_PATTERN = /^[A-Z0-9]{1,6}$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidRefPrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

/** The calendar day of `date` in local time, as `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nextRef(day: string | Date, counter: number, prefix: string = DEFAULT_REF_PREFIX): string {
  const dayText = typeof day === 'string' ? day : localDay(day);
  const match = DAY_PATTERN.exec(dayText);
  if (!match) throw new RangeError(`Expected a YYYY-MM-DD day, got "${dayText}"`);
  if (!Number.isInteger(counter) || counter < 1) throw new RangeError(`Counter must be 1 or more, got ${counter}`);
  if (!isValidRefPrefix(prefix)) throw new RangeError(`Reference prefix must be 1-6 capital letters or digits, got "${prefix}"`);
  const [, y, m, d] = match;
  return `${prefix}${y!.slice(2)}${m}${d}${String(counter).padStart(4, '0')}`;
}

/** Persisted between runs so references stay unique across restarts. */
export interface RefCounterState {
  day: string;
  count: number;
}

/** Moves the counter on by one, restarting at 1 on a new day. */
export function advanceRef(
  state: RefCounterState | undefined,
  now: Date,
  prefix: string = DEFAULT_REF_PREFIX,
): { state: RefCounterState; ref: string } {
  const day = localDay(now);
  const count = state && state.day === day ? state.count + 1 : 1;
  return { state: { day, count }, ref: nextRef(day, count, prefix) };
}
