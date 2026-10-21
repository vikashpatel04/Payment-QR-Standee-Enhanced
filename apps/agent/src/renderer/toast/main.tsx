import type { ToastMessage } from '@shared/api';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import { api } from '../shared/api';
import styles from './toast.module.css';

// Subscribe before React mounts: the agent sends the first message as soon as the page loads.
let deliver: ((message: ToastMessage) => void) | null = null;
let early: ToastMessage | null = null;
api.toast.onShow((message) => {
  if (deliver) deliver(message);
  else early = message;
});

/** Shown for 0.9 s without ever taking focus. */
function Toast() {
  const systemReduce = useReducedMotion();
  const [message, setMessage] = useState<(ToastMessage & { id: number }) | null>(null);
  const reduceMotion = Boolean(systemReduce || message?.reduceMotion);

  useEffect(() => {
    let id = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    deliver = (next) => {
      clearTimeout(timer);
      const mine = ++id;
      document.documentElement.toggleAttribute('data-reduce-motion', next.reduceMotion === true);
      setMessage({ ...next, id: mine });
      timer = setTimeout(() => setMessage((current) => (current?.id === mine ? null : current)), 900);
    };
    if (early) {
      deliver(early);
      early = null;
    }
    return () => {
      deliver = null;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className={styles.stage}>
      {message && (
        <motion.div
          key={message.id}
          className={styles.toast}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.14, ease: 'easeOut' }}
          role="status"
        >
          <span className={message.tone === 'warn' ? styles.iconWarn : styles.icon} aria-hidden>
            {message.tone === 'warn' ? '!' : '✓'}
          </span>
          {message.text}
        </motion.div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Toast />);
