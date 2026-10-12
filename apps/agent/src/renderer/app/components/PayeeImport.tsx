import type { PayeeInfo } from '@counterpay/core';
import { type ClipboardEvent, type DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import ui from '../ui.module.css';
import styles from './PayeeImport.module.css';
import { decodeQrImage } from './qr-image';

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'found'; payee: PayeeInfo }
  | { kind: 'error'; message: string };

/**
 * First-run step 1 and Settings → Payee: drop in a photo or screenshot of the
 * merchant standee QR, or paste its text. Every parameter it has is kept.
 */
export function PayeeImport({ onSaved, compact = false }: { onSaved?: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const inspect = async (uri: string) => {
    const result = await api.app.payee.inspect(uri);
    if (result.ok) {
      setState({ kind: 'found', payee: result.payee });
      setLabel(result.payee.name);
    } else {
      setState({ kind: 'error', message: t(`app.payee.issue.${result.issue}`) });
    }
  };

  const readImage = async (file: Blob) => {
    setState({ kind: 'reading' });
    try {
      const decoded = await decodeQrImage(file);
      if (decoded) await inspect(decoded);
      else setState({ kind: 'error', message: t('app.payee.noQr') });
    } catch {
      setState({ kind: 'error', message: t('app.payee.noQr') });
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void readImage(file);
  };

  const onPaste = (event: ClipboardEvent) => {
    const image = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))?.getAsFile();
    if (image) {
      event.preventDefault();
      void readImage(image);
    }
  };

  const save = async () => {
    if (state.kind !== 'found') return;
    await api.app.payee.save(state.payee.baseUri, label.trim() || state.payee.name);
    onSaved?.();
  };

  if (state.kind === 'found') {
    const { payee } = state;
    return (
      <div className={styles.found}>
        <div className={styles.payee}>
          <div className={styles.payeeName}>{payee.name || t('app.payee.noName')}</div>
          <div className={ui.small}>
            {t('app.payee.upiId')}: <span className={ui.mono}>{payee.maskedVpa}</span>
            {payee.mcc && (
              <>
                {' · '}
                {t('app.payee.mcc')}: <span className={ui.mono}>{payee.mcc}</span>
              </>
            )}
          </div>
        </div>
        {payee.hasSignature && <div className={ui.banner}>{t('app.payee.signed')}</div>}
        <label className={ui.field}>
          <span className={ui.label}>{t('app.payee.label')}</span>
          <input className={ui.input} value={label} onChange={(e) => setLabel(e.target.value)} />
          <span className={ui.hint}>{t('app.payee.labelHint')}</span>
        </label>
        <div className={ui.row}>
          <button type="button" className={ui.primary} onClick={() => void save()}>
            {t('app.payee.save')}
          </button>
          <button type="button" className={ui.ghost} onClick={() => setState({ kind: 'idle' })}>
            {t('app.common.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.import} onPaste={onPaste}>
      <button
        type="button"
        className={compact ? styles.dropCompact : styles.drop}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
      >
        <span className={styles.dropTitle}>{state.kind === 'reading' ? t('app.payee.reading') : t('app.payee.drop')}</span>
        <span className={ui.small}>{t('app.payee.dropHint')}</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readImage(file);
          e.target.value = '';
        }}
      />
      <div className={styles.or}>{t('app.payee.or')}</div>
      <div className={ui.row}>
        <input
          className={ui.input}
          style={{ flex: 1 }}
          placeholder="upi://pay?pa=…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <button type="button" className={ui.button} disabled={!text.trim()} onClick={() => void inspect(text.trim())}>
          {t('app.payee.check')}
        </button>
      </div>
      {state.kind === 'error' && <div className={ui.bannerBad}>{state.message}</div>}
    </div>
  );
}
