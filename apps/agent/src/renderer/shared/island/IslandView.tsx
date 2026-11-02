import { formatINR } from '@counterpay/core';
import type { IslandLook, IslandState } from '@shared/api';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './island.module.css';

/** What the island can show (the other messages only steer it). */
export type IslandContent = Extract<IslandState, { kind: 'pay' } | { kind: 'message' }>;

/** Settings › Info Island › Animation speed, as a multiplier of every animation's time. */
export const SPEED: Record<IslandLook['speed'], number> = { fast: 0.6, medium: 1, slow: 1.6 };

/** The ring's circumference (radius 15). */
const RING = 2 * Math.PI * 15;
/** Amber for the last seconds. */
const WARN_MS = 10_000;
const TONES = { ok: '#14b37d', warn: '#f5a524', bad: '#ff6b5e' };

function clock(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  return secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs);
}

interface Props {
  content: IslandContent | null;
  /** What is left of the QR's time, for the ring. */
  leftMs: number;
  look: IslandLook;
  tucked: boolean;
  hover: boolean;
  onEnter?: () => void;
  onLeave?: () => void;
  onHide?: () => void;
}

/** The island itself: the amount and a ring counting down, a × on hover, or a short message. */
export function IslandView({ content, leftMs, look, tucked, hover, onEnter, onLeave, onHide }: Props) {
  const { t } = useTranslation();
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // The island's width follows its contents, so it grows and shrinks smoothly.
  useLayoutEffect(() => {
    const el = row.current;
    if (el) setWidth(el.scrollWidth + 34);
  });

  const pay = content?.kind === 'pay' ? content : null;
  const message = content?.kind === 'message' ? content : null;
  const offline = pay?.reach === 'offline';
  const tone = offline ? TONES.bad : leftMs <= WARN_MS ? TONES.warn : TONES.ok;
  const vars = {
    '--tone': tone,
    '--island-scale': look.size / 100,
    '--island-radius': `${Math.round(4 + (23 * look.roundness) / 100)}px`,
    '--island-speed': SPEED[look.speed],
  } as CSSProperties;

  return (
    <div className={styles.scaler} style={vars}>
      <div className={`${styles.dock} ${tucked ? styles.tucked : ''}`}>
        <span className={styles.shoulderLeft} aria-hidden />
        <span className={styles.shoulderRight} aria-hidden />
        <div
          className={styles.island}
          style={width === null ? undefined : { width }}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          role="status"
        >
          <div ref={row} className={styles.row}>
            {pay && (
              <>
                <span className={pay.confirmed || offline ? styles.dot : styles.dotWaiting} aria-hidden />
                <span className={styles.amountBox}>
                  <span className={styles.amount}>{formatINR(pay.amountPaise)}</span>
                  {offline && <span className={styles.offline}>{t('island.offline')}</span>}
                </span>
                <span className={styles.ring}>
                  <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
                    <circle cx="19" cy="19" r="15" className={styles.track} />
                    <circle
                      cx="19"
                      cy="19"
                      r="15"
                      className={styles.progress}
                      strokeDasharray={RING}
                      strokeDashoffset={RING * (1 - leftMs / Math.max(1, pay.totalMs))}
                    />
                  </svg>
                  <span className={styles.secs}>{clock(leftMs)}</span>
                </span>
                <span className={`${styles.closeSlot} ${hover ? styles.closeOpen : ''}`}>
                  <button type="button" className={styles.close} aria-label={t('island.hide')} tabIndex={-1} onClick={onHide}>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </span>
              </>
            )}
            {message && (
              <>
                {message.message === 'cleared' ? (
                  <span className={styles.badge} aria-hidden>
                    <svg width="13" height="13" viewBox="0 0 24 24">
                      <path d="M5 12.5l4.2 4.2L19 7" />
                    </svg>
                  </span>
                ) : (
                  <svg className={styles.clockIcon} width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                )}
                <span className={styles.message}>{t(message.message === 'cleared' ? 'island.cleared' : 'island.timedOut')}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
