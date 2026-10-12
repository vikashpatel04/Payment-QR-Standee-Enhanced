import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

const MAX_BYTES = 1024 * 1024;

let file: string | null = null;

export function logDir(): string {
  return join(app.getPath('userData'), 'logs');
}

function write(level: string, args: unknown[]): void {
  if (!file) return;
  try {
    appendFileSync(file, `${new Date().toISOString()} ${level} ${format(...args)}\n`);
  } catch {
    // Logging must never break the app.
  }
}

/**
 * A small log file at %APPDATA%\Counter Pay\logs\counter-pay.log (1 MB, one old copy kept),
 * so problems leave a record. Warnings and errors from anywhere in the main process go to it,
 * and an unexpected error is logged instead of interrupting the cashier with a dialog.
 */
export function initLog(): void {
  const dir = logDir();
  try {
    mkdirSync(dir, { recursive: true });
    file = join(dir, 'counter-pay.log');
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'counter-pay.old.log'));
    } catch {
      // No log yet.
    }
  } catch {
    file = null;
  }

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      write(level === 'log' ? 'INFO' : level.toUpperCase(), args);
    };
  }

  process.on('uncaughtException', (error) => write('FATAL', ['Uncaught exception:', error]));
  process.on('unhandledRejection', (reason) => write('FATAL', ['Unhandled rejection:', reason]));
  write('INFO', [`Counter Pay ${app.getVersion()} starting (${app.isPackaged ? 'installed' : 'development'})`]);
}
