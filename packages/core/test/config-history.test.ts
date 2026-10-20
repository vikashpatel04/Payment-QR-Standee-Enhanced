import { describe, expect, it } from 'vitest';
import { defaultConfig, isPayeeConfigured, normalizeConfig } from '../src/config';
import { type CsvLabels, dailyTotals, historyToCsv, type QrEvent } from '../src/history';
import { isPortrait, pixelsPerModule } from '../src/profiles';

const secrets = { token: () => 'token-123', pairingCode: () => '482913' };

describe('normalizeConfig', () => {
  it('fills a missing config with defaults', () => {
    expect(normalizeConfig(undefined, secrets)).toEqual(defaultConfig(secrets));
  });

  it('keeps the spec defaults', () => {
    const config = defaultConfig(secrets);
    expect(config.shortcuts).toEqual({ summon: 'F9', clear: 'Shift+F9', next: '' });
    expect(config.ambient.advance).toBe('auto');
    expect(config.pay).toEqual({ ttlSeconds: 180, maxRupees: 100000, refPrefix: 'CP' });
    expect(config.thanks.seconds).toBe(10);
    expect(config.ambient.slideSeconds).toBe(8);
    expect(config.language.display).toEqual(['en']);
    expect(config.server).toEqual({ localPort: 5178, lanPort: 5179 });
    expect(config.history.retentionDays).toBe(365);
    expect(config.api).toEqual({ enabled: false, token: 'token-123' });
  });

  it('clamps numbers and repairs bad values', () => {
    const config = normalizeConfig(
      {
        pay: { ttlSeconds: 5, maxRupees: -3, refPrefix: 'bad prefix' },
        brand: { accent: 'red' },
        updates: { channel: 'nightly', quietHours: ['25:00', '08:00'] },
        displays: [{ id: 'x', driver: 'hologram', enabled: true }],
        ambient: { items: [{ k: 'text' }, { k: 'logo' }] },
      },
      secrets,
    );
    expect(config.pay).toEqual({ ttlSeconds: 30, maxRupees: 1, refPrefix: 'CP' });
    expect(config.brand.accent).toBe('#14B37D');
    expect(config.updates).toEqual({ channel: 'stable', quietHours: ['22:00', '08:00'] });
    expect(config.displays.map((d) => d.id)).toEqual(['sim']);
    expect(config.ambient.items).toEqual([{ k: 'logo' }]);
  });

  it('keeps valid displays and always keeps a simulator', () => {
    const config = normalizeConfig(
      { displays: [{ id: 'monitor-2', driver: 'window', monitor: 2, rotation: 90, enabled: true }] },
      secrets,
    );
    expect(config.displays).toEqual([
      { id: 'sim', driver: 'simulator', enabled: true, name: 'Simulator' },
      { id: 'monitor-2', driver: 'window', monitor: 2, rotation: 90, enabled: true },
    ]);
  });

  it('keeps ports in range and never lets the two servers share one', () => {
    expect(normalizeConfig({ server: { localPort: 80, lanPort: 99999 } }, secrets).server).toEqual({
      localPort: 1024,
      lanPort: 65535,
    });
    expect(normalizeConfig({ server: { localPort: 6000, lanPort: 6000 } }, secrets).server).toEqual({
      localPort: 6000,
      lanPort: 6001,
    });
  });

  it('upper-cases the reference prefix', () => {
    expect(normalizeConfig({ pay: { refPrefix: 'dt' } }, secrets).pay.refPrefix).toBe('DT');
  });
});

describe('isPayeeConfigured', () => {
  it('needs a UPI link with a payee', () => {
    expect(isPayeeConfigured({ upi: { baseUri: '', payeeLabel: '', addMam: false } })).toBe(false);
    expect(isPayeeConfigured({ upi: { baseUri: 'upi://pay?pn=X', payeeLabel: '', addMam: false } })).toBe(false);
    expect(isPayeeConfigured({ upi: { baseUri: 'upi://pay?pa=shop@okaxis', payeeLabel: '', addMam: false } })).toBe(
      true,
    );
  });
});

const labels: CsvLabels = {
  headers: {
    date: 'Date',
    time: 'Time',
    ref: 'Reference',
    amount: 'Amount (₹)',
    displays: 'Displays',
    ended: 'Ended by',
    duration: 'Shown for (s)',
    source: 'Source',
    note: 'Note',
  },
  reasons: {
    cleared: 'Cleared',
    replaced: 'Replaced',
    expired: 'Expired',
    'link-lost': 'Link lost',
    'bill-saved': 'Bill saved',
    open: 'Showing',
  },
  sources: { popup: 'Popup', api: 'API', cli: 'CLI', watcher: 'Watcher' },
};

const utc = {
  date: (ms: number) => new Date(ms).toISOString().slice(0, 10),
  time: (ms: number) => new Date(ms).toISOString().slice(11, 19),
};

const events: QrEvent[] = [
  {
    id: 1,
    ref: 'CP2610120001',
    amountPaise: 114000,
    shownAt: Date.UTC(2026, 9, 12, 6, 30, 0),
    endedAt: Date.UTC(2026, 9, 12, 6, 30, 42),
    endReason: 'cleared',
    displays: ['sim', 'phone'],
    source: 'popup',
    note: null,
  },
  {
    id: 2,
    ref: 'CP2610120002',
    amountPaise: 5050,
    shownAt: Date.UTC(2026, 9, 12, 7, 0, 0),
    endedAt: null,
    endReason: null,
    displays: ['sim'],
    source: 'api',
    note: '=HYPERLINK("x"), "quoted"',
  },
];

describe('historyToCsv', () => {
  const csv = historyToCsv(events, labels, utc);

  it('starts with a UTF-8 BOM and uses CRLF', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.split('\r\n')).toHaveLength(4);
  });

  it('keeps ₹ in the header and writes plain rupee amounts', () => {
    expect(csv.split('\r\n')[0]).toBe('﻿Date,Time,Reference,Amount (₹),Displays,Ended by,Shown for (s),Source,Note');
    expect(csv.split('\r\n')[1]).toBe('2026-10-12,06:30:00,CP2610120001,1140.00,sim phone,Cleared,42,Popup,');
  });

  it('defuses formulas and escapes quotes', () => {
    expect(csv.split('\r\n')[2]).toBe(
      `2026-10-12,07:00:00,CP2610120002,50.50,sim,Showing,,API,"'=HYPERLINK(""x""), ""quoted"""`,
    );
  });
});

describe('dailyTotals', () => {
  it('sums per day, newest first', () => {
    const more: QrEvent[] = [...events, { ...events[0]!, id: 3, shownAt: Date.UTC(2026, 9, 11, 12) }];
    expect(dailyTotals(more, utc.date)).toEqual([
      { day: '2026-10-12', count: 2, totalPaise: 119050 },
      { day: '2026-10-11', count: 1, totalPaise: 114000 },
    ]);
  });
});

describe('profiles', () => {
  it('knows portrait from landscape, including rotation', () => {
    expect(isPortrait({ w: 320, h: 480, rotation: 0 })).toBe(true);
    expect(isPortrait({ w: 400, h: 300, rotation: 0 })).toBe(false);
    expect(isPortrait({ w: 400, h: 300, rotation: 90 })).toBe(true);
  });

  it('fits the QR at whole pixels per module', () => {
    // A version 5 code is 37 modules; with a 4-module quiet zone that is 45.
    expect(pixelsPerModule(280, 37)).toBe(6);
    expect(pixelsPerModule(80, 37)).toBe(0);
  });
});
