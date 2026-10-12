import type { AmbientItem, ContentMessage } from '@counterpay/core';
import { useEffect, useState } from 'react';
import { Bi } from '../Bilingual';
import { Qr } from '../Qr';
import styles from './scenes.module.css';

export interface AmbientProps {
  content: ContentMessage | null;
  items: AmbientItem[];
  slideSeconds: number;
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
            <Qr text={item.url} size={176} label="Google review QR" />
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
  }
}

/** The calm, branded default: a slow playlist of the logo, the rating QR and the shop's own messages. */
export function Ambient({ content, items, slideSeconds, langs, connecting }: AmbientProps) {
  // Slides the shop hasn't finished filling in (no link, no words) are skipped.
  const ready = items.filter(
    (item) => (item.k !== 'rating' || item.url) && (item.k !== 'text' || Object.values(item.text).some(Boolean)),
  );
  const slides: AmbientItem[] = ready.length ? ready : [{ k: 'logo' }];
  const count = slides.length;
  // Restart the rotation only when the playlist itself changes, not on every render.
  const playlistKey = JSON.stringify(slides);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (count < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), Math.max(3, slideSeconds) * 1000);
    return () => clearInterval(timer);
  }, [playlistKey, count, slideSeconds]);

  const item = slides[index % slides.length]!;
  return (
    <div className={styles.ambient}>
      <Slide key={index} item={item} content={content} langs={langs} />
      {slides.length > 1 && (
        <div className={styles.dots}>
          {slides.map((_, i) => (
            <span key={i} className={i === index ? styles.dotOn : styles.dot} />
          ))}
        </div>
      )}
      {connecting && <Bi langs={langs.slice(0, 1)} k="display.connecting" className={styles.status} />}
    </div>
  );
}
