import { type AmbientItem, type ContentMessage, readySlides, TEXT_SCALE } from '@counterpay/core';
import { useEffect, useState } from 'react';
import { Bi, say } from '../Bilingual';
import { Qr } from '../Qr';
import styles from './scenes.module.css';

export interface AmbientProps {
  content: ContentMessage | null;
  items: AmbientItem[];
  slideSeconds: number;
  /** Slides change only on the cashier's key: show `index`. */
  manual?: boolean;
  index?: number;
  langs: string[];
  connecting: boolean;
}

function Slide({ item, content, langs }: { item: AmbientItem; content: ContentMessage | null; langs: string[] }) {
  switch (item.k) {
    case 'logo':
      return (
        <div className={styles.slide}>
          {content?.logo ? (
            <img className={styles.logo} src={content.logo} alt={content.shop} />
          ) : (
            content?.shop && <div className={styles.shopBig}>{content.shop}</div>
          )}
          <Bi
            langs={langs}
            k="display.welcome"
            className={styles.welcome}
            primary={styles.welcomePrimary}
            secondary={styles.welcomeSecondary}
          />
        </div>
      );
    case 'rating':
      return (
        <div className={styles.slide}>
          <Bi
            langs={langs}
            k={item.text ? undefined : 'display.rateUs'}
            {...(item.text ? { text: item.text } : {})}
            className={styles.slideTitle}
            primary={styles.slideTitlePrimary}
            secondary={styles.slideTitleSecondary}
          />
          <div className={styles.smallCard}>
            <Qr text={item.url} size={176} label={say(langs[0] ?? 'en', 'a11y.reviewQr')} />
          </div>
        </div>
      );
    case 'text':
      return (
        <div className={styles.slide}>
          <Bi langs={langs} text={item.text} primary={styles.textPrimary} secondary={styles.textSecondary} />
        </div>
      );
    case 'image':
      return (
        <div className={styles.slide}>
          <img className={styles.image} src={item.src} alt="" />
        </div>
      );
    case 'standee':
      // The shop's own UPI QR with no amount, like the printed standee.
      return (
        <div className={styles.slide}>
          {content?.shop && <div className={styles.shopBig}>{content.shop}</div>}
          <div className={styles.smallCard}>
            <Qr text={content?.standee ?? ''} size={200} label={say(langs[0] ?? 'en', 'display.scanToPay')} />
          </div>
          <Bi
            langs={langs}
            k={item.text ? undefined : 'display.scanToPay'}
            {...(item.text ? { text: item.text } : {})}
            className={styles.slideTitle}
            primary={styles.slideTitlePrimary}
            secondary={styles.slideTitleSecondary}
          />
        </div>
      );
  }
}

/** The calm, branded default: a slow playlist of the logo, the rating QR and the shop's own messages. */
export function Ambient({ content, items, slideSeconds, manual = false, index: manualIndex = 0, langs, connecting }: AmbientProps) {
  // Slides the shop hasn't finished filling in (no link, no words, no payee) are skipped.
  const slides: AmbientItem[] = readySlides(items, Boolean(content?.standee));
  const count = slides.length;
  // Restart the rotation only when the playlist itself changes, not on every render.
  const playlistKey = JSON.stringify(slides);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (count < 2 || manual) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), Math.max(3, slideSeconds) * 1000);
    return () => clearInterval(timer);
  }, [playlistKey, count, slideSeconds, manual]);

  const shown = manual ? manualIndex : index;
  const item = slides[shown % slides.length]!;
  const size = 'size' in item && item.size ? TEXT_SCALE[item.size] : 1;
  return (
    <div className={styles.ambient}>
      <div style={size === 1 ? undefined : { zoom: size }}>
        <Slide key={shown} item={item} content={content} langs={langs} />
      </div>
      {slides.length > 1 && (
        <div className={styles.dots}>
          {slides.map((_, i) => (
            <span key={i} className={i === shown % slides.length ? styles.dotOn : styles.dot} />
          ))}
        </div>
      )}
      {connecting && <Bi langs={langs.slice(0, 1)} k="display.connecting" className={styles.status} />}
    </div>
  );
}
