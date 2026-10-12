import type { DisplayConfig, Rotation } from '@counterpay/core';
import type { AppSnapshot, DisplayView } from '@shared/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import { Icon } from '../components/Icon';
import { Preview } from '../components/Preview';
import { StatusChip } from '../components/Status';
import { Toggle } from '../components/Toggle';
import { updateConfig, useDraft } from '../hooks';
import ui from '../ui.module.css';
import styles from './pages.module.css';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

function uniqueId(base: string, displays: DisplayConfig[]): string {
  let n = 1;
  while (displays.some((d) => d.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function newDisplay(kind: 'window' | 'web', snapshot: AppSnapshot, name: string): DisplayConfig {
  const displays = snapshot.config.displays;
  if (kind === 'window') {
    const secondary = snapshot.monitors.find((m) => !m.primary);
    return { id: uniqueId('monitor', displays), driver: 'window', enabled: true, name, monitor: secondary?.index ?? 2, rotation: 0 };
  }
  return { id: uniqueId('phone', displays), driver: 'web', enabled: true, name };
}

function patchDisplay(snapshot: AppSnapshot, id: string, patch: Partial<DisplayConfig>): void {
  updateConfig({ displays: snapshot.config.displays.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
}

function NameField({ view, snapshot }: { view: DisplayView; snapshot: AppSnapshot }) {
  const draft = useDraft(view.config.name ?? view.config.id, (name) => patchDisplay(snapshot, view.config.id, { name }));
  return <input className={styles.displayName} aria-label="Name" {...draft} />;
}

function DisplayCard({ view, snapshot }: { view: DisplayView; snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { config, status } = view;
  const secondary = snapshot.monitors.filter((m) => !m.primary);

  return (
    <div className={`${ui.card} ${styles.displayCard}`}>
      <Preview view={view} snapshot={snapshot} height={150} />
      <div className={styles.displayBody}>
        <div className={ui.spread}>
          <div className={ui.stack} style={{ gap: 2 }}>
            <NameField view={view} snapshot={snapshot} />
            <span className={ui.small}>{t(`app.displays.kind.${config.driver}`)}</span>
          </div>
          <div className={ui.row}>
            <StatusChip status={status} enabled={config.enabled} />
            <Toggle
              on={config.enabled}
              label={t('app.displays.enabled')}
              onChange={(enabled) => patchDisplay(snapshot, config.id, { enabled })}
            />
          </div>
        </div>

        {config.driver === 'simulator' && <div className={ui.small}>{t('app.displays.simulatorHint')}</div>}

        {config.driver === 'window' && (
          <div className={ui.row}>
            <label className={ui.field}>
              <span className={ui.label}>{t('app.displays.monitor')}</span>
              <select
                className={ui.select}
                value={config.monitor ?? 2}
                onChange={(e) => patchDisplay(snapshot, config.id, { monitor: Number(e.target.value) })}
              >
                {secondary.map((m) => (
                  <option key={m.index} value={m.index}>
                    {m.index}. {m.label} ({m.width} × {m.height})
                  </option>
                ))}
                {secondary.length === 0 && <option value={config.monitor ?? 2}>{t('app.displays.noSecondMonitor')}</option>}
              </select>
            </label>
            <label className={ui.field}>
              <span className={ui.label}>{t('app.displays.rotation')}</span>
              <select
                className={ui.select}
                value={config.rotation ?? 0}
                onChange={(e) => patchDisplay(snapshot, config.id, { rotation: Number(e.target.value) as Rotation })}
              >
                {ROTATIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}°
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {config.driver === 'window' && secondary.length === 0 && <div className={ui.small}>{t('app.displays.plugIn')}</div>}

        {config.driver === 'web' && (
          <div className={styles.pairing}>
            <div>
              <div className={ui.label}>{t('app.displays.pairingCode')}</div>
              <div className={styles.pairCode}>{config.pairingCode}</div>
            </div>
            <div className={ui.stack} style={{ gap: 4, minWidth: 0 }}>
              <span className={ui.small}>{t('app.displays.openOnPhone')}</span>
              {snapshot.lanUrls.map((url) => (
                <span key={url} className={ui.mono}>
                  {url}
                </span>
              ))}
              {snapshot.lanUrls.length === 0 && <span className={ui.small}>{t('app.displays.noNetwork')}</span>}
              <span className={ui.small}>{t('app.displays.paired', { count: status.clients })}</span>
            </div>
          </div>
        )}

        {(config.driver === 'serial-frame' || config.driver === 'serial-smart') && (
          <div className={ui.small}>{t('app.displays.phase2')}</div>
        )}

        <div className={ui.row}>
          {config.driver !== 'simulator' && config.enabled && (
            <button type="button" className={ui.button} onClick={() => api.app.testPattern(config.id)}>
              {t('app.displays.testPattern')}
            </button>
          )}
          {config.driver === 'simulator' && (
            <button type="button" className={ui.button} onClick={() => api.app.openSimulator()}>
              {t('app.home.openSimulator')}
            </button>
          )}
          {config.driver === 'web' && (
            <button type="button" className={ui.ghost} onClick={() => void api.app.regeneratePairingCode(config.id)}>
              {t('app.displays.newCode')}
            </button>
          )}
          {config.driver !== 'simulator' && (
            <button
              type="button"
              className={ui.danger}
              onClick={() => updateConfig({ displays: snapshot.config.displays.filter((d) => d.id !== config.id) })}
            >
              {t('app.displays.remove')}
            </button>
          )}
          {status.lastAckMs !== undefined && <span className={ui.small}>{t('app.displays.lastAck', { ms: status.lastAckMs })}</span>}
          {status.fw && <span className={ui.small}>fw {status.fw}</span>}
        </div>
      </div>
    </div>
  );
}

export function Displays({ snapshot }: { snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);

  const add = (kind: 'window' | 'web') => {
    setMenu(false);
    updateConfig({ displays: [...snapshot.config.displays, newDisplay(kind, snapshot, t(`app.displays.kind.${kind}`))] });
  };

  return (
    <div className={ui.page}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('app.nav.displays')}</h1>
          <p className={ui.lead}>{t('app.displays.lead')}</p>
        </div>
        <div className={styles.menu}>
          <button type="button" className={ui.primary} onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Icon name="plus" size={16} />
            {t('app.displays.add')}
          </button>
          {menu && (
            <div className={styles.menuList} role="menu">
              <button type="button" className={styles.menuItem} onClick={() => add('window')} role="menuitem">
                <strong>{t('app.displays.kind.window')}</strong>
                <span className={ui.small}>{t('app.displays.addWindow')}</span>
              </button>
              <button type="button" className={styles.menuItem} onClick={() => add('web')} role="menuitem">
                <strong>{t('app.displays.kind.web')}</strong>
                <span className={ui.small}>{t('app.displays.addWeb')}</span>
              </button>
              <button type="button" className={styles.menuItem} disabled role="menuitem">
                <strong>{t('app.displays.addUsb')}</strong>
                <span className={ui.small}>{t('app.displays.phase2')}</span>
              </button>
            </div>
          )}
        </div>
      </header>
      {snapshot.config.displays.map((view) => {
        const display = snapshot.displays.find((d) => d.config.id === view.id);
        return display ? <DisplayCard key={view.id} view={display} snapshot={snapshot} /> : null;
      })}
    </div>
  );
}
