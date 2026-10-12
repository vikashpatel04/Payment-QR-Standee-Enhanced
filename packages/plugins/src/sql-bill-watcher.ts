import type { TriggerContext, TriggerPlugin } from './types';

/**
 * Settings for watching a billing app whose bills live in a SQL database. Everything
 * specific to one billing app (server, database, the query) is the shop's own
 * configuration, never part of this code.
 */
export interface SqlBillWatcherOptions {
  /** Only SQL Server for now; other databases can add their own client. */
  driver: 'mssql';
  server: string;
  database: string;
  /** A READ-ONLY login. Never one that can write. */
  user: string;
  password: string;
  /**
   * Returns one row and one column: the newest bill's number or id, for example
   * `SELECT TOP 1 BillNo FROM Bills ORDER BY BillNo DESC`. Find the table by comparing
   * row counts before and after a normal real bill; never create a test bill.
   */
  latestBillQuery: string;
  pollMs?: number;
}

/**
 * Phase 4: watches a billing app for a newly saved bill. When the newest bill changes
 * while a pay QR is showing, it emits `billSaved`, which clears the QR and shows Thanks.
 *
 * TODO(phase-4):
 *  - connect with `mssql` using the read-only login;
 *  - every `pollMs` (default 2 s) run `latestBillQuery`;
 *  - when the value changes during a Pay scene, emit `billSaved`;
 *  - never write, never touch the billing app's windows.
 */
export class SqlBillWatcher implements TriggerPlugin {
  readonly id = 'sql-bill-watcher';
  readonly name = 'SQL bill watcher';

  constructor(private readonly options: SqlBillWatcherOptions) {}

  async start(context: TriggerContext): Promise<void> {
    context.log('info', `The SQL bill watcher (${this.options.driver}) is not built yet (Phase 4).`);
  }

  async stop(): Promise<void> {}
}
