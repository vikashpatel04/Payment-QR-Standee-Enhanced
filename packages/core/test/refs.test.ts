import { describe, expect, it } from 'vitest';
import { advanceRef, localDay, nextRef } from '../src/refs';

describe('nextRef', () => {
  it('builds prefix + yyMMdd + 4-digit counter (spec test vector)', () => {
    expect(nextRef('2026-10-12', 42, 'DT')).toBe('DT2610120042');
  });

  it('uses the CP prefix by default', () => {
    expect(nextRef('2026-10-12', 1)).toBe('CP2610120001');
  });

  it('grows past 9999 instead of wrapping', () => {
    expect(nextRef('2026-10-12', 12345)).toBe('CP26101212345');
  });

  it('accepts a Date in local time', () => {
    expect(nextRef(new Date(2026, 0, 5, 23, 59), 7)).toBe('CP2601050007');
  });

  it('rejects bad input', () => {
    expect(() => nextRef('12/10/2026', 1)).toThrow(RangeError);
    expect(() => nextRef('2026-10-12', 0)).toThrow(RangeError);
    expect(() => nextRef('2026-10-12', 1, 'cp-')).toThrow(RangeError);
  });
});

describe('advanceRef', () => {
  const morning = new Date(2026, 9, 12, 9, 0);
  const evening = new Date(2026, 9, 12, 21, 0);
  const nextDay = new Date(2026, 9, 13, 9, 0);

  it('starts at 1 with no saved state', () => {
    expect(advanceRef(undefined, morning)).toEqual({
      state: { day: '2026-10-12', count: 1 },
      ref: 'CP2610120001',
    });
  });

  it('counts up through the day', () => {
    const first = advanceRef(undefined, morning);
    const second = advanceRef(first.state, evening);
    expect(second.ref).toBe('CP2610120002');
  });

  it('resets on a new day', () => {
    expect(advanceRef({ day: '2026-10-12', count: 41 }, nextDay).ref).toBe('CP2610130001');
  });

  it('formats the local day', () => {
    expect(localDay(new Date(2026, 9, 2))).toBe('2026-10-02');
  });
});
