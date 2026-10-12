import { type FormEvent, useState } from 'react';
import { deviceLanguages, say } from '../Bilingual';
import styles from './scenes.module.css';

type PairError = 'wrong' | 'wait' | null;

/** A phone or tablet on the shop Wi-Fi enters the code from Counter Pay → Displays. */
export function Pairing({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PairError>(null);
  const [first = 'en', second] = deviceLanguages();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (response.status === 429) {
        setError('wait');
      } else if (!response.ok) {
        setError('wrong');
      } else {
        const body = (await response.json()) as { token?: string };
        if (body.token) onPaired(body.token);
        else setError('wrong');
      }
    } catch {
      setError('wrong');
    } finally {
      setBusy(false);
    }
  };

  const errorKey = error === 'wait' ? 'display.pairWait' : 'display.pairWrong';
  return (
    <form className={styles.pair} onSubmit={submit}>
      <div>
        <div className={styles.pairTitle} lang={first}>
          {say(first, 'display.pairTitle')}
        </div>
        {second && (
          <div className={styles.pairTitleSecondary} lang={second}>
            {say(second, 'display.pairTitle')}
          </div>
        )}
      </div>
      <div className={styles.pairHint} lang={first}>
        {say(first, 'display.pairHint')}
      </div>
      <div className={styles.pairForm}>
        <input
          className={styles.pairInput}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-label={say(first, 'display.pairTitle')}
          autoFocus
        />
        <button className={styles.pairButton} type="submit" disabled={busy || code.length !== 6}>
          {say(first, 'display.pairButton')}
        </button>
      </div>
      <div className={styles.pairError} role="alert">
        {error ? say(first, errorKey) : ''}
      </div>
    </form>
  );
}
