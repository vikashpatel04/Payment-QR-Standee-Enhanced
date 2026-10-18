import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SerialPort } from 'serialport';
import { displayPageDir, iconPath, preloadPath, rendererUrl } from './paths';
import { loadPlatform } from './platform';

export interface SelfTestReport {
  ok: boolean;
  version: string;
  packaged: boolean;
  checks: Record<string, boolean | string>;
}

/**
 * `Counter Pay.exe --self-test`: checks that the native parts and bundled files load,
 * prints one JSON line and exits. Opens no windows, registers no shortcuts, starts no
 * servers, and keeps its data in a temporary folder.
 */
export async function selfTest(): Promise<SelfTestReport> {
  const checks: Record<string, boolean | string> = {};

  try {
    const db = new Database(':memory:');
    checks.sqlite = (db.prepare('select sqlite_version() as v').get() as { v: string }).v;
    db.close();
  } catch (error) {
    checks.sqlite = false;
    checks.sqliteError = (error as Error).message;
  }

  try {
    // Lists ports only; nothing is opened, so a printer on a COM port is never touched.
    checks.serialPorts = String((await SerialPort.list()).length);
  } catch (error) {
    checks.serialPorts = false;
    checks.serialPortsError = (error as Error).message;
  }

  const platform = await loadPlatform();
  checks.focusHelpers = process.platform !== 'win32' || platform.name === 'win32';
  if (platform.name === 'win32') checks.foregroundCaptured = platform.captureForeground() !== undefined;

  const renderer = rendererUrl('popup');
  checks.renderer = 'file' in renderer ? existsSync(renderer.file) : true;
  checks.preload = existsSync(preloadPath());
  checks.displayPage = existsSync(join(displayPageDir(), 'index.html'));
  checks.framePage = existsSync(join(displayPageDir(), 'frame.html'));
  checks.icons = existsSync(iconPath('tray.png')) && existsSync(iconPath('tray-dot.png'));
  if (app.isPackaged) checks.updateFeed = existsSync(join(process.resourcesPath, 'app-update.yml'));

  const ok = Object.entries(checks).every(([key, value]) => key.endsWith('Error') || value !== false);
  return { ok, version: app.getVersion(), packaged: app.isPackaged, checks };
}
