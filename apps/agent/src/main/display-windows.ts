import type { Rotation } from '@counterpay/core';
import type { WindowHost } from '@counterpay/drivers';
import { BrowserWindow, type Display, screen } from 'electron';
import type { MonitorInfo } from '../shared/api';

/** Primary first, then left to right, so "monitor 2" is the screen most people mean. */
function orderedDisplays(): Display[] {
  const primary = screen.getPrimaryDisplay();
  const others = screen
    .getAllDisplays()
    .filter((d) => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [primary, ...others];
}

export function listMonitors(): MonitorInfo[] {
  return orderedDisplays().map((d, i) => ({
    index: i + 1,
    label: d.label || `${d.size.width} × ${d.size.height}`,
    width: d.size.width,
    height: d.size.height,
    primary: i === 0,
  }));
}

/**
 * Full-screen display windows on secondary monitors. They are never focusable, so
 * they can't take focus from the billing software, and they never open on the cashier's own screen.
 */
export class ElectronWindowHost implements WindowHost {
  private readonly windows = new Map<string, BrowserWindow>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly pageUrl: (displayId: string, rotation: Rotation) => string) {
    const changed = () => this.listeners.forEach((listener) => listener());
    screen.on('display-added', changed);
    screen.on('display-removed', changed);
    screen.on('display-metrics-changed', changed);
  }

  open({ displayId, monitor, rotation }: { displayId: string; monitor: number; rotation: Rotation }): boolean {
    const target = orderedDisplays()[monitor - 1];
    if (!target || monitor === 1) {
      this.close(displayId);
      return false;
    }

    let win = this.windows.get(displayId);
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        ...target.bounds,
        frame: false,
        show: false,
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        hasShadow: false,
        backgroundColor: '#0c110f',
        title: 'Counter Pay display',
        webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
      });
      win.setMenu(null);
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      void win.loadURL(this.pageUrl(displayId, rotation));
      win.once('ready-to-show', () => win?.showInactive());
      win.on('closed', () => this.windows.delete(displayId));
      this.windows.set(displayId, win);
    }
    win.setBounds(target.bounds);
    if (!win.isVisible() && !win.webContents.isLoading()) win.showInactive();
    return true;
  }

  close(displayId: string): void {
    const win = this.windows.get(displayId);
    this.windows.delete(displayId);
    if (win && !win.isDestroyed()) win.destroy();
  }

  onMonitorsChanged(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  closeAll(): void {
    for (const id of [...this.windows.keys()]) this.close(id);
  }
}
