import { Menu, nativeImage, Tray } from 'electron';
import { t } from './i18n';
import { iconPath } from './paths';

export interface TrayActions {
  open(): void;
  showAmount(): void;
  clear(): void;
  togglePause(): void;
  isPaused(): boolean;
  quit(): void;
}

export class AppTray {
  private readonly tray: Tray;

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(nativeImage.createFromPath(iconPath('tray.png')));
    this.tray.on('click', () => actions.open());
    this.refresh();
  }

  /** Rebuilds the menu, e.g. after the language changes or shortcuts are paused. */
  refresh(): void {
    this.tray.setToolTip(t('tray.tooltip'));
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.open'), click: () => this.actions.open() },
        { type: 'separator' },
        { label: t('tray.show'), click: () => this.actions.showAmount() },
        { label: t('tray.clear'), click: () => this.actions.clear() },
        { label: t('tray.pause'), type: 'checkbox', checked: this.actions.isPaused(), click: () => this.actions.togglePause() },
        { type: 'separator' },
        // TODO(phase-3): electron-updater with Stable and Beta channels.
        { label: t('tray.updates'), enabled: false },
        { label: t('tray.quit'), click: () => this.actions.quit() },
      ]),
    );
  }

  dispose(): void {
    this.tray.destroy();
  }
}
