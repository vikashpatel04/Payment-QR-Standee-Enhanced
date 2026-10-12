import { type ContentMessage, type DisplayScene, formatINR } from '@counterpay/core';
import { say } from '../Bilingual';
import { Qr } from '../Qr';
import styles from './scenes.module.css';

type PayDisplayScene = Extract<DisplayScene, { kind: 'pay' }>;

export interface PayProps {
  scene: PayDisplayScene;
  content: ContentMessage | null;
  langs: string[];
  layout: 'portrait' | 'landscape';
  now: number;
}

/** "Scan with any UPI app · Amount is fixed". A narrow screen breaks it at the dot, not mid-phrase. */
function hint(lang: string) {
  return (
    <>
      <span className={styles.phrase}>{say(lang, 'display.scanHint')} ·</span>{' '}
      <span className={styles.phrase}>{say(lang, 'display.amountFixed')}</span>
    </>
  );
}

function HintLines({ langs }: { langs: string[] }) {
  const [first = 'en', second] = langs;
  const line = hint;
  return (
    <div className={styles.hint}>
      <div className={styles.hintPrimary} lang={first}>
        {line(first)}
      </div>
      {second && (
        <div className={styles.hintSecondary} lang={second}>
          {line(second)}
        </div>
      )}
    </div>
  );
}

function Payee({ name, langs }: { name: string; langs: string[] }) {
  if (!name) return null;
  const label = langs.map((lang) => say(lang, 'display.payingLabel')).join(' · ');
  return (
    <div className={styles.payee}>
      <div className={styles.payeeLabel}>{label}</div>
      <div className={styles.payeeName}>{name}</div>
    </div>
  );
}

/**
 * The fixed-amount pay QR. The amount on screen and the amount in the QR come from
 * the same integer paise, and the payee name lets the customer match what their
 * UPI app shows.
 */
export function Pay({ scene, content, langs, layout, now }: PayProps) {
  const total = Math.max(1, scene.until - scene.since);
  const left = Math.max(0, Math.min(1, (scene.until - now) / total));
  const amount = formatINR(scene.amt);
  const qr = scene.uri ? (
    <div className={styles.qrCard}>
      <Qr text={scene.uri} size={layout === 'landscape' ? 300 : 208} label={`UPI QR for ${amount}`} />
    </div>
  ) : null;

  if (layout === 'landscape') {
    return (
      <div className={styles.payWide}>
        {qr}
        <div className={styles.wideText}>
          {content?.shop && <div className={styles.shop}>{content.shop}</div>}
          <div className={styles.amount}>{amount}</div>
          <HintLines langs={langs} />
          <Payee name={content?.payee ?? ''} langs={langs} />
        </div>
        <div className={styles.expiry} style={{ width: `${left * 100}%` }} />
      </div>
    );
  }

  return (
    <div className={styles.pay}>
      {content?.shop && <div className={styles.shop}>{content.shop}</div>}
      {qr}
      <div className={styles.amount}>{amount}</div>
      <HintLines langs={langs} />
      <Payee name={content?.payee ?? ''} langs={langs} />
      <div className={styles.expiry} style={{ width: `${left * 100}%` }} />
    </div>
  );
}

