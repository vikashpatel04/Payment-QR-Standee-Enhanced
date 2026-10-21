import {
  advanceRef,
  buildUri,
  type CounterPayConfig,
  type CsvLabels,
  dailyTotals,
  type DisplayConfig,
  frameProfiles,
  type DisplayContent,
  historyToCsv,
  isPairingCode,
  isPayeeConfigured,
  isQuietMoment,
  localDay,
  type PayeeInfo,
  type PaySource,
  PROFILE_PRESETS,
  readPayee,
  readySlides,
  type Scene,
  SceneMachine,
  splitAddress,
  UpiError,
} from '@counterpay/core';
import type { DriverStatus } from '@counterpay/drivers';
import { app, dialog, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, powerMonitor, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  type AppSnapshot,
  type ConfigPatch,
  type HistoryFilter,
  type HistoryPage,
  IPC,
  type PayeeImportResult,
  type PopupOpenInfo,
  type SceneView,
  type SubmitResult,
  type WifiDisplayFound,
  type WifiPairResult,
} from '../shared/api';
import { secrets, ConfigStore } from './config-store';
import { ElectronWindowHost, listMonitors } from './display-windows';
import { DisplayManager, type ShowOutcome } from './displays';
import { OffscreenFrameRenderer } from './frame-renderer';
import { listPorts, serialPorts } from './serial-ports';
import { discover, DisplayRefused, keyWorks, pair, unpair, wifiPorts } from './wifi-displays';
import { HistoryDb } from './history';
import { t } from './i18n';
import { logDir } from './log';
import { displayPageDir, userDir } from './paths';
import type { Platform } from './platform';
import { LanServer, LocalServer } from './server';
import { Shortcuts } from './shortcuts';
import { StateStore } from './state-store';
import { AppTray } from './tray';
import { Updater } from './updater';
import { MainWindow, PopupWindow, SimulatorWindow, ToastWindow } from './windows';

type StartResult = { ok: false; error: 'noPayee' | 'invalid' | 'failed' } | { ok: true; outcome: Promise<ShowOutcome> };

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function nextDay(dayStart: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

function sceneView(scene: Scene): SceneView {
  switch (scene.kind) {
    case 'pay':
      return { kind: 'pay', amountPaise: scene.amountPaise, ref: scene.ref, shownAt: scene.shownAt, expiresAt: scene.expiresAt };
    case 'thanks':
      return { kind: 'thanks', shownAt: scene.shownAt, endsAt: scene.endsAt };
    case 'ambient':
      return { kind: 'ambient', shownAt: scene.shownAt };
  }
}

function offStatus(display: DisplayConfig): DriverStatus {
  return { id: display.id, kind: display.driver, state: 'offline', clients: 0, previews: 0 };
}

/**
 * The background agent. It owns all state: the current scene, History, the
 * displays and the shortcuts. The popup and the main window are only inputs.
 */
export class Agent {
  private readonly config = new ConfigStore();
  private readonly state = new StateStore();
  /** Random per launch. A development build may pin it (COUNTERPAY_LOCAL_KEY) to open previews in a browser. */
  private readonly localKey = (!app.isPackaged && process.env.COUNTERPAY_LOCAL_KEY) || randomBytes(18).toString('base64url');
  private readonly history: HistoryDb;
  private readonly machine: SceneMachine;
  private readonly windowHost: ElectronWindowHost;
  private readonly displays: DisplayManager;
  private readonly frames: OffscreenFrameRenderer;
  private readonly localServer: LocalServer;
  private readonly lanServer: LanServer;
  private readonly shortcuts: Shortcuts;
  private readonly main = new MainWindow();
  private readonly simulator: SimulatorWindow;
  private popup: PopupWindow | null = null;
  private toast: ToastWindow | null = null;
  private tray: AppTray | null = null;
  private showing: Promise<ShowOutcome> = Promise.resolve({ acked: [], reach: 'simulatorOnly' });
  private serverError: AppSnapshot['serverError'] = null;
  /** Read once at launch: a port change applies on the next start. */
  private readonly ports: { local: number; lan: number };
  /** The standby slide showing, when slides change with a key. */
  private slideIndex = 0;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private housekeeping: NodeJS.Timeout | null = null;
  private quitting = false;
  private readonly updater: Updater;
  /** When the popup was last opened; updates wait until it has been idle a while. */
  private lastPopupAt: number | null = null;

  constructor(private readonly platform: Platform) {
    mkdirSync(userDir(), { recursive: true });
    const { localPort, lanPort } = this.config.get().server;
    this.ports = { local: localPort, lan: lanPort };
    this.history = new HistoryDb(userDir('history.db'));

    this.machine = new SceneMachine({
      preparePay: (amountPaise) => {
        const config = this.config.get();
        const next = advanceRef(this.state.get('refCounter'), new Date(), config.pay.refPrefix);
        const uri = buildUri(config.upi.baseUri, amountPaise, next.ref, { addMam: config.upi.addMam });
        this.state.set('refCounter', next.state);
        return { ref: next.ref, uri };
      },
      ttlSeconds: () => this.config.get().pay.ttlSeconds,
      thanksSeconds: () => this.config.get().thanks.seconds,
    });

    this.windowHost = new ElectronWindowHost((id, rotation) => this.displayUrl(id, 'display', rotation));
    this.frames = new OffscreenFrameRenderer(
      () => join(displayPageDir(), 'frame.html'),
      () => `http://127.0.0.1:${this.ports.local}`,
    );
    this.displays = new DisplayManager({ windowHost: this.windowHost, serialPorts, wifiPorts, frameRenderer: this.frames });
    this.simulator = new SimulatorWindow(() => this.displayUrl('sim', 'preview'));

    const serverDeps = {
      version: app.getVersion(),
      localKey: this.localKey,
      displayDir: displayPageDir,
      contentDir: () => userDir('content', 'images'),
      logoFile: () => this.logoFile(),
      attach: (id: string, link: Parameters<DisplayManager['attach']>[1]) => this.displays.attach(id, link),
      pair: (code: string) => this.pair(code),
      displayForToken: (token: string) => this.displayForToken(token),
    };
    this.localServer = new LocalServer(serverDeps);
    this.lanServer = new LanServer(serverDeps);

    this.shortcuts = new Shortcuts({
      summon: () => this.summon(),
      clear: () => this.clearFromShortcut(),
      next: () => this.nextSlide(),
    });

    this.updater = new Updater({
      channel: () => this.config.get().updates.channel,
      isQuietMoment: () =>
        isQuietMoment({
          now: new Date(),
          scene: this.machine.current.kind,
          lastPopupAt: this.lastPopupAt,
          quietHours: this.config.get().updates.quietHours,
        }),
      onChange: () => {
        this.tray?.refresh();
        this.pushSnapshot();
      },
    });
  }

  async start(options: { hidden: boolean }): Promise<void> {
    const config = this.config.get();
    this.tidyHistory();
    this.syncRefCounter();

    this.machine.on('scene', (scene) => {
      this.showing = this.displays.show(scene);
      this.pushSnapshot();
    });
    this.machine.on('payStarted', ({ scene, source }) => {
      this.safely('history start', () =>
        this.history.start({
          ref: scene.ref,
          amountPaise: scene.amountPaise,
          shownAt: scene.shownAt,
          displays: this.displays.showingIds(),
          source,
        }),
      );
    });
    this.machine.on('payEnded', ({ scene, reason, endedAt }) => {
      this.safely('history end', () => this.history.end(scene.ref, reason, endedAt));
      this.pushSnapshot();
    });
    this.displays.onChange(() => this.pushSnapshot());
    this.displays.onLinkLost(() => {
      if (!this.displays.anyRealConnected()) this.machine.linkLost();
    });
    this.config.onChange(({ config: next, previous }) => this.onConfigChange(next, previous));

    try {
      await this.localServer.start(this.ports.local, '127.0.0.1');
    } catch (error) {
      this.serverError = { code: 'localPortBusy', port: this.ports.local };
      console.error(`[agent] display server could not use port ${this.ports.local}:`, error);
    }
    this.displays.setContent(this.content());
    await this.displays.sync(config.displays);
    void this.displays.show(this.machine.current);
    await this.updateLan();

    this.popup = new PopupWindow(this.platform);
    this.toast = new ToastWindow();
    this.tray = new AppTray({
      open: () => this.main.show(),
      showAmount: () => this.summon(),
      clear: () => this.clearFromShortcut(),
      togglePause: () => this.togglePause(),
      isPaused: () => this.shortcuts.isPaused,
      update: () => this.updater.current,
      checkUpdates: () => void this.checkUpdatesFromTray(),
      installUpdate: () => this.installUpdate(),
      quit: () => app.quit(),
    });
    this.shortcuts.apply(this.wantedShortcuts(config));
    this.registerIpc();
    this.applyLoginItem(config);

    powerMonitor.on('resume', () => this.shortcuts.apply(this.wantedShortcuts(this.config.get())));
    if (this.state.get('seenVersion') === undefined) this.state.set('seenVersion', app.getVersion());
    this.updater.start();
    this.housekeeping = setInterval(() => this.tidyHistory(), 6 * 3_600_000);

    if (!options.hidden || !this.state.get('onboardingCompleted')) this.main.show();
  }

  openMainWindow(): void {
    this.main.show();
  }

  /** Shuts down in order. Each step runs even if an earlier one failed, and History closes last. */
  async stop(): Promise<void> {
    if (this.quitting) return;
    this.quitting = true;
    console.log('[agent] quitting');
    if (this.housekeeping) clearInterval(this.housekeeping);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.safely('updater stop', () => this.updater.stop());
    this.safely('shortcuts stop', () => this.shortcuts.dispose());
    this.safely('scene stop', () => this.machine.dispose());
    await this.displays.dispose().catch((error) => console.error('[agent] displays stop failed', error));
    this.safely('display windows close', () => this.windowHost.closeAll());
    this.safely('frame renderer close', () => this.frames.dispose());
    await Promise.all([this.localServer.stop(), this.lanServer.stop()]).catch((error) =>
      console.error('[agent] servers stop failed', error),
    );
    this.safely('tray remove', () => this.tray?.dispose());
    this.safely('history close', () => this.history.close());
  }

  // ---------- Showing and clearing ----------

  private startShow(amountPaise: number, source: PaySource): StartResult {
    const config = this.config.get();
    if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > config.pay.maxRupees * 100) {
      return { ok: false, error: 'invalid' };
    }
    if (!isPayeeConfigured(config)) return { ok: false, error: 'noPayee' };
    try {
      this.machine.showAmount(amountPaise, source);
    } catch (error) {
      console.error('[agent] could not show amount', error);
      return { ok: false, error: 'failed' };
    }
    this.state.set('lastAmountPaise', amountPaise);
    return { ok: true, outcome: this.showing };
  }

  private async show(amountPaise: number, source: PaySource): Promise<SubmitResult> {
    const started = this.startShow(amountPaise, source);
    if (!started.ok) return started;
    return { ok: true, reach: (await started.outcome).reach };
  }

  private summon(): void {
    if (!this.popup) return;
    this.lastPopupAt = Date.now();
    const config = this.config.get();
    const pay = this.machine.pay;
    const info: PopupOpenInfo = {
      current: pay ? { amountPaise: pay.amountPaise, ref: pay.ref } : null,
      lastAmountPaise: this.state.get('lastAmountPaise') ?? null,
      maxRupees: config.pay.maxRupees,
      reach: this.displays.reach(),
      payeeReady: isPayeeConfigured(config),
      reduceMotion: config.reduceMotion,
    };
    this.popup.open(info);
  }

  private clear(): boolean {
    return this.machine.clear('thanks');
  }

  private clearFromShortcut(): void {
    const cleared = this.clear();
    this.toast?.show({ reduceMotion: this.config.get().reduceMotion, text: t(cleared ? 'toast.cleared' : 'toast.nothingToClear'), tone: 'info' });
  }

  private togglePause(): void {
    this.shortcuts.setPaused(!this.shortcuts.isPaused);
    this.toast?.show({ reduceMotion: this.config.get().reduceMotion, text: t(this.shortcuts.isPaused ? 'toast.shortcutsPaused' : 'toast.shortcutsResumed'), tone: 'info' });
    this.tray?.refresh();
    this.pushSnapshot();
  }

  // ---------- Updates ----------

  private async checkUpdatesFromTray(): Promise<void> {
    const state = await this.updater.check();
    const key =
      state.status === 'latest'
        ? 'toast.upToDate'
        : state.status === 'downloading' || state.status === 'checking'
          ? 'toast.updateDownloading'
          : state.status === 'ready'
            ? 'toast.updateReady'
            : 'toast.updateFailed';
    this.toast?.show({ reduceMotion: this.config.get().reduceMotion, text: t(key, { version: state.version ?? '' }), tone: state.status === 'error' ? 'warn' : 'info' });
  }

  /** User-asked restart into the update. Never while a customer is looking at a QR. */
  private installUpdate(): boolean {
    if (this.machine.current.kind === 'pay') {
      this.toast?.show({ reduceMotion: this.config.get().reduceMotion, text: t('toast.updateAfterQr'), tone: 'warn' });
      return false;
    }
    return this.updater.install();
  }

  /** The GitHub releases page, from the repository field of the app's package.json. */
  private releaseUrl(version: string): string | null {
    try {
      const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { repository?: string | { url?: string } };
      const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
      const match = repository ? /github(?:\.com[/:]|:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(repository) : null;
      return match ? `https://github.com/${match[1]}/releases/tag/v${version}` : null;
    } catch {
      return null;
    }
  }

  // ---------- Config, content and displays ----------

  private onConfigChange(config: CounterPayConfig, previous: CounterPayConfig): void {
    if (JSON.stringify(this.wantedShortcuts(config)) !== JSON.stringify(this.wantedShortcuts(previous))) {
      this.shortcuts.apply(this.wantedShortcuts(config));
    }
    this.revokeStaleTokens(config);
    this.displays.setContent(this.content());
    void this.displays.sync(config.displays).then(() => this.updateLan());
    if (config.startAtLogin !== previous.startAtLogin) this.applyLoginItem(config);
    this.tray?.refresh();
    this.pushSnapshot();
  }

  private payee(): PayeeInfo | null {
    const { baseUri } = this.config.get().upi;
    if (!baseUri) return null;
    try {
      return readPayee(baseUri);
    } catch {
      return null;
    }
  }

  /** The "next slide" key is only taken from Windows while slides change with a key. */
  private wantedShortcuts(config: CounterPayConfig): { summon: string; clear: string; next: string } {
    const { summon, clear, next } = config.shortcuts;
    return { summon, clear, next: config.ambient.advance === 'key' ? next : '' };
  }

  /** The cashier's key: every display moves to the next standby slide (not while a QR shows). */
  private nextSlide(): void {
    const config = this.config.get();
    if (config.ambient.advance !== 'key' || this.machine.current.kind !== 'ambient') return;
    const count = readySlides(config.ambient.items, isPayeeConfigured(config)).length;
    this.slideIndex = (this.slideIndex + 1) % Math.max(1, count);
    this.displays.setContent(this.content());
  }

  private logoFile(): string | null {
    const path = this.config.get().brand.logoPath;
    return path && existsSync(path) ? path : null;
  }

  private content(): DisplayContent {
    const config = this.config.get();
    const name = config.upi.payeeLabel || this.payee()?.name || '';
    const rating = config.ambient.items.find((item) => item.k === 'rating');
    const logo = this.logoFile();
    return {
      shopName: config.brand.shopName || name,
      payeeLabel: name,
      accent: config.brand.accent,
      ...(logo ? { logoUrl: `/content/logo?v=${Math.round(statSync(logo).mtimeMs)}` } : {}),
      languages: config.language.display,
      ambient: {
        slideSeconds: config.ambient.slideSeconds,
        items: config.ambient.items,
        advance: config.ambient.advance,
        index: this.slideIndex,
      },
      thanks: { seconds: config.thanks.seconds, ...(rating && rating.k === 'rating' ? { ratingUrl: rating.url } : {}) },
      ...(isPayeeConfigured(config) ? { standeeUri: config.upi.baseUri } : {}),
    };
  }

  private displayUrl(id: string, role: 'display' | 'preview', rotation = 0): string {
    const query = new URLSearchParams({ id, key: this.localKey, role });
    if (rotation) query.set('rotate', String(rotation));
    return `http://127.0.0.1:${this.ports.local}/display/?${query.toString()}`;
  }

  private async updateLan(): Promise<void> {
    const wanted = this.config.get().displays.some((d) => d.enabled && d.driver === 'web');
    try {
      if (wanted && !this.lanServer.running) await this.lanServer.start(this.ports.lan, '0.0.0.0');
      if (!wanted && this.lanServer.running) await this.lanServer.stop();
      if (this.serverError?.code === 'lanPortBusy') this.serverError = null;
    } catch (error) {
      this.serverError = { code: 'lanPortBusy', port: this.ports.lan };
      console.error(`[agent] Wi-Fi display server could not use port ${this.ports.lan}:`, error);
    }
    this.pushSnapshot();
  }

  // ---------- Wi-Fi pairing ----------

  private pair(code: string): string | null {
    const display = this.config.get().displays.find((d) => d.enabled && d.driver === 'web' && d.pairingCode === code);
    if (!display) return null;
    const token = randomBytes(24).toString('base64url');
    this.state.set('webTokens', { ...(this.state.get('webTokens') ?? {}), [token]: { id: display.id, code } });
    return token;
  }

  private displayForToken(token: string): string | null {
    const entry = (this.state.get('webTokens') ?? {})[token];
    if (!entry) return null;
    const display = this.config
      .get()
      .displays.find((d) => d.id === entry.id && d.enabled && d.driver === 'web' && d.pairingCode === entry.code);
    return display?.id ?? null;
  }

  /** A new pairing code, or a removed display, signs out every phone paired with the old one. */
  private revokeStaleTokens(config: CounterPayConfig): void {
    const tokens = this.state.get('webTokens');
    if (!tokens) return;
    const valid = Object.fromEntries(
      Object.entries(tokens).filter(([, entry]) =>
        config.displays.some((d) => d.id === entry.id && d.driver === 'web' && d.pairingCode === entry.code),
      ),
    );
    if (Object.keys(valid).length !== Object.keys(tokens).length) this.state.set('webTokens', valid);
  }

  // ---------- History ----------

  private tidyHistory(): void {
    const config = this.config.get();
    this.safely('history tidy', () => {
      this.history.closeDangling(Date.now(), config.pay.ttlSeconds * 1000);
      this.history.purge(config.history.retentionDays, Date.now());
    });
  }

  /** If the state file was lost, carry on from the newest reference in History so refs stay unique. */
  private syncRefCounter(): void {
    const config = this.config.get();
    const day = localDay(new Date());
    const prefix = `${config.pay.refPrefix}${day.slice(2).replace(/-/g, '')}`;
    const last = this.history.lastRefStartingWith(prefix);
    const fromHistory = last ? Number(last.slice(prefix.length)) : 0;
    const saved = this.state.get('refCounter');
    const savedToday = saved?.day === day ? saved.count : 0;
    if (Number.isInteger(fromHistory) && fromHistory > savedToday) this.state.set('refCounter', { day, count: fromHistory });
  }

  private historyPage(filter: HistoryFilter): HistoryPage {
    const events = this.history.query(filter);
    const totalPaise = events.reduce((sum, e) => sum + e.amountPaise, 0);
    return { events, totals: dailyTotals(events, (ms) => localDay(new Date(ms))), total: { count: events.length, totalPaise } };
  }

  private csvLabels(): CsvLabels {
    return {
      headers: {
        date: t('history.csv.date'),
        time: t('history.csv.time'),
        ref: t('history.csv.ref'),
        amount: t('history.csv.amount'),
        displays: t('history.csv.displays'),
        ended: t('history.csv.ended'),
        duration: t('history.csv.duration'),
        source: t('history.csv.source'),
        note: t('history.csv.note'),
      },
      reasons: {
        cleared: t('history.reason.cleared'),
        replaced: t('history.reason.replaced'),
        expired: t('history.reason.expired'),
        'link-lost': t('history.reason.link-lost'),
        'bill-saved': t('history.reason.bill-saved'),
        open: t('history.reason.open'),
      },
      sources: {
        popup: t('history.source.popup'),
        api: t('history.source.api'),
        cli: t('history.source.cli'),
        watcher: t('history.source.watcher'),
      },
    };
  }

  // ---------- Snapshot for the main window ----------

  private snapshot(): AppSnapshot {
    const config = this.config.get();
    const today = startOfDay(Date.now());
    return {
      version: app.getVersion(),
      config,
      scene: sceneView(this.machine.current),
      displays: config.displays.map((display) => ({
        config: display,
        status: (display.enabled && this.displays.status(display.id)) || offStatus(display),
        previewUrl: display.enabled ? this.displayUrl(display.id, 'preview', display.rotation) : null,
      })),
      today: this.history.stats(today, nextDay(today)),
      shortcuts: this.shortcuts.state(),
      payee: this.payee(),
      onboarding: {
        completed: Boolean(this.state.get('onboardingCompleted')),
        amountLockTest: this.state.get('amountLockTest') ?? null,
      },
      lanUrls: this.lanServer.running ? LanServer.urls(this.ports.lan) : [],
      serverError: this.serverError,
      localBaseUrl: `http://127.0.0.1:${this.ports.local}`,
      monitors: listMonitors(),
      update: this.updater.current,
      whatsNew:
        this.state.get('seenVersion') && this.state.get('seenVersion') !== app.getVersion()
          ? { version: app.getVersion(), url: this.releaseUrl(app.getVersion()) }
          : null,
    };
  }

  private pushSnapshot(): void {
    // While quitting, History may already be closed: the window is going away anyway.
    if (this.quitting || !this.main.isOpen || this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      if (this.quitting) return;
      this.safely('window refresh', () => this.main.send(IPC.snapshotPush, this.snapshot()));
    }, 100);
  }

  // ---------- Wi-Fi displays ----------

  private async pairWifi(address: string, code: string): Promise<WifiPairResult> {
    const target = splitAddress(address);
    if (!target) return { ok: false, reason: 'address' };
    if (!isPairingCode(code.trim())) return { ok: false, reason: 'code' };
    const full = `${target.host}:${target.port}`;
    try {
      const { id, key } = await this.pairOrReuse(full, target.host, code.trim());
      const info = (await discover({ timeoutMs: 1_000, hosts: [target.host] })).find((d) => d.id === id);
      // Pairing again replaces the old entry for the same display.
      const displays = this.config.get().displays.filter((d) => !(d.driver === 'wifi-frame' && d.device === id));
      let n = 1;
      while (displays.some((d) => d.id === `wifi-${n}`)) n += 1;
      const profile =
        (info?.profile && PROFILE_PRESETS[info.profile]?.mode === 'frame' && info.profile) ||
        frameProfiles().find((p) => info && p.w === info.w && p.h === info.h)?.id ||
        'waveshare-2in13-v4';
      displays.push({
        id: `wifi-${n}`,
        driver: 'wifi-frame',
        enabled: true,
        name: info?.name || t('app.displays.kind.wifi-frame'),
        device: id,
        address: /^\d+\.\d+\.\d+\.\d+$/.test(target.host) ? (info?.address ?? full) : full,
        key,
        profile,
        rotation: info?.rotation ?? 0,
      });
      this.config.update({ displays });
      return { ok: true, displayId: `wifi-${n}` };
    } catch (error) {
      if (!(error instanceof DisplayRefused)) console.error('[wifi] pairing failed', error);
      const reason = error instanceof DisplayRefused ? error.reason : 'unreachable';
      return { ok: false, reason };
    }
  }

  /**
   * Pairs with the code; or, if the display says it is already paired, checks whether it is
   * paired with this PC (a display removed while it was unreachable) and simply uses it again.
   */
  private async pairOrReuse(address: string, host: string, code: string): Promise<{ id: string; key: string }> {
    try {
      return await pair(address, code);
    } catch (error) {
      if (!(error instanceof DisplayRefused) || error.reason !== 'paired') throw error;
      const keys = this.state.get('wifiKeys') ?? {};
      const found = await discover({ timeoutMs: 1_000, hosts: [host] });
      for (const d of found) {
        const key = keys[d.id];
        if (key && (await keyWorks(d.address, d.id, key))) {
          const { [d.id]: _used, ...rest } = keys;
          this.state.set('wifiKeys', rest);
          return { id: d.id, key };
        }
      }
      throw error;
    }
  }

  /**
   * Removes a display. A Wi-Fi display is told to forget this PC first, and is only removed
   * once it has; if it can't be reached, it stays, unless `force` (then its key is kept, so
   * pairing it again later needs no reset).
   */
  private async forgetWifi(id: string, force = false): Promise<{ ok: true } | { ok: false; reason: 'unreachable' }> {
    const display = this.config.get().displays.find((d) => d.id === id);
    if (!display) return { ok: true };
    const remove = () => this.config.update({ displays: this.config.get().displays.filter((d) => d.id !== id) });
    if (display.driver !== 'wifi-frame') {
      remove();
      return { ok: true };
    }
    // Let its driver drop the connection first, so the display isn't busy with it.
    if (display.enabled) {
      this.config.update({ displays: this.config.get().displays.map((d) => (d.id === id ? { ...d, enabled: false } : d)) });
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    let forgotten = false;
    for (let attempt = 0; attempt < 3 && !forgotten; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        await unpair(display);
        forgotten = true;
      } catch (error) {
        // 'key': the display no longer knows this PC; it has already forgotten it.
        if (error instanceof DisplayRefused && error.reason === 'key') forgotten = true;
        else console.warn('[wifi] could not tell the display to forget this PC', error);
      }
    }
    if (forgotten || force) {
      if (!forgotten && display.device && display.key) {
        this.state.set('wifiKeys', { ...(this.state.get('wifiKeys') ?? {}), [display.device]: display.key });
      }
      remove();
      return { ok: true };
    }
    // Still paired: put it back as it was.
    this.config.update({ displays: this.config.get().displays.map((d) => (d.id === id ? { ...d, enabled: display.enabled } : d)) });
    return { ok: false, reason: 'unreachable' };
  }

  // ---------- IPC ----------

  private registerIpc(): void {
    const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
      ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
        if (!this.trusted(event)) throw new Error('Untrusted sender');
        return fn(...(args as A));
      });
    const on = <A extends unknown[]>(channel: string, fn: (...args: A) => void) =>
      ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
        if (this.trusted(event)) fn(...(args as A));
      });

    handle(IPC.popupSubmit, async (amountPaise: number) => {
      const started = this.startShow(Number(amountPaise), 'popup');
      if (!started.ok) return started;
      this.popup?.sent();
      return { ok: true, reach: (await started.outcome).reach } satisfies SubmitResult;
    });
    on(IPC.popupCancel, () => this.popup?.cancel());
    on(IPC.popupDone, () => this.popup?.done());

    handle(IPC.snapshot, () => this.snapshot());
    handle(IPC.updateConfig, (patch: ConfigPatch) => {
      if (typeof patch !== 'object' || patch === null) throw new Error('Bad config patch');
      return this.config.update(patch);
    });
    handle(IPC.showAmount, (amountPaise: number) => this.show(Number(amountPaise), 'popup'));
    handle(IPC.clear, () => this.clear());
    on(IPC.testPattern, (id: string) => this.displays.testPattern(String(id)));
    on(IPC.openSimulator, () => this.simulator.show());
    handle(IPC.regeneratePairing, (id: string) => {
      const code = secrets.pairingCode();
      const displays = this.config.get().displays.map((d) => (d.id === id && d.driver === 'web' ? { ...d, pairingCode: code } : d));
      this.config.update({ displays });
      return code;
    });
    on(IPC.suspendShortcuts, (suspended: boolean) => this.shortcuts.setSuspended(Boolean(suspended)));
    handle(IPC.pickLogo, async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: t('app.dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
      });
      const source = result.filePaths[0];
      if (result.canceled || !source) return null;
      mkdirSync(userDir('content'), { recursive: true });
      const target = userDir('content', `logo${extname(source).toLowerCase()}`);
      copyFileSync(source, target);
      this.config.update({ brand: { logoPath: target } });
      return target;
    });

    handle(IPC.pickImage, async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: t('app.dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      const source = result.filePaths[0];
      if (result.canceled || !source) return null;
      mkdirSync(userDir('content', 'images'), { recursive: true });
      const name = `${randomBytes(8).toString('hex')}${extname(source).toLowerCase()}`;
      copyFileSync(source, userDir('content', 'images', name));
      return `/content/images/${name}`;
    });
    handle(IPC.backupConfig, async () => {
      const result = await dialog.showSaveDialog({
        defaultPath: `counter-pay-settings-${localDay(new Date())}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      writeFileSync(result.filePath, `${JSON.stringify(this.config.get(), null, 2)}\n`, 'utf8');
      return { saved: true, path: result.filePath };
    });
    handle(IPC.restoreConfig, async () => {
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
      const source = result.filePaths[0];
      if (result.canceled || !source) return { restored: false };
      try {
        const parsed = JSON.parse(readFileSync(source, 'utf8')) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Not a settings file');
        // Replace arrays and objects wholesale; normalizeConfig repairs anything missing or wrong.
        this.config.update(parsed as ConfigPatch);
        return { restored: true };
      } catch (error) {
        return { restored: false, error: (error as Error).message };
      }
    });

    on(IPC.openLogs, () => void shell.openPath(logDir()));
    handle(IPC.listSerialPorts, () => listPorts().catch(() => []));
    handle(IPC.wifiDiscover, async (): Promise<WifiDisplayFound[]> => {
      const displays = this.config.get().displays;
      return (await discover()).map((found) => ({
        ...found,
        added: displays.some((d) => d.driver === 'wifi-frame' && d.device === found.id),
      }));
    });
    handle(IPC.wifiPair, (address: string, code: string) => this.pairWifi(String(address), String(code)));
    handle(IPC.wifiForget, (id: string, force?: boolean) => this.forgetWifi(String(id), force === true));
    handle(IPC.updateCheck, () => this.updater.check());
    handle(IPC.updateInstall, () => this.installUpdate());
    handle(IPC.whatsNewDismiss, () => {
      this.state.set('seenVersion', app.getVersion());
      this.pushSnapshot();
    });

    handle(IPC.historyQuery, (filter: HistoryFilter) => this.historyPage(filter ?? {}));
    handle(IPC.historyExport, async (filter: HistoryFilter) => {
      const result = await dialog.showSaveDialog({
        defaultPath: `counter-pay-history-${localDay(new Date())}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      const events = this.history.query({ ...(filter ?? {}), limit: 50_000 }).reverse();
      const pad = (n: number) => String(n).padStart(2, '0');
      const csv = historyToCsv(events, this.csvLabels(), {
        date: (ms) => localDay(new Date(ms)),
        time: (ms) => {
          const d = new Date(ms);
          return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },
      });
      writeFileSync(result.filePath, csv, 'utf8');
      return { saved: true, path: result.filePath };
    });
    handle(IPC.historyReshow, async (id: number) => {
      const event = this.history.get(Number(id));
      if (!event) return { ok: false, error: 'invalid' } satisfies SubmitResult;
      return this.show(event.amountPaise, 'popup');
    });

    handle(IPC.payeeInspect, (text: string): PayeeImportResult => {
      try {
        return { ok: true, payee: readPayee(String(text)) };
      } catch (error) {
        return { ok: false, issue: error instanceof UpiError ? error.issue : 'notUpi' };
      }
    });
    handle(IPC.payeeSave, (baseUri: string, payeeLabel: string) => {
      const payee = readPayee(String(baseUri));
      this.config.update({ upi: { baseUri: payee.baseUri, payeeLabel: String(payeeLabel || payee.name) } });
    });
    handle(IPC.onboardingTest, (answer: 'locked' | 'editable' | 'mixed') => {
      if (!['locked', 'editable', 'mixed'].includes(answer)) throw new Error('Bad answer');
      this.state.set('amountLockTest', { answer, testedAt: Date.now() });
      this.pushSnapshot();
    });
    handle(IPC.onboardingComplete, () => {
      this.state.set('onboardingCompleted', true);
      this.pushSnapshot();
    });
  }

  /** Only our own windows may call the agent. */
  private trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const url = event.senderFrame?.url ?? '';
    return url.startsWith('file://') || (!app.isPackaged && url.startsWith('http://localhost:'));
  }

  // ---------- Misc ----------

  private applyLoginItem(config: CounterPayConfig): void {
    // Only the installed app registers itself; a dev build would register electron.exe.
    if (!app.isPackaged) return;
    app.setLoginItemSettings({ openAtLogin: config.startAtLogin, args: ['--hidden'] });
  }

  private safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error(`[agent] ${what} failed`, error);
    }
  }
}
