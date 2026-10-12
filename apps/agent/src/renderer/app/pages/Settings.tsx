import { formatINR } from '@counterpay/core';
import type { AppSnapshot, UpdateState } from '@shared/api';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import { PayeeImport } from '../components/PayeeImport';
import { ShortcutRecorder } from '../components/ShortcutRecorder';
import { Toggle } from '../components/Toggle';
import { updateConfig, useDraft } from '../hooks';
import ui from '../ui.module.css';

function Setting({ name, hint, children }: { name: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={ui.setting}>
      <div className={ui.settingText}>
        <span className={ui.settingName}>{name}</span>
        {hint && <span className={ui.small}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function PayeeLabel({ value, fallback }: { value: string; fallback: string }) {
  const draft = useDraft(value, (payeeLabel) => updateConfig({ upi: { payeeLabel } }));
  return <input className={ui.input} style={{ width: 240 }} placeholder={fallback} {...draft} />;
}

function MaxAmount({ value }: { value: number }) {
  const draft = useDraft(String(value), (next) => {
    const rupees = Math.round(Number(next));
    if (rupees > 0) updateConfig({ pay: { maxRupees: rupees } });
  });
  return <input className={ui.input} style={{ width: 130 }} inputMode="numeric" {...draft} />;
}

function Port({ value, commit }: { value: number; commit: (port: number) => void }) {
  const draft = useDraft(String(value), (next) => {
    const port = Math.round(Number(next));
    if (port >= 1024 && port <= 65535) commit(port);
  });
  return <input className={ui.input} style={{ width: 100 }} inputMode="numeric" {...draft} />;
}

function RefPrefix({ value }: { value: string }) {
  const draft = useDraft(value, (next) => {
    const prefix = next.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (prefix) updateConfig({ pay: { refPrefix: prefix } });
  });
  return <input className={ui.input} style={{ width: 90, textTransform: 'uppercase' }} maxLength={6} {...draft} />;
}

function updateLine(t: TFunction, update: UpdateState, version: string): string {
  switch (update.status) {
    case 'disabled':
      return t('app.update.status.disabled');
    case 'checking':
      return t('app.update.status.checking');
    case 'downloading':
      return t('app.update.status.downloading', { version: update.version ?? '', percent: update.percent ?? 0 });
    case 'ready':
      return t('app.update.status.ready', { version: update.version ?? '' });
    case 'latest':
      return t('app.update.status.latest', { version });
    case 'error':
      return t('app.update.status.error', { error: update.error ?? '' });
    default:
      return t('app.update.status.idle');
  }
}

/** App updates from GitHub Releases: they download by themselves and install only when the counter is quiet. */
function UpdatesCard({ snapshot }: { snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { config, update, scene } = snapshot;
  const [start, end] = config.updates.quietHours;
  const setQuiet = (index: 0 | 1, value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    const next: [string, string] = [start, end];
    next[index] = value;
    updateConfig({ updates: { quietHours: next } });
  };
  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>{t('app.update.title')}</h2>
      <Setting name={updateLine(t, update, snapshot.version)} hint={t('app.update.version', { version: snapshot.version })}>
        {update.status === 'ready' ? (
          <button
            type="button"
            className={ui.primary}
            disabled={scene.kind === 'pay'}
            title={scene.kind === 'pay' ? t('app.update.busy') : undefined}
            onClick={() => void api.app.updates.install()}
          >
            {t('app.update.restart')}
          </button>
        ) : (
          <button
            type="button"
            className={ui.button}
            disabled={update.status === 'disabled' || update.status === 'checking' || update.status === 'downloading'}
            onClick={() => void api.app.updates.check()}
          >
            {t('app.update.check')}
          </button>
        )}
      </Setting>
      <Setting name={t('app.update.quietHours')} hint={t('app.update.quietHint')}>
        <div className={ui.row}>
          <input className={ui.input} type="time" value={start} onChange={(e) => setQuiet(0, e.target.value)} aria-label={t('app.history.from')} />
          <span className={ui.muted}>–</span>
          <input className={ui.input} type="time" value={end} onChange={(e) => setQuiet(1, e.target.value)} aria-label={t('app.history.to')} />
        </div>
      </Setting>
      <Setting name={t('app.settings.updates')} hint={t('app.update.channelHint')}>
        <select
          className={ui.select}
          value={config.updates.channel}
          onChange={(e) => updateConfig({ updates: { channel: e.target.value === 'beta' ? 'beta' : 'stable' } })}
        >
          <option value="stable">{t('app.settings.stable')}</option>
          <option value="beta">{t('app.settings.beta')}</option>
        </select>
      </Setting>
    </section>
  );
}

export function Settings({ snapshot }: { snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { config, payee, shortcuts } = snapshot;
  const [changingPayee, setChangingPayee] = useState(!payee);
  const [revealToken, setRevealToken] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={ui.page}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('app.nav.settings')}</h1>
          <p className={ui.lead}>{t('app.settings.lead')}</p>
        </div>
      </header>

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>{t('app.settings.payee')}</h2>
        {payee && !changingPayee ? (
          <>
            <Setting name={payee.name || t('app.payee.noName')} hint={`${t('app.payee.upiId')}: ${payee.maskedVpa}`}>
              <button type="button" className={ui.button} onClick={() => setChangingPayee(true)}>
                {t('app.settings.changePayee')}
              </button>
            </Setting>
            {payee.hasSignature && <div className={ui.banner}>{t('app.payee.signed')}</div>}
            <Setting name={t('app.payee.label')} hint={t('app.payee.labelHint')}>
              <PayeeLabel value={config.upi.payeeLabel} fallback={payee.name} />
            </Setting>
          </>
        ) : (
          <PayeeImport compact onSaved={() => setChangingPayee(false)} />
        )}
      </section>

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>{t('app.settings.shortcuts')}</h2>
        <Setting name={t('app.home.summon')} hint={t('app.settings.summonHint')}>
          <ShortcutRecorder
            state={shortcuts.summon}
            other={shortcuts.clear.accelerator}
            onChange={(summon) => updateConfig({ shortcuts: { summon } })}
          />
        </Setting>
        <Setting name={t('app.home.clear')} hint={t('app.settings.clearHint')}>
          <ShortcutRecorder
            state={shortcuts.clear}
            other={shortcuts.summon.accelerator}
            onChange={(clear) => updateConfig({ shortcuts: { clear } })}
          />
        </Setting>
      </section>

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>{t('app.settings.payment')}</h2>
        <Setting name={t('app.settings.expiry')} hint={t('app.settings.expiryHint')}>
          <select className={ui.select} value={config.pay.ttlSeconds} onChange={(e) => updateConfig({ pay: { ttlSeconds: Number(e.target.value) } })}>
            {[60, 120, 180, 300, 600].map((s) => (
              <option key={s} value={s}>
                {t('app.settings.minutes', { count: s / 60 })}
              </option>
            ))}
          </select>
        </Setting>
        <Setting name={t('app.settings.max')} hint={t('app.settings.maxHint', { max: formatINR(config.pay.maxRupees * 100) })}>
          <MaxAmount value={config.pay.maxRupees} />
        </Setting>
        <Setting name={t('app.settings.prefix')} hint={t('app.settings.prefixHint', { example: `${config.pay.refPrefix}2610120042` })}>
          <RefPrefix value={config.pay.refPrefix} />
        </Setting>
        <Setting name={t('app.settings.mam')} hint={t('app.settings.mamHint')}>
          <Toggle on={config.upi.addMam} label={t('app.settings.mam')} onChange={(addMam) => updateConfig({ upi: { addMam } })} />
        </Setting>
      </section>

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>{t('app.settings.general')}</h2>
        <Setting name={t('app.settings.startAtLogin')} hint={t('app.settings.startAtLoginHint')}>
          <Toggle on={config.startAtLogin} label={t('app.settings.startAtLogin')} onChange={(startAtLogin) => updateConfig({ startAtLogin })} />
        </Setting>
        <Setting name={t('app.settings.retention')}>
          <select
            className={ui.select}
            value={config.history.retentionDays}
            onChange={(e) => updateConfig({ history: { retentionDays: Number(e.target.value) } })}
          >
            {[30, 90, 180, 365, 730, 1825].map((d) => (
              <option key={d} value={d}>
                {t('app.settings.days', { count: d })}
              </option>
            ))}
          </select>
        </Setting>
      </section>

      <UpdatesCard snapshot={snapshot} />

      <section className={ui.card}>
        <h2 className={ui.cardTitle}>{t('app.settings.advanced')}</h2>
        <Setting name={t('app.settings.apiToken')} hint={t('app.settings.apiHint')}>
          <div className={ui.row}>
            <span className={ui.mono}>{revealToken ? config.api.token : '•'.repeat(16)}</span>
            <button type="button" className={ui.ghost} onClick={() => setRevealToken((r) => !r)}>
              {t(revealToken ? 'app.settings.hide' : 'app.settings.show')}
            </button>
          </div>
        </Setting>
        <Setting name={t('app.settings.localPort')} hint={t('app.settings.portHint')}>
          <Port value={config.server.localPort} commit={(localPort) => updateConfig({ server: { localPort } })} />
        </Setting>
        <Setting name={t('app.settings.lanPort')} hint={t('app.settings.portHint')}>
          <Port value={config.server.lanPort} commit={(lanPort) => updateConfig({ server: { lanPort } })} />
        </Setting>
        <Setting name={t('app.settings.backup')} hint={t('app.settings.backupHint')}>
          <div className={ui.row}>
            <button
              type="button"
              className={ui.button}
              onClick={() => void api.app.backupConfig().then((r) => r.saved && setNotice(t('app.settings.backedUp', { path: r.path })))}
            >
              {t('app.settings.export')}
            </button>
            <button
              type="button"
              className={ui.button}
              onClick={() =>
                void api.app
                  .restoreConfig()
                  .then((r) => setNotice(r.restored ? t('app.settings.restored') : r.error ? t('app.settings.restoreFailed', { error: r.error }) : null))
              }
            >
              {t('app.settings.import')}
            </button>
          </div>
        </Setting>
        {notice && <div className={ui.small}>{notice}</div>}
      </section>
    </div>
  );
}
