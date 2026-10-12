import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/api';

const CHECK_EVERY_MS = 6 * 3_600_000;
const QUIET_CHECK_EVERY_MS = 60_000;

export interface UpdaterDeps {
  channel(): 'stable' | 'beta';
  /** A quiet moment: quiet hours, no QR showing, popup idle. */
  isQuietMoment(): boolean;
  onChange(state: UpdateState): void;
}

/**
 * App updates from GitHub Releases through electron-updater. Checks at launch and
 * every 6 hours, downloads in the background (differentially, verified against the
 * release's SHA-512), and installs only on quit or at a quiet moment. It never
 * restarts during billing.
 */
export class Updater {
  private state: UpdateState = { status: app.isPackaged ? 'idle' : 'disabled' };
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly deps: UpdaterDeps) {}

  get current(): UpdateState {
    return this.state;
  }

  start(): void {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = {
      info: (message: unknown) => console.log('[updater]', message),
      warn: (message: unknown) => console.warn('[updater]', message),
      error: (message: unknown) => console.error('[updater]', message),
      debug: () => {},
    };
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'latest', checkedAt: Date.now() }));
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (progress) =>
      this.set({ ...this.state, status: 'downloading', percent: Math.round(progress.percent) }),
    );
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }));
    autoUpdater.on('error', (error) => {
      // A failed check (offline shop PC) is normal; keep a ready update if there is one.
      if (this.state.status !== 'ready') this.set({ status: 'error', error: error.message, checkedAt: Date.now() });
    });

    void this.check();
    this.timers.push(setInterval(() => void this.check(), CHECK_EVERY_MS));
    this.timers.push(setInterval(() => this.installIfQuiet(), QUIET_CHECK_EVERY_MS));
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged || this.state.status === 'downloading' || this.state.status === 'ready') return this.state;
    autoUpdater.allowPrerelease = this.deps.channel() === 'beta';
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.set({ status: 'error', error: (error as Error).message, checkedAt: Date.now() });
    }
    return this.state;
  }

  /** Quits and runs the installer silently, then starts Counter Pay again. */
  install(): boolean {
    if (this.state.status !== 'ready') return false;
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private installIfQuiet(): void {
    if (this.state.status === 'ready' && this.deps.isQuietMoment()) this.install();
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.deps.onChange(state);
  }
}
