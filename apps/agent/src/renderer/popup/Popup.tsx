import { applyAmountKey, formatINR, formatTyping, parseAmount, toAmountInput } from '@counterpay/core';
import type { DisplayReach, PopupOpenInfo } from '@shared/api';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/api';
import styles from './popup.module.css';

type Phase = 'hidden' | 'typing' | 'sending' | 'sent' | 'error';

interface View {
  phase: Phase;
  raw: string;
  /** The pre-filled amount is selected: the next digit replaces it. */
  selected: boolean;
  replacing: number | null;
  invalid: string | null;
  error: string | null;
  reach: DisplayReach;
  info: PopupOpenInfo | null;
  opened: number;
  /** Fade out after a send; vanish at once on Esc. */
  fading: boolean;
}

const HIDDEN: View = {
  phase: 'hidden',
  raw: '',
  selected: false,
  replacing: null,
  invalid: null,
  error: null,
  reach: 'simulatorOnly',
  info: null,
  opened: 0,
  fading: false,
};

const SENT_HOLD_MS = 300;
/** The pill sliding down and out after "Sent". */
const FADE_MS = 150;

/** The pill's colour grows out of the ₹ circle until it fills the pill (a scaled circle: cheap to draw). */
const FLOOD_SCALE = 20;

function CheckIcon({ instant }: { instant: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <motion.path
        d="M5 12.5l4.2 4.2L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: instant ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.18, delay: 0.04, ease: 'easeOut' }}
      />
    </svg>
  );
}

/**
 * The amount pill: summon, type, Enter. Keyboard only. Esc or a click elsewhere
 * cancels; focus always goes back to the window that had it.
 */
export function Popup() {
  const { t } = useTranslation();
  const systemReduce = useReducedMotion();
  const shake = useAnimationControls();
  const [view, setView] = useState<View>(HIDDEN);
  const viewRef = useRef(view);
  viewRef.current = view;
  const reduceMotion = Boolean(systemReduce || view.info?.reduceMotion);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', view.info?.reduceMotion === true);
  }, [view.info?.reduceMotion]);

  const update = useCallback((patch: Partial<View>) => {
    viewRef.current = { ...viewRef.current, ...patch };
    setView(viewRef.current);
  }, []);

  useEffect(
    () =>
      api.popup.onOpen((info) => {
        const current = info.current?.amountPaise ?? null;
        update({
          phase: 'typing',
          raw: current ? toAmountInput(current) : '',
          selected: current !== null,
          replacing: current,
          invalid: null,
          error: null,
          reach: info.reach,
          info,
          opened: viewRef.current.opened + 1,
          fading: false,
        });
        window.focus();
      }),
    [update],
  );

  const submit = useCallback(async () => {
    const v = viewRef.current;
    if (!v.info) return;
    const parsed = parseAmount(v.raw, v.info.maxRupees);
    if (!parsed.ok) {
      const reason =
        parsed.error === 'max'
          ? t('errors.max', { max: formatINR(parsed.maxPaise ?? v.info.maxRupees * 100) })
          : t(`errors.${parsed.error}`);
      update({ invalid: reason });
      if (!reduceMotion) void shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.18 } });
      return;
    }

    update({ phase: 'sending', invalid: null });
    const opened = v.opened;
    const result = await api.popup.submit(parsed.paise);
    // The shortcut opened the pill again while the displays were still answering: leave the new one alone.
    if (viewRef.current.opened !== opened) return;
    if (!result.ok) {
      update({ phase: 'error', error: t(result.error === 'noPayee' ? 'popup.noPayee' : 'popup.failed') });
      return;
    }
    update({ phase: 'sent', reach: result.reach });
    setTimeout(() => {
      update({ phase: 'hidden', fading: true });
      setTimeout(() => api.popup.done(), FADE_MS + 10);
    }, SENT_HOLD_MS);
  }, [reduceMotion, shake, t, update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const v = viewRef.current;
      if (v.phase === 'hidden' || v.phase === 'sending' || v.phase === 'sent') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        update({ phase: 'hidden', fading: false });
        api.popup.cancel();
        return;
      }
      if (v.phase === 'error') return;
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const last = v.info?.lastAmountPaise;
        if (last) update({ raw: toAmountInput(last), selected: true, invalid: null });
        return;
      }
      const key = event.key === 'Decimal' ? '.' : event.key;
      if (/^\d$/.test(key) || key === '.' || key === 'Backspace') {
        event.preventDefault();
        const raw = v.selected && key === 'Backspace' ? '' : applyAmountKey(v.selected ? '' : v.raw, key);
        update({ raw, selected: false, invalid: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, update]);

  const { phase, raw, selected, replacing, invalid, error, reach, info } = view;
  const visible = phase !== 'hidden';

  let caption = t('popup.hint');
  let tone: 'quiet' | 'bad' | 'good' = 'quiet';
  if (error) {
    caption = error;
    tone = 'bad';
  } else if (invalid) {
    caption = invalid;
    tone = 'bad';
  } else if (phase === 'sent') {
    const where = t(reach === 'online' ? 'popup.onDisplay' : reach === 'offline' ? 'popup.displayOffline' : 'popup.onSimulator');
    caption = `${formatTyping(raw)} · ${where}`;
    tone = reach === 'offline' ? 'bad' : 'good';
  } else if (info && !info.payeeReady) {
    caption = t('popup.noPayee');
    tone = 'bad';
  } else if (reach === 'offline') {
    caption = t('popup.displayOffline');
    tone = 'bad';
  } else if (replacing !== null && selected) {
    caption = t('popup.replacing', { amount: formatINR(replacing) });
  }

  const dot = reach === 'online' ? styles.dotOk : reach === 'offline' ? styles.dotBad : styles.dotIdle;
  const captionClass = tone === 'bad' ? styles.captionBad : tone === 'good' ? styles.captionGood : styles.caption;

  return (
    <div className={styles.stage}>
      <motion.div
        key={view.opened}
        className={`${styles.pill} ${phase === 'sent' ? styles.done : ''}`}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={
          visible
            ? { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0.1 : 0.14, ease: 'easeOut' } }
            : view.fading && !reduceMotion
              ? { opacity: 0, y: 16, transition: { duration: FADE_MS / 1000, ease: [0.4, 0, 1, 1] } }
              : { opacity: 0, transition: { duration: view.fading ? FADE_MS / 1000 : 0 } }
        }
        role="dialog"
        aria-label={t('popup.placeholder')}
      >
        {phase === 'sent' && (
          <motion.div
            className={styles.flood}
            aria-hidden
            initial={reduceMotion ? { opacity: 0, scale: FLOOD_SCALE } : { scale: 1 }}
            animate={{ opacity: 1, scale: FLOOD_SCALE }}
            transition={{ duration: reduceMotion ? 0.1 : 0.22, ease: [0.4, 0, 0.2, 1] }}
          />
        )}
        <motion.div className={styles.row} animate={shake}>
          <div className={styles.glyph} aria-hidden>
            <AnimatePresence initial={false}>
              {phase === 'sent' ? (
                <motion.span key="tick" className={styles.glyphFace}>
                  <CheckIcon instant={reduceMotion} />
                </motion.span>
              ) : (
                <motion.span
                  key="rupee"
                  className={styles.glyphFace}
                  exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.4, transition: { duration: 0.12 } }}
                >
                  ₹
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className={styles.middle}>
            {phase === 'sent' ? (
              <motion.div
                className={styles.sent}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.12, delay: reduceMotion ? 0 : 0.05, ease: 'easeOut' }}
                aria-live="polite"
              >
                {t('popup.sent')}
              </motion.div>
            ) : (
              <div className={`${styles.amount} ${phase === 'sending' ? styles.sending : ''}`} aria-live="polite">
                {raw === '' ? (
                  <span className={styles.placeholder}>{t('popup.placeholder')}</span>
                ) : (
                  <span className={selected ? styles.selected : undefined}>{formatTyping(raw)}</span>
                )}
                {phase === 'typing' && !selected && <span className={styles.caret} aria-hidden />}
              </div>
            )}
            <div className={captionClass}>{caption}</div>
          </div>
          <div className={styles.side} aria-hidden>
            <span className={dot} />
            <span className={styles.enter}>↵</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
