import { durationSeconds, type EndReason, formatINR } from '@counterpay/core';
import type { AppSnapshot, HistoryFilter, HistoryPage } from '@shared/api';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import ui from '../ui.module.css';
import styles from './pages.module.css';

type Range = 'today' | 'week' | 'custom';
const REASONS: Array<EndReason | 'open'> = ['cleared', 'replaced', 'expired', 'link-lost', 'bill-saved', 'open'];

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function toInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : undefined;
}

/** Every QR ever shown: what was shown, not what was paid. */
export function History({ snapshot }: { snapshot: AppSnapshot }) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<Range>('today');
  const [from, setFrom] = useState(toInput(Date.now() - 6 * 86_400_000));
  const [to, setTo] = useState(toInput(Date.now()));
  const [minRupees, setMinRupees] = useState('');
  const [maxRupees, setMaxRupees] = useState('');
  const [reason, setReason] = useState<EndReason | 'open' | ''>('');
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filter = useMemo((): HistoryFilter => {
    const today = dayStart(new Date());
    const f: HistoryFilter = {};
    if (range === 'today') f.from = today;
    if (range === 'week') f.from = today - 6 * 86_400_000;
    if (range === 'custom') {
      const start = fromInput(from);
      const end = fromInput(to);
      if (start !== undefined) f.from = start;
      if (end !== undefined) f.to = end + 86_400_000;
    }
    if (minRupees) f.minPaise = Math.round(Number(minRupees) * 100);
    if (maxRupees) f.maxPaise = Math.round(Number(maxRupees) * 100);
    if (reason) f.reasons = [reason];
    return f;
  }, [range, from, to, minRupees, maxRupees, reason]);

  const load = useCallback(() => void api.app.history.query(filter).then(setPage), [filter]);

  // Reload when the filter changes and whenever a QR starts or ends.
  useEffect(load, [load, snapshot.scene.shownAt, snapshot.today.count]);

  const locale = i18n.language === 'ta' ? 'ta-IN' : 'en-IN';
  const time = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  const exportCsv = async () => {
    const result = await api.app.history.exportCsv(filter);
    setNotice(result.saved ? t('app.history.exported', { path: result.path }) : null);
  };

  return (
    <div className={ui.page}>
      <header className={ui.header}>
        <div>
          <h1 className={ui.title}>{t('app.nav.history')}</h1>
          <p className={ui.lead}>{t('app.history.lead')}</p>
        </div>
        <button type="button" className={ui.button} onClick={() => void exportCsv()} disabled={!page?.events.length}>
          {t('app.history.export')}
        </button>
      </header>
      {notice && <div className={ui.small}>{notice}</div>}

      <div className={styles.filters}>
        <div className={styles.segment} role="tablist">
          {(['today', 'week', 'custom'] as const).map((r) => (
            <button key={r} type="button" className={range === r ? styles.segmentOn : styles.segmentItem} onClick={() => setRange(r)}>
              {t(`app.history.range.${r}`)}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <>
            <label className={ui.field}>
              <span className={ui.label}>{t('app.history.from')}</span>
              <input type="date" className={ui.input} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className={ui.field}>
              <span className={ui.label}>{t('app.history.to')}</span>
              <input type="date" className={ui.input} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
        <label className={ui.field} style={{ width: 110 }}>
          <span className={ui.label}>{t('app.history.min')}</span>
          <input className={ui.input} inputMode="decimal" value={minRupees} onChange={(e) => setMinRupees(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className={ui.field} style={{ width: 110 }}>
          <span className={ui.label}>{t('app.history.max')}</span>
          <input className={ui.input} inputMode="decimal" value={maxRupees} onChange={(e) => setMaxRupees(e.target.value.replace(/[^\d.]/g, ''))} />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t('app.history.outcome')}</span>
          <select className={ui.select} value={reason} onChange={(e) => setReason(e.target.value as EndReason | 'open' | '')}>
            <option value="">{t('app.history.anyOutcome')}</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`history.reason.${r}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {page && page.totals.length > 0 && (
        <div className={styles.totals}>
          <div className={styles.total}>
            <span className={styles.totalDay}>{t('app.history.all')} · </span>
            <span className={styles.totalAmount}>
              {page.total.count} · {formatINR(page.total.totalPaise)}
            </span>
          </div>
          {page.totals.slice(0, 7).map((total) => (
            <div key={total.day} className={styles.total}>
              <span className={styles.totalDay}>{day.format(fromInput(total.day))} · </span>
              <span className={styles.totalAmount}>
                {total.count} · {formatINR(total.totalPaise)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>{t('history.csv.time')}</th>
              <th className={ui.right}>{t('app.history.amount')}</th>
              <th>{t('history.csv.ref')}</th>
              <th>{t('history.csv.displays')}</th>
              <th>{t('history.csv.ended')}</th>
              <th className={ui.right}>{t('app.history.shownFor')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {page?.events.map((event) => {
              const seconds = durationSeconds(event);
              return (
                <tr key={event.id}>
                  <td>{time.format(event.shownAt)}</td>
                  <td className={ui.right}>
                    <strong>{formatINR(event.amountPaise)}</strong>
                  </td>
                  <td className={ui.mono}>{event.ref}</td>
                  <td className={ui.muted}>{event.displays.join(', ')}</td>
                  <td>
                    <span className={styles.reason}>{t(`history.reason.${event.endReason ?? 'open'}`)}</span>
                  </td>
                  <td className={ui.right}>{seconds === null ? '—' : t('app.history.seconds', { count: seconds })}</td>
                  <td>
                    <button type="button" className={ui.ghost} onClick={() => void api.app.history.reshow(event.id)}>
                      {t('app.history.reshow')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {page && page.events.length === 0 && <div className={ui.empty}>{t('app.history.empty')}</div>}
      </div>
    </div>
  );
}
