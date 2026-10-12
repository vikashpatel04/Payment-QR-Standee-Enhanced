import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron';
import type { UpdateState } from '../shared/api';
import { t } from './i18n';
import { iconPath } from './paths';

export interface TrayActions {
  open(): void;
  showAmount(): void;
  clear(): void;
  togglePause(): void;
  isPaused(): boolean;
  update(): UpdateState;
  checkUpdates(): void;
  installUpdate(): void;
  quit(): void;
}

export class AppTray {
  private readonly tray: Tray;
  private dot = false;

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(nativeImage.createFromPath(iconPath('tray.png')));
    this.tray.on('click', () => actions.open());
    this.refresh();
  }

  /** Rebuilds the menu, e.g. after the language changes, shortcuts are paused or an update is ready. */
  refresh(): void {
    const update = this.actions.update();
    const ready = update.status === 'ready';
    if (ready !== this.dot) {
      this.dot = ready;
      this.tray.setImage(nativeImage.createFromPath(iconPath(ready ? 'tray-dot.png' : 'tray.png')));
    }
    this.tray.setToolTip(ready ? `${t('tray.tooltip')} · ${t('tray.updateReady')}` : t('tray.tooltip'));

    const updateItem: MenuItemConstructorOptions = ready
      ? { label: t('tray.restart', { version: update.version ?? '' }), click: () => this.actions.installUpdate() }
      : { label: t('tray.updates'), enabled: update.status !== 'disabled', click: () => this.actions.checkUpdates() };

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.open'), click: () => this.actions.open() },
        { type: 'separator' },
        { label: t('tray.show'), click: () => this.actions.showAmount() },
        { label: t('tray.clear'), click: () => this.actions.clear() },
        { label: t('tray.pause'), type: 'checkbox', checked: this.actions.isPaused(), click: () => this.actions.togglePause() },
        { type: 'separator' },
        updateItem,
        { label: t('tray.quit'), click: () => this.actions.quit() },
      ]),
    );
  }

  dispose(): void {
    this.tray.destroy();
  }
}
