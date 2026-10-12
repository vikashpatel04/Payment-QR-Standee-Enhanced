import { describe, expect, it } from 'vitest';
import { clockMinutes, inQuietHours, isQuietMoment } from '../src/updates';

const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m);

describe('clockMinutes', () => {
  it('reads HH:MM', () => {
    expect(clockMinutes('00:00')).toBe(0);
    expect(clockMinutes('22:30')).toBe(1350);
    expect(clockMinutes('24:00')).toBeNull();
    expect(clockMinutes('7:00')).toBeNull();
  });
});

describe('inQuietHours', () => {
  it('handles a window that runs past midnight (spec default 10 pm–8 am)', () => {
    const night: [string, string] = ['22:00', '08:00'];
    expect(inQuietHours(at(21, 59), night)).toBe(false);
    expect(inQuietHours(at(22, 0), night)).toBe(true);
    expect(inQuietHours(at(3, 0), night)).toBe(true);
    expect(inQuietHours(at(7, 59), night)).toBe(true);
    expect(inQuietHours(at(8, 0), night)).toBe(false);
    expect(inQuietHours(at(14, 0), night)).toBe(false);
  });

  it('handles a window inside one day', () => {
    expect(inQuietHours(at(14, 30), ['14:00', '15:00'])).toBe(true);
    expect(inQuietHours(at(15, 0), ['14:00', '15:00'])).toBe(false);
  });

  it('treats equal or broken times as never', () => {
    expect(inQuietHours(at(3), ['08:00', '08:00'])).toBe(false);
    expect(inQuietHours(at(3), ['late', '08:00'])).toBe(false);
  });
});

describe('isQuietMoment', () => {
  const quietHours: [string, string] = ['22:00', '08:00'];

  it('installs at night with nothing going on', () => {
    expect(isQuietMoment({ now: at(23), scene: 'ambient', lastPopupAt: null, quietHours })).toBe(true);
  });

  it('never while a QR is showing', () => {
    expect(isQuietMoment({ now: at(23), scene: 'pay', lastPopupAt: null, quietHours })).toBe(false);
  });

  it('waits 10 minutes after the popup was used', () => {
    const now = at(23);
    expect(isQuietMoment({ now, scene: 'ambient', lastPopupAt: now.getTime() - 9 * 60_000, quietHours })).toBe(false);
    expect(isQuietMoment({ now, scene: 'thanks', lastPopupAt: now.getTime() - 10 * 60_000, quietHours })).toBe(true);
  });

  it('never during opening hours', () => {
    expect(isQuietMoment({ now: at(12), scene: 'ambient', lastPopupAt: null, quietHours })).toBe(false);
  });
});
