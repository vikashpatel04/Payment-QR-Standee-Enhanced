import { formatINR } from '@counterpay/core';
import type { IslandMessage, IslandState } from '@shared/api';
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import '../shared/base.css';
import '../shared/i18n';
import { api } from '../shared/api';
import styles from './island.module.css';

// Subscribe before React mounts: the agent may send the first message as soon as the page loads.
let deliver: ((message: IslandMessage) => void) | null = null;
let early: IslandMessage | null = null;
api.island.onState((message) => {
  if (deliver) deliver(message);
  else early = message;
});

/** The ring's circumference (radius 15). */
const RING = 2 * Math.PI * 15;
/** Amber for the last seconds. */
const WARN_MS = 10_000;
/** "QR cleared" / "QR timed out" stay this long, then tuck away. */
const MESSAGE_MS = 1600;
/** Coming out of the bezel waits a moment, so the pill has dropped away first. */
const EMERGE_DELAY_MS = 180;
/** How long tucking back into the bezel takes (see island.module.css). */
const TUCK_MS = 380;

const TONES = { ok: '#14b37d', warn: '#f5a524', bad: '#ff6b5e' };

type Shown = Exclude<IslandState, { kind: 'hide' }>;

function clock(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  return secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs);
}

/** The Info Island: the QR's amount and a ring counting down its time; a × appears on hover. */
function Island() {
  const { t } = useTranslation();
  const [content, setContent] = useState<Shown | null>(null);
  const [tucked, setTucked] = useState(true);
  const [hover, setHover] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const [width, setWidth] = useState<number | null>(null);
  const deadline = useRef(0);
  const seqRef = useRef(0);
  const tuckedRef = useRef(true);
  const timers = useRef<number[]>([]);
  const row = useRef<HTMLDivElement>(null);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach((id) => clearTimeout(id));
    timers.current = [];
  };
  const setTuckedBoth = (value: boolean) => {
    tuckedRef.current = value;
    setTucked(value);
  };

  const tuck = useCallback((seq: number) => {
    clearTimers();
    setHover(false);
    api.island.hover(false);
    setTuckedBoth(true);
    later(() => api.island.gone(seq), TUCK_MS + 40);
  }, []);

  useEffect(() => {
    deliver = ({ seq, state }) => {
      seqRef.current = seq;
      if (state.kind === 'hide') {
        tuck(seq);
        return;
      }
      document.documentElement.toggleAttribute('data-reduce-motion', state.reduceMotion);
      clearTimers();
      if (state.kind === 'pay') deadline.current = performance.now() + state.leftMs;
      setNow(performance.now());
      setContent(state);
      const wait = tuckedRef.current ? EMERGE_DELAY_MS : 0;
      if (tuckedRef.current) later(() => setTuckedBoth(false), wait);
      if (state.kind === 'message') later(() => tuck(seq), wait + MESSAGE_MS);
    };
    if (early) {
      deliver(early);
      early = null;
    }
    return () => {
      deliver = null;
      clearTimers();
    };
  }, [tuck]);

  // A light tick for the countdown, only while a QR is on the island.
  const counting = content?.kind === 'pay' && !tucked;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [counting]);

  // The island's width follows its contents, so it grows and shrinks smoothly.
  useLayoutEffect(() => {
    const el = row.current;
    if (el) setWidth(el.scrollWidth + 34);
  });

  const pay = content?.kind === 'pay' ? content : null;
  const message = content?.kind === 'message' ? content : null;
  const leftMs = pay ? Math.max(0, deadline.current - now) : 0;
  const offline = pay?.reach === 'offline';
  const tone = offline ? TONES.bad : leftMs <= WARN_MS ? TONES.warn : TONES.ok;
  const toneStyle = { '--tone': tone } as CSSProperties;

  const enter = () => {
    if (!pay || tucked) return;
    setHover(true);
    api.island.hover(true);
  };
  const leave = () => {
    setHover(false);
    api.island.hover(false);
  };
  const hide = () => {
    api.island.dismiss(seqRef.current);
    tuck(seqRef.current);
  };

  return (
    <div className={styles.stage}>
      <div className={`${styles.dock} ${tucked ? styles.tucked : ''}`} style={toneStyle}>
        <span className={styles.shoulderLeft} aria-hidden />
        <span className={styles.shoulderRight} aria-hidden />
        <div
          className={styles.island}
          style={width === null ? undefined : { width }}
          onMouseEnter={enter}
          onMouseLeave={leave}
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
                  <button type="button" className={styles.close} aria-label={t('island.hide')} tabIndex={-1} onClick={hide}>
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

createRoot(document.getElementById('root')!).render(<Island />);
