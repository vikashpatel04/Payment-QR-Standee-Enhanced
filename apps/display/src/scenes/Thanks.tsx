import type { ContentMessage } from '@counterpay/core';
import { Bi, say } from '../Bilingual';
import { Qr } from '../Qr';
import styles from './scenes.module.css';

export function Thanks({ content, langs }: { content: ContentMessage | null; langs: string[] }) {
  return (
    <div className={styles.thanks}>
      <Bi
        langs={langs}
        k="display.thankYou"
        className={styles.thanksWords}
        primary={styles.thanksPrimary}
        secondary={styles.thanksSecondary}
      />
      {content?.rating ? (
        <>
          <div className={styles.smallCard}>
            <Qr text={content.rating} size={150} label={say(langs[0] ?? 'en', 'a11y.reviewQr')} />
          </div>
          <Bi
            langs={langs}
            k="display.rateUs"
            className={styles.rateWords}
            primary={styles.ratePrimary}
            secondary={styles.rateSecondary}
          />
        </>
      ) : (
        content?.shop && <div className={styles.shop}>{content.shop}</div>
      )}
    </div>
  );
}
