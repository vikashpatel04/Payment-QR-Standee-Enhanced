import { type DisplayConfig, frameProfiles, type Rotation } from '@counterpay/core';
import type { AppSnapshot, DisplayView, WifiDisplayFound, WifiPairResult } from '@shared/api';
import { useEffect, useState } from 'react';
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

export type NewDisplayKind = 'window' | 'web' | 'usb';

export function newDisplay(kind: NewDisplayKind, snapshot: AppSnapshot, name: string): DisplayConfig {
  const displays = snapshot.config.displays;
  if (kind === 'usb') {
    return { id: uniqueId('usb', displays), driver: 'serial-frame', enabled: true, name, port: 'auto', profile: 'waveshare-2in13-v4', rotation: 0 };
  }
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

/** A USB E-ink display: which port, which panel, which way up. */
function UsbSettings({ view, snapshot }: { view: DisplayView; snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { config, status } = view;
  const [ports, setPorts] = useState<Array<{ path: string; label: string; usbSerial: boolean }>>([]);
  const refresh = () => void api.app.listSerialPorts().then(setPorts);
  useEffect(refresh, []);
  const connected = status.state === 'connected';
  const panelSilent = status.detail === 'panelSilent';
  return (
    <div className={ui.stack}>
      <div className={ui.row} style={{ alignItems: 'flex-end' }}>
        <label className={ui.field}>
          <span className={ui.label}>{t('app.displays.port')}</span>
          <select className={ui.select} value={config.port ?? 'auto'} onChange={(e) => patchDisplay(snapshot, config.id, { port: e.target.value })}>
            <option value="auto">{t('app.displays.portAuto')}</option>
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label.includes(p.path) ? p.label : `${p.path} · ${p.label}`}
              </option>
            ))}
            {config.port && config.port !== 'auto' && !ports.some((p) => p.path === config.port) && (
              <option value={config.port}>{config.port}</option>
            )}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t('app.displays.panel')}</span>
          <select className={ui.select} value={config.profile ?? 'waveshare-2in13-v4'} onChange={(e) => patchDisplay(snapshot, config.id, { profile: e.target.value })}>
            {frameProfiles().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t('app.displays.rotation')}</span>
          <select className={ui.select} value={config.rotation ?? 0} onChange={(e) => patchDisplay(snapshot, config.id, { rotation: Number(e.target.value) as Rotation })}>
            {ROTATIONS.map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={ui.ghost} onClick={refresh}>
          {t('app.displays.refreshPorts')}
        </button>
      </div>
      <div className={ui.small}>
        {connected
          ? t('app.displays.usbConnected', { port: status.port ?? '' })
          : panelSilent
            ? t('app.displays.usbPanelSilent', { port: status.port ?? '' })
            : config.enabled
              ? t('app.displays.usbLooking')
              : null}
      </div>
      {!connected && !panelSilent && config.enabled && <div className={ui.small}>{t('app.displays.usbFirmware')}</div>}
    </div>
  );
}

/** A paired Wi-Fi display: where it is, which panel, which way up. */
function WifiSettings({ view, snapshot }: { view: DisplayView; snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { config, status } = view;
  const connected = status.state === 'connected';
  let hint: string | null = null;
  if (connected) hint = t('app.displays.wifiConnected', { address: status.port ?? config.address ?? '' });
  else if (status.detail === 'unpaired') hint = t('app.displays.wifiUnpaired');
  else if (status.detail === 'panelSilent') hint = t('app.displays.usbPanelSilent', { port: status.port ?? config.address ?? '' });
  else if (config.enabled) hint = t('app.displays.wifiLooking', { address: config.address ?? '' });
  return (
    <div className={ui.stack}>
      <div className={ui.row}>
        <label className={ui.field}>
          <span className={ui.label}>{t('app.displays.panel')}</span>
          <select className={ui.select} value={config.profile ?? 'waveshare-2in13-v4'} onChange={(e) => patchDisplay(snapshot, config.id, { profile: e.target.value })}>
            {frameProfiles().map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t('app.displays.rotation')}</span>
          <select className={ui.select} value={config.rotation ?? 0} onChange={(e) => patchDisplay(snapshot, config.id, { rotation: Number(e.target.value) as Rotation })}>
            {ROTATIONS.map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </label>
      </div>
      {hint && <div className={ui.small}>{hint}</div>}
    </div>
  );
}

/** Finds displays on the shop network and pairs one with the code on its screen. */
function WifiPairing({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [found, setFound] = useState<WifiDisplayFound[] | null>(null);
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Extract<WifiPairResult, { ok: false }>['reason'] | null>(null);

  useEffect(() => {
    let alive = true;
    const look = () =>
      void api.app.wifi.discover().then((list) => {
        if (alive) setFound(list);
      });
    look();
    const timer = setInterval(look, 4_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const pair = async () => {
    setBusy(true);
    setError(null);
    const result = await api.app.wifi.pair(address, code);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.reason);
  };

  return (
    <div className={ui.card}>
      <div className={ui.spread}>
        <h2 className={ui.cardTitle}>{t('app.displays.wifi.title')}</h2>
        <button type="button" className={ui.ghost} onClick={onClose}>
          {t('app.displays.wifi.cancel')}
        </button>
      </div>
      <div className={ui.stack}>
        <p className={ui.small}>{t('app.displays.wifi.lead')}</p>
        {found === null && <div className={ui.small}>{t('app.displays.wifi.searching')}</div>}
        {found?.length === 0 && <div className={ui.small}>{t('app.displays.wifi.none')}</div>}
        {found?.map((d) => (
          <button
            key={d.id}
            type="button"
            className={address === d.address ? styles.choiceOn : styles.choice}
            disabled={d.added}
            onClick={() => {
              setAddress(d.address);
              setError(null);
            }}
          >
            <span className={styles.choiceTitle}>
              {d.name} · {d.w} × {d.h}
            </span>
            <span className={ui.small}>
              {d.address} ·{' '}
              {t(d.added ? 'app.displays.wifi.added' : d.paired ? 'app.displays.wifi.pairedElsewhere' : 'app.displays.wifi.ready')}
            </span>
          </button>
        ))}
        <div className={ui.row} style={{ alignItems: 'flex-end' }}>
          <label className={ui.field}>
            <span className={ui.label}>{t('app.displays.wifi.address')}</span>
            <input className={ui.input} value={address} placeholder="raspberrypi.local or 192.168.1.20" onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className={ui.field}>
            <span className={ui.label}>{t('app.displays.wifi.code')}</span>
            <input
              className={ui.input}
              value={code}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && address && code.length === 6 && void pair()}
            />
          </label>
          <button type="button" className={ui.primary} disabled={busy || !address || code.length !== 6} onClick={() => void pair()}>
            {t(busy ? 'app.displays.wifi.pairing' : 'app.displays.wifi.pair')}
          </button>
        </div>
        {error && <div className={ui.bannerBad}>{t(`app.displays.wifi.error.${error}`)}</div>}
      </div>
    </div>
  );
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
          <div className={ui.stack} style={{ gap: 2, flex: 1, minWidth: 0 }}>
            <NameField view={view} snapshot={snapshot} />
            <span className={ui.small}>
              {t(`app.displays.kind.${config.driver}`)}
              {(config.driver === 'serial-frame' || config.driver === 'wifi-frame') && <span className={ui.tag}>{t('app.displays.beta')}</span>}
            </span>
          </div>
          <div className={ui.row} style={{ flex: 'none' }}>
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

        {config.driver === 'serial-frame' && <UsbSettings view={view} snapshot={snapshot} />}
        {config.driver === 'wifi-frame' && <WifiSettings view={view} snapshot={snapshot} />}
        {config.driver === 'serial-smart' && <div className={ui.small}>{t('app.displays.phase2')}</div>}

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
              onClick={() =>
                config.driver === 'wifi-frame'
                  ? void api.app.wifi.forget(config.id)
                  : updateConfig({ displays: snapshot.config.displays.filter((d) => d.id !== config.id) })
              }
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
  const [pairing, setPairing] = useState(false);

  const add = (kind: NewDisplayKind) => {
    setMenu(false);
    updateConfig({ displays: [...snapshot.config.displays, newDisplay(kind, snapshot, t(`app.displays.kind.${kind === 'usb' ? 'serial-frame' : kind}`))] });
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
              <button
                type="button"
                className={styles.menuItem}
                onClick={() => {
                  setMenu(false);
                  setPairing(true);
                }}
                role="menuitem"
              >
                <strong>
                  {t('app.displays.kind.wifi-frame')}
                  <span className={ui.tag}>{t('app.displays.beta')}</span>
                </strong>
                <span className={ui.small}>{t('app.displays.addWifi')}</span>
              </button>
              <button type="button" className={styles.menuItem} onClick={() => add('usb')} role="menuitem">
                <strong>
                  {t('app.displays.kind.serial-frame')}
                  <span className={ui.tag}>{t('app.displays.beta')}</span>
                </strong>
                <span className={ui.small}>{t('app.displays.addUsb')}</span>
              </button>
            </div>
          )}
        </div>
      </header>
      {pairing && <WifiPairing onClose={() => setPairing(false)} />}
      {snapshot.config.displays.map((view) => {
        const display = snapshot.displays.find((d) => d.config.id === view.id);
        return display ? <DisplayCard key={view.id} view={display} snapshot={snapshot} /> : null;
      })}
    </div>
  );
}
