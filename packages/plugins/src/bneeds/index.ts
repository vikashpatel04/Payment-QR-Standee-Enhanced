import type { TriggerContext, TriggerPlugin } from '../types';

export interface BneedsWatcherOptions {
  /** SQL Server connection for a READ-ONLY login. Never a login that can write. */
  server: string;
  database: string;
  user: string;
  password: string;
  /** The bill header table, found by comparing row counts before and after a normal real bill. */
  billTable: string;
  pollMs?: number;
}

/**
 * Phase 4: watches BNeeds for a newly saved bill and clears the pay QR.
 *
 * TODO(phase-4):
 *  - connect with `mssql` using the read-only login;
 *  - every `pollMs` (default 2 s) read only the newest bill number from `billTable`;
 *  - when it changes during a Pay scene, emit `billSaved`;
 *  - never create test bills, never write, never touch BNeeds' windows.
 */
export class BneedsWatcher implements TriggerPlugin {
  readonly id = 'bneeds';
  readonly name = 'BNeeds bill watcher';

  constructor(private readonly options: BneedsWatcherOptions) {}

  async start(context: TriggerContext): Promise<void> {
    context.log('info', `BNeeds watcher is not built yet (Phase 4). Table: ${this.options.billTable}`);
  }

  async stop(): Promise<void> {}
}
