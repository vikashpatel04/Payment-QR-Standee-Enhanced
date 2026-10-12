import { say } from '../Bilingual';
import styles from './scenes.module.css';

export function TestPattern({ id, layout, rotate, langs }: { id: string; layout: string; rotate: number; langs: string[] }) {
  return (
    <div className={styles.test}>
      <div className={styles.arrow} aria-hidden>
        ↑
      </div>
      <div className={styles.testLabel}>
        <div>{langs.map((lang) => say(lang, 'display.testPattern')).join(' · ')}</div>
        <div>{id}</div>
        <div>
          {window.innerWidth} × {window.innerHeight} px · {layout} · {rotate}°
        </div>
      </div>
    </div>
  );
}
