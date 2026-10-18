import type { DriverStatus } from '@counterpay/drivers';
import { useTranslation } from 'react-i18next';
import ui from '../ui.module.css';

/** A display's connection state in one chip. */
export function StatusChip({ status, enabled }: { status: DriverStatus; enabled: boolean }) {
  const { t } = useTranslation();
  if (!enabled) return <span className={ui.chip}>{t('app.status.off')}</span>;
  switch (status.state) {
    case 'connected':
      return <span className={ui.chipOk}>{t(status.kind === 'simulator' ? 'app.status.ready' : 'app.status.connected')}</span>;
    case 'waiting':
      return <span className={ui.chipWarn}>{t(status.detail === 'linkLost' ? 'app.status.linkLost' : 'app.status.waiting')}</span>;
    case 'unsupported':
      return <span className={ui.chip}>{t('app.status.phase2')}</span>;
    default:
      return (
        <span className={ui.chipBad}>
          {t(
            status.detail === 'monitorMissing'
              ? 'app.status.monitorMissing'
              : status.detail === 'panelSilent'
                ? 'app.status.panelSilent'
                : status.detail === 'unpaired'
                  ? 'app.status.unpaired'
                  : 'app.status.offline',
          )}
        </span>
      );
  }
}
