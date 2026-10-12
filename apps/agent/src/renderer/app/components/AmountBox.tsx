import { formatINR, parseAmount } from '@counterpay/core';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import ui from '../ui.module.css';

/** Home → Show amount: the popup's job, for when a mouse is easier. */
export function AmountBox({ maxRupees }: { maxRupees: number }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseAmount(text, maxRupees);
    if (!parsed.ok) {
      setMessage({
        text: parsed.error === 'max' ? t('errors.max', { max: formatINR(maxRupees * 100) }) : t(`errors.${parsed.error}`),
        bad: true,
      });
      return;
    }
    const result = await api.app.showAmount(parsed.paise);
    if (!result.ok) {
      setMessage({ text: t(result.error === 'noPayee' ? 'popup.noPayee' : 'popup.failed'), bad: true });
      return;
    }
    setText('');
    setMessage({
      text: `${formatINR(parsed.paise)} · ${t(result.reach === 'online' ? 'popup.onDisplay' : result.reach === 'offline' ? 'popup.displayOffline' : 'popup.onSimulator')}`,
      bad: result.reach === 'offline',
    });
  };

  return (
    <form className={ui.stack} onSubmit={submit}>
      <div className={ui.row}>
        <input
          className={ui.input}
          style={{ flex: 1, fontSize: 18, fontWeight: 600 }}
          inputMode="decimal"
          placeholder={`₹ ${t('popup.placeholder')}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value.replace(/[^\d.]/g, ''));
            setMessage(null);
          }}
        />
        <button type="submit" className={ui.primary}>
          {t('app.home.show')}
        </button>
      </div>
      {message && (
        <div className={ui.small} style={{ color: message.bad ? 'var(--bad)' : 'var(--accent-ink)' }}>
          {message.text}
        </div>
      )}
    </form>
  );
}
