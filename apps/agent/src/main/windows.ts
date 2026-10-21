import { BrowserWindow, nativeTheme, screen, shell } from 'electron';
import { IPC, type PopupOpenInfo, type ToastMessage } from '../shared/api';
import { iconPath, preloadPath, rendererUrl } from './paths';
import type { Platform } from './platform';

/** The pill is 360 × 88; the window adds room for its shadow and the 12 px rise. */
const PILL = { w: 360, h: 88 };
const POPUP = { w: 400, h: 136, top: 28 };
const TOAST = { w: 280, h: 72 };
/** Gap between the bottom of the pill and the taskbar. */
const ABOVE_TASKBAR = 96;

function load(win: BrowserWindow, page: 'popup' | 'toast' | 'app'): void {
  const target = rendererUrl(page);
  if ('url' in target) void win.loadURL(target.url);
  else void win.loadFile(target.file);
}

function lockDown(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) event.preventDefault();
  });
}

/** Bottom-centre of the work area of the screen the cursor is on. */
function bottomCentre(width: number, height: number, bottomInset: number) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - ABOVE_TASKBAR - bottomInset),
    width,
    height,
  };
}

type PopupPhase = 'hidden' | 'open' | 'sent';

/**
 * The Wispr Flow–style amount pill. Created once at launch and never destroyed, so
 * summoning it is instant. It remembers which window had focus (the billing software) and always
 * gives focus back.
 */
export class PopupWindow {
  private readonly win: BrowserWindow;
  private phase: PopupPhase = 'hidden';
  private previous: unknown = null;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(private readonly platform: Platform) {
    this.win = new BrowserWindow({
      width: POPUP.w,
      height: POPUP.h,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'Counter Pay',
      webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setMenu(null);
    lockDown(this.win);
    load(this.win, 'popup');
    this.win.on('blur', () => this.onBlur());
  }

  get isOpen(): boolean {
    return this.phase === 'open';
  }

  open(info: PopupOpenInfo): void {
    this.clearHideTimer();
    if (this.phase !== 'open') this.previous = this.platform.captureForeground();
    this.phase = 'open';
    this.win.setBounds(bottomCentre(POPUP.w, POPUP.h, POPUP.top + PILL.h));
    this.win.webContents.send(IPC.popupOpen, info);
    this.win.show();
    this.win.focus();
    this.win.webContents.focus();
  }

  /** Esc: close and give focus back. */
  cancel(): void {
    if (this.phase === 'hidden') return;
    this.phase = 'hidden';
    this.win.hide();
    this.platform.restoreForeground(this.previous);
  }

  /**
   * Enter accepted: focus goes back at once. The pill stays on screen, without focus, until
   * the displays confirm (an E-ink panel takes seconds) and it has played "Sent".
   */
  sent(): void {
    if (this.phase !== 'open') return;
    this.phase = 'sent';
    if (!this.platform.restoreForeground(this.previous)) console.warn('[popup] Windows refused to give focus back after Enter');
    this.win.blur();
    // Only if the displays never answer at all.
    this.hideTimer = setTimeout(() => this.done(), 20_000);
  }

  /** The displays answered: the pill now plays "Sent" and fades. */
  confirmed(): void {
    if (this.phase !== 'sent') return;
    this.clearHideTimer();
    // In case the renderer never reports the end of its animation.
    this.hideTimer = setTimeout(() => this.done(), 1500);
  }

  /** The sent animation finished. */
  done(): void {
    this.clearHideTimer();
    if (this.phase === 'open') return;
    const wasSent = this.phase === 'sent';
    this.phase = 'hidden';
    this.win.hide();
    // While the pill waited for the displays (an E-ink panel takes seconds), one of this app's
    // own windows may have taken focus. Give it back to where the cashier was, but only if
    // focus is still ours or nobody's, so a click into another program is never overridden.
    if (wasSent && this.platform.foregroundIsOursOrNone()) {
      console.warn('[popup] focus was with Counter Pay after the QR was sent; giving it back');
      this.platform.restoreForeground(this.previous);
    }
  }

  private onBlur(): void {
    if (this.phase !== 'open') return;
    // A click somewhere else cancels, like Esc. Focus goes back only if that click
    // didn't land on another app, so we never fight the cashier's own click.
    this.phase = 'hidden';
    this.win.hide();
    if (this.platform.foregroundIsOursOrNone()) this.platform.restoreForeground(this.previous);
  }

  private clearHideTimer(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}

/**
 * "QR cleared" and friends. Never focusable, shown inactive: it can't take focus from the billing software.
 * Created on first use and closed after a minute unused, to keep the idle agent small.
 */
export class ToastWindow {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private closeTimer: NodeJS.Timeout | null = null;

  async show(message: ToastMessage): Promise<void> {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    const win = this.ensure();
    await this.ready;
    if (win.isDestroyed()) return;
    win.setBounds(bottomCentre(TOAST.w, TOAST.h, TOAST.h));
    win.webContents.send(IPC.toastShow, message);
    win.showInactive();
    // 0.9 s on screen plus the fade.
    this.hideTimer = setTimeout(() => {
      if (!win.isDestroyed()) win.hide();
      this.closeTimer = setTimeout(() => this.close(), 60_000);
    }, 1200);
  }

  private close(): void {
    const win = this.win;
    this.win = null;
    this.ready = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = new BrowserWindow({
      width: TOAST.w,
      height: TOAST.h,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setMenu(null);
    lockDown(win);
    this.ready = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()));
    load(win, 'toast');
    this.win = win;
    return win;
  }
}

/** The hub: Home, History, Displays, Content, Settings. Closing it never stops the agent. */
export class MainWindow {
  private win: BrowserWindow | null = null;

  show(): void {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 820,
      minHeight: 560,
      show: false,
      title: 'Counter Pay',
      icon: iconPath('icon.png'),
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#111614' : '#f5f6f4',
      webPreferences: { preload: preloadPath(), sandbox: true, contextIsolation: true },
    });
    win.setMenu(null);
    lockDown(win);
    load(win, 'app');
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.win = win;
  }

  send(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }
}

/** A customer-screen window on this PC, for trying Counter Pay with no extra hardware. */
export class SimulatorWindow {
  private win: BrowserWindow | null = null;

  constructor(private readonly url: () => string) {}

  /** Only ever opened by a click in Counter Pay itself, so it may take focus like any window. */
  show(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      return;
    }
    const win = new BrowserWindow({
      width: 340,
      height: 540,
      minWidth: 220,
      minHeight: 300,
      show: false,
      title: 'Counter Pay simulator',
      icon: iconPath('icon.png'),
      autoHideMenuBar: true,
      backgroundColor: '#0c110f',
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    win.setMenu(null);
    lockDown(win);
    void win.loadURL(this.url());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.win = win;
  }
}
