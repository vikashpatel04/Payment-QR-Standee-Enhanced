import { formatINR } from '@counterpay/core';
import type { AppSnapshot } from '@shared/api';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import type { Page } from '../App';
import { AmountBox } from '../components/AmountBox';
import { Preview } from '../components/Preview';
import { Keys } from '../components/ShortcutRecorder';
import { StatusChip } from '../components/Status';
import { useNow } from '../hooks';
import ui from '../ui.module.css';
import styles from './pages.module.css';

function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function SceneBadge({ snapshot }: { snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const now = useNow();
  const { scene } = snapshot;
  if (scene.kind === 'pay') {
    return (
      <span className={styles.sceneLive}>
        {t('app.home.showingPay', { amount: formatINR(scene.amountPaise ?? 0) })}
        <span className={ui.num}> · {t('app.home.left', { time: countdown((scene.expiresAt ?? now) - now) })}</span>
      </span>
    );
  }
  return <span className={styles.scene}>{t(scene.kind === 'thanks' ? 'app.home.showingThanks' : 'app.home.showingAmbient')}</span>;
}

export function Home({ snapshot, go }: { snapshot: AppSnapshot; go: (page: Page) => void }) {
  const { t } = useTranslation();
  const { config, shortcuts, today, onboarding } = snapshot;
  const enabled = snapshot.displays.filter((d) => d.config.enabled);
  const refused = [shortcuts.summon, shortcuts.clear].filter((s) => !s.registered && !shortcuts.paused);

  return (
    <div className={ui.page}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('app.nav.home')}</h1>
          <p className={ui.lead}>{config.brand.shopName || snapshot.payee?.name || t('app.home.noShop')}</p>
        </div>
        <SceneBadge snapshot={snapshot} />
      </header>

      {snapshot.whatsNew && (
        <div className={styles.whatsNew}>
          <span>{t('app.update.whatsNew', { version: snapshot.whatsNew.version })}</span>
          <div className={ui.row}>
            {snapshot.whatsNew.url && (
              <a className={ui.button} href={snapshot.whatsNew.url} target="_blank" rel="noreferrer">
                {t('app.update.whatsNewLink')}
              </a>
            )}
            <button type="button" className={ui.ghost} onClick={() => void api.app.updates.dismissWhatsNew()}>
              {t('app.update.dismiss')}
            </button>
          </div>
        </div>
      )}
      {snapshot.serverError && <div className={ui.bannerBad}>{snapshot.serverError}</div>}
      {!snapshot.payee && (
        <div className={ui.bannerBad}>
          {t('app.home.noPayee')}
          <button type="button" className={ui.button} onClick={() => go('settings')}>
            {t('app.home.setUp')}
          </button>
        </div>
      )}
      {refused.map((s) => (
        <div key={s.accelerator} className={ui.banner}>
          {t('app.shortcut.refused', { key: s.accelerator })}
          <button type="button" className={ui.button} onClick={() => go('settings')}>
            {t('app.home.change')}
          </button>
        </div>
      ))}

      <section className={ui.section}>
        <div className={ui.spread}>
          <h2 className={ui.sectionTitle}>{t('app.home.displays')}</h2>
          <button type="button" className={ui.ghost} onClick={() => api.app.openSimulator()}>
            {t('app.home.openSimulator')}
          </button>
        </div>
        <div className={styles.previews}>
          {enabled.map((view) => (
            <div key={view.config.id} className={styles.previewCard}>
              <Preview view={view} snapshot={snapshot} height={210} />
              <div className={styles.previewMeta}>
                <span className={styles.previewName}>{view.config.name ?? view.config.id}</span>
                <StatusChip status={view.status} enabled />
              </div>
            </div>
          ))}
          {enabled.length === 0 && <div className={ui.empty}>{t('app.home.noDisplays')}</div>}
        </div>
      </section>

      <div className={ui.grid2}>
        <div className={ui.card}>
          <h2 className={ui.cardTitle}>{t('app.home.showAmount')}</h2>
          <AmountBox maxRupees={config.pay.maxRupees} />
          <div className={ui.row} style={{ marginTop: 12 }}>
            <button type="button" className={ui.button} onClick={() => void api.app.clear()} disabled={snapshot.scene.kind !== 'pay'}>
              {t('tray.clear')}
            </button>
            {enabled.map((view) =>
              view.config.driver === 'simulator' ? null : (
                <button key={view.config.id} type="button" className={ui.ghost} onClick={() => api.app.testPattern(view.config.id)}>
                  {t('app.home.testPattern', { name: view.config.name ?? view.config.id })}
                </button>
              ),
            )}
          </div>
        </div>

        <div className={ui.card}>
          <h2 className={ui.cardTitle}>{t('app.home.today')}</h2>
          <div className={ui.row} style={{ gap: 28 }}>
            <div>
              <div className={ui.stat}>{today.count}</div>
              <div className={ui.small}>{t('app.home.qrsShown')}</div>
            </div>
            <div>
              <div className={ui.stat}>{formatINR(today.totalPaise)}</div>
              <div className={ui.small}>{t('app.home.totalShown')}</div>
            </div>
          </div>
          <div className={ui.small} style={{ marginTop: 10 }}>
            {t('app.home.notPayments')}
          </div>
        </div>
      </div>

      <div className={ui.grid2}>
        <div className={ui.card}>
          <h2 className={ui.cardTitle}>{t('app.home.shortcuts')}</h2>
          <div className={ui.stack}>
            <div className={ui.spread}>
              <span>{t('app.home.summon')}</span>
              <Keys accelerator={shortcuts.summon.accelerator} />
            </div>
            <div className={ui.spread}>
              <span>{t('app.home.clear')}</span>
              <Keys accelerator={shortcuts.clear.accelerator} />
            </div>
            <div className={ui.small}>{t('app.home.shortcutHint')}</div>
          </div>
        </div>
        <div className={ui.card}>
          <h2 className={ui.cardTitle}>{t('app.home.lockTest')}</h2>
          {onboarding.amountLockTest ? (
            <div className={ui.stack}>
              <span className={onboarding.amountLockTest.answer === 'locked' ? ui.chipOk : ui.chipWarn}>
                {t(`app.test.result.${onboarding.amountLockTest.answer}`)}
              </span>
              <span className={ui.small}>{t(`app.test.meaning.${onboarding.amountLockTest.answer}`)}</span>
            </div>
          ) : (
            <span className={ui.small}>{t('app.home.lockTestNone')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
