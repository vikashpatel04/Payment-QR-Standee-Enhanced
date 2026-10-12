import type { AppSnapshot } from '@shared/api';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/api';
import { useLanguage } from '../shared/i18n';
import styles from './app.module.css';
import { Icon, type IconName, Mark } from './components/Icon';
import { Keys } from './components/ShortcutRecorder';
import { useSnapshot } from './hooks';
import { Content } from './pages/Content';
import { Displays } from './pages/Displays';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Onboarding } from './pages/Onboarding';
import { Settings } from './pages/Settings';

export type Page = 'home' | 'history' | 'displays' | 'content' | 'settings';

const NAV: Array<{ page: Page; icon: IconName }> = [
  { page: 'home', icon: 'home' },
  { page: 'history', icon: 'history' },
  { page: 'displays', icon: 'displays' },
  { page: 'content', icon: 'content' },
  { page: 'settings', icon: 'settings' },
];

function Sidebar({ page, go, snapshot }: { page: Page; go: (page: Page) => void; snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const { summon, clear, paused } = snapshot.shortcuts;
  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <Mark />
        <span>Counter Pay</span>
      </div>
      <div className={styles.nav}>
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            className={page === item.page ? styles.navOn : styles.navItem}
            onClick={() => go(item.page)}
            aria-current={page === item.page ? 'page' : undefined}
          >
            <Icon name={item.icon} />
            {t(`app.nav.${item.page}`)}
          </button>
        ))}
      </div>
      <div className={styles.reminder}>
        {paused ? (
          <span className={styles.paused}>{t('app.home.paused')}</span>
        ) : (
          <>
            <div className={styles.reminderRow}>
              <Keys accelerator={summon.accelerator} />
              <span>{t('app.home.summon')}</span>
            </div>
            <div className={styles.reminderRow}>
              <Keys accelerator={clear.accelerator} />
              <span>{t('app.home.clear')}</span>
            </div>
          </>
        )}
        {snapshot.update.status === 'ready' && (
          <button
            type="button"
            className={styles.update}
            disabled={snapshot.scene.kind === 'pay'}
            title={snapshot.scene.kind === 'pay' ? t('app.update.busy') : undefined}
            onClick={() => void api.app.updates.install()}
          >
            {t('app.update.sidebar', { version: snapshot.update.version ?? '' })}
          </button>
        )}
        <div className={styles.version}>v{snapshot.version}</div>
      </div>
    </nav>
  );
}

export function App() {
  const snapshot = useSnapshot();
  useLanguage(snapshot?.config.language.app);
  const [page, setPage] = useState<Page>('home');

  if (!snapshot) return <div className={styles.loading} />;
  if (!snapshot.onboarding.completed) return <Onboarding snapshot={snapshot} />;

  return (
    <div className={styles.shell}>
      <Sidebar page={page} go={setPage} snapshot={snapshot} />
      <main className={styles.main}>
        {page === 'home' && <Home snapshot={snapshot} go={setPage} />}
        {page === 'history' && <History snapshot={snapshot} />}
        {page === 'displays' && <Displays snapshot={snapshot} />}
        {page === 'content' && <Content snapshot={snapshot} />}
        {page === 'settings' && <Settings snapshot={snapshot} />}
      </main>
    </div>
  );
}
