import { acceleratorFromKeyPress, sameAccelerator, shortcutWarning } from '@counterpay/core';
import type { ShortcutState } from '@shared/api';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import ui from '../ui.module.css';
import styles from './ShortcutRecorder.module.css';

export function Keys({ accelerator }: { accelerator: string }) {
  return (
    <span className={styles.keys}>
      {accelerator.split('+').map((key, i) => (
        <kbd key={`${key}-${i}`} className={ui.kbd}>
          {key}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Press the keys to record them. The global shortcuts are suspended while
 * recording, so pressing the current key doesn't summon the popup.
 */
export function ShortcutRecorder({
  state,
  other,
  onChange,
}: {
  state: ShortcutState;
  /** The other shortcut, which this one must not equal. */
  other: string;
  onChange: (accelerator: string) => void;
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    api.app.suspendShortcuts(true);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromKeyPress(event);
      if (!accelerator) return;
      setRecording(false);
      const warning = shortcutWarning(accelerator);
      if (warning) {
        setProblem(t(`app.shortcut.warning.${warning}`, { key: accelerator }));
      } else if (sameAccelerator(accelerator, other)) {
        setProblem(t('app.shortcut.same'));
      } else {
        setProblem(null);
        onChange(accelerator);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      api.app.suspendShortcuts(false);
    };
  }, [recording, other, onChange, t]);

  const refused = !state.registered && !state.warning;
  return (
    <div className={styles.recorder}>
      <button
        type="button"
        className={recording ? styles.recording : styles.button}
        onClick={() => setRecording((r) => !r)}
        onBlur={() => setRecording(false)}
        aria-label={t('app.shortcut.record')}
      >
        {recording ? <span className={styles.prompt}>{t('app.shortcut.pressKeys')}</span> : <Keys accelerator={state.accelerator} />}
      </button>
      {problem && <div className={styles.problem}>{problem}</div>}
      {!problem && state.warning && (
        <div className={styles.problem}>{t(`app.shortcut.warning.${state.warning}`, { key: state.accelerator })}</div>
      )}
      {!problem && refused && <div className={styles.problem}>{t('app.shortcut.refused', { key: state.accelerator })}</div>}
    </div>
  );
}
