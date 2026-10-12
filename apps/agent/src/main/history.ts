import type { EndReason, PaySource, QrEvent } from '@counterpay/core';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS qr_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT    NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  shown_at     INTEGER NOT NULL,
  ended_at     INTEGER,
  end_reason   TEXT CHECK (end_reason IN ('cleared', 'replaced', 'expired', 'link-lost', 'bill-saved')),
  displays     TEXT    NOT NULL DEFAULT '',
  source       TEXT    NOT NULL CHECK (source IN ('popup', 'api', 'cli', 'watcher')),
  note         TEXT
);
CREATE INDEX IF NOT EXISTS qr_events_shown_at ON qr_events (shown_at);
`;

const END_REASONS: ReadonlySet<string> = new Set<EndReason>(['cleared', 'replaced', 'expired', 'link-lost', 'bill-saved']);

interface Row {
  id: number;
  ref: string;
  amount_paise: number;
  shown_at: number;
  ended_at: number | null;
  end_reason: EndReason | null;
  displays: string;
  source: PaySource;
  note: string | null;
}

function toEvent(row: Row): QrEvent {
  return {
    id: row.id,
    ref: row.ref,
    amountPaise: row.amount_paise,
    shownAt: row.shown_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    displays: row.displays ? row.displays.split(',') : [],
    source: row.source,
    note: row.note,
  };
}

export interface HistoryQuery {
  from?: number;
  to?: number;
  minPaise?: number;
  maxPaise?: number;
  reasons?: Array<EndReason | 'open'>;
  limit?: number;
}

/**
 * Every QR ever shown, in %APPDATA%\Counter Pay\history.db. It records what was
 * shown, not what was paid, and holds no customer data (a UPI QR carries none).
 */
export class HistoryDb {
  private readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    if (this.db.pragma('user_version', { simple: true }) === 0) this.db.pragma('user_version = 1');
  }

  start(event: { ref: string; amountPaise: number; shownAt: number; displays: string[]; source: PaySource }): void {
    this.db
      .prepare(
        'INSERT INTO qr_events (ref, amount_paise, shown_at, displays, source) VALUES (@ref, @amountPaise, @shownAt, @displays, @source)',
      )
      .run({ ...event, displays: event.displays.join(',') });
  }

  end(ref: string, reason: EndReason, endedAt: number): void {
    this.db
      .prepare('UPDATE qr_events SET ended_at = ?, end_reason = ? WHERE ref = ? AND ended_at IS NULL')
      .run(endedAt, reason, ref);
  }

  /**
   * After a crash, rows can be left open. The display enforced the ttl on its own, so
   * those QRs expired: close them at their ttl, or now if that is sooner.
   */
  closeDangling(now: number, ttlMs: number): number {
    return this.db
      .prepare(
        "UPDATE qr_events SET ended_at = MIN(shown_at + ?, ?), end_reason = 'expired' WHERE ended_at IS NULL",
      )
      .run(ttlMs, now).changes;
  }

  /** The newest reference starting with `prefix`, to keep the daily counter unique after a reset. */
  lastRefStartingWith(prefix: string): string | null {
    const row = this.db
      .prepare("SELECT ref FROM qr_events WHERE ref LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1")
      .get(`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as { ref: string } | undefined;
    return row?.ref ?? null;
  }

  get(id: number): QrEvent | null {
    const row = this.db.prepare('SELECT * FROM qr_events WHERE id = ?').get(id) as Row | undefined;
    return row ? toEvent(row) : null;
  }

  query(filter: HistoryQuery = {}): QrEvent[] {
    const where: string[] = [];
    const params: Record<string, number> = {};
    if (filter.from !== undefined) {
      where.push('shown_at >= @from');
      params.from = filter.from;
    }
    if (filter.to !== undefined) {
      where.push('shown_at < @to');
      params.to = filter.to;
    }
    if (filter.minPaise !== undefined) {
      where.push('amount_paise >= @minPaise');
      params.minPaise = filter.minPaise;
    }
    if (filter.maxPaise !== undefined) {
      where.push('amount_paise <= @maxPaise');
      params.maxPaise = filter.maxPaise;
    }
    if (filter.reasons?.length) {
      const known = filter.reasons.filter((r): r is EndReason => END_REASONS.has(r));
      const parts: string[] = [];
      if (known.length) parts.push(`end_reason IN (${known.map((r) => `'${r}'`).join(', ')})`);
      if (filter.reasons.includes('open')) parts.push('end_reason IS NULL');
      // Only unknown reasons asked for: nothing matches.
      where.push(parts.length ? `(${parts.join(' OR ')})` : '0');
    }
    const limit = Math.min(Math.max(filter.limit ?? 5000, 1), 50_000);
    const sql = `SELECT * FROM qr_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY shown_at DESC LIMIT ${limit}`;
    return (this.db.prepare(sql).all(params) as Row[]).map(toEvent);
  }

  stats(from: number, to: number): { count: number; totalPaise: number } {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount_paise), 0) AS total FROM qr_events WHERE shown_at >= ? AND shown_at < ?')
      .get(from, to) as { count: number; total: number };
    return { count: row.count, totalPaise: row.total };
  }

  purge(retentionDays: number, now: number): number {
    return this.db.prepare('DELETE FROM qr_events WHERE shown_at < ?').run(now - retentionDays * 86_400_000).changes;
  }

  close(): void {
    this.db.close();
  }
}
