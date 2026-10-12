import { toUpiAmount } from './amount';
import type { EndReason, PaySource } from './state';

/**
 * History records what was shown, not what was paid. The UPI merchant app or
 * the bank stays the source of truth for payments.
 */
export interface QrEvent {
  id: number;
  ref: string;
  amountPaise: number;
  shownAt: number;
  endedAt: number | null;
  endReason: EndReason | null;
  /** Ids of the displays the QR was shown on. */
  displays: string[];
  source: PaySource;
  note: string | null;
}

export function durationSeconds(event: Pick<QrEvent, 'shownAt' | 'endedAt'>): number | null {
  return event.endedAt === null ? null : Math.max(0, Math.round((event.endedAt - event.shownAt) / 1000));
}

export interface DayTotal {
  day: string;
  count: number;
  totalPaise: number;
}

/** Totals per day, newest day first. `dayOf` maps a timestamp to its local `YYYY-MM-DD`. */
export function dailyTotals(events: QrEvent[], dayOf: (ms: number) => string): DayTotal[] {
  const totals = new Map<string, DayTotal>();
  for (const event of events) {
    const day = dayOf(event.shownAt);
    const total = totals.get(day) ?? { day, count: 0, totalPaise: 0 };
    total.count += 1;
    total.totalPaise += event.amountPaise;
    totals.set(day, total);
  }
  return [...totals.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

export interface CsvLabels {
  headers: {
    date: string;
    time: string;
    ref: string;
    /** Should carry the ₹ sign, e.g. "Amount (₹)", so Excel shows it is rupees. */
    amount: string;
    displays: string;
    ended: string;
    duration: string;
    source: string;
    note: string;
  };
  reasons: Record<EndReason | 'open', string>;
  sources: Record<PaySource, string>;
}

export interface CsvFormat {
  date(ms: number): string;
  time(ms: number): string;
}

function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * CSV that opens correctly in Excel: UTF-8 with a BOM (so ₹ and Tamil survive)
 * and CRLF line ends. Text that Excel would run as a formula is defused with a `'`.
 */
export function historyToCsv(events: QrEvent[], labels: CsvLabels, format: CsvFormat): string {
  const h = labels.headers;
  const rows = [[h.date, h.time, h.ref, h.amount, h.displays, h.ended, h.duration, h.source, h.note]];
  for (const e of events) {
    const duration = durationSeconds(e);
    rows.push([
      format.date(e.shownAt),
      format.time(e.shownAt),
      e.ref,
      toUpiAmount(e.amountPaise),
      e.displays.join(' '),
      labels.reasons[e.endReason ?? 'open'],
      duration === null ? '' : String(duration),
      labels.sources[e.source],
      e.note ?? '',
    ]);
  }
  return `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
