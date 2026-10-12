import { DISPLAY_LANGUAGES } from '@counterpay/core';
import type { AmountLockTest, AppSnapshot } from '@shared/api';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import { Mark } from '../components/Icon';
import { PayeeImport } from '../components/PayeeImport';
import { Preview } from '../components/Preview';
import { ShortcutRecorder } from '../components/ShortcutRecorder';
import { updateConfig } from '../hooks';
import ui from '../ui.module.css';
import { newDisplay } from './Displays';
import styles from './pages.module.css';

type Choice = 'simulator' | 'window' | 'web';
const STEPS = 4;

function Payee({ snapshot, next }: { snapshot: AppSnapshot; next: () => void }) {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(!snapshot.payee);
  return (
    <>
      <div>
        <h1 className={ui.title}>{t('app.setup.payeeTitle')}</h1>
        <p className={ui.lead}>{t('app.setup.payeeLead')}</p>
      </div>
      {snapshot.payee && !changing ? (
        <div className={ui.card}>
          <div className={ui.spread}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 650 }}>{snapshot.config.upi.payeeLabel || snapshot.payee.name}</div>
              <div className={ui.small}>
                {t('app.payee.upiId')}: <span className={ui.mono}>{snapshot.payee.maskedVpa}</span>
              </div>
            </div>
            <button type="button" className={ui.ghost} onClick={() => setChanging(true)}>
              {t('app.settings.changePayee')}
            </button>
          </div>
        </div>
      ) : (
        <PayeeImport onSaved={() => setChanging(false)} />
      )}
      <div className={ui.row}>
        <button type="button" className={ui.primary} disabled={!snapshot.payee || changing} onClick={next}>
          {t('app.common.next')}
        </button>
      </div>
    </>
  );
}

function Shortcuts({ snapshot, next, back }: { snapshot: AppSnapshot; next: () => void; back: () => void }) {
  const { t } = useTranslation();
  const { summon, clear } = snapshot.shortcuts;
  return (
    <>
      <div>
        <h1 className={ui.title}>{t('app.setup.shortcutsTitle')}</h1>
        <p className={ui.lead}>{t('app.setup.shortcutsLead')}</p>
      </div>
      <div className={ui.card}>
        <div className={ui.setting}>
          <div className={ui.settingText}>
            <span className={ui.settingName}>{t('app.home.summon')}</span>
            <span className={ui.small}>{t('app.settings.summonHint')}</span>
          </div>
          <ShortcutRecorder state={summon} other={clear.accelerator} onChange={(s) => updateConfig({ shortcuts: { summon: s } })} />
        </div>
        <div className={ui.setting}>
          <div className={ui.settingText}>
            <span className={ui.settingName}>{t('app.home.clear')}</span>
            <span className={ui.small}>{t('app.settings.clearHint')}</span>
          </div>
          <ShortcutRecorder state={clear} other={summon.accelerator} onChange={(c) => updateConfig({ shortcuts: { clear: c } })} />
        </div>
      </div>
      <div className={ui.small}>{t('app.setup.shortcutsNote')}</div>
      <div className={ui.row}>
        <button type="button" className={ui.ghost} onClick={back}>
          {t('app.common.back')}
        </button>
        <button type="button" className={ui.primary} disabled={!summon.registered || !clear.registered} onClick={next}>
          {t('app.common.next')}
        </button>
      </div>
    </>
  );
}

function Display({ snapshot, next, back }: { snapshot: AppSnapshot; next: () => void; back: () => void }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Choice | null>(null);
  const hasSecond = snapshot.monitors.some((m) => !m.primary);

  const pick = (kind: Choice) => {
    setChoice(kind);
    if (kind === 'simulator') {
      api.app.openSimulator();
      return;
    }
    const existing = snapshot.config.displays.find((d) => d.driver === kind);
    if (existing) {
      if (!existing.enabled) {
        updateConfig({ displays: snapshot.config.displays.map((d) => (d.id === existing.id ? { ...d, enabled: true } : d)) });
      }
      return;
    }
    updateConfig({ displays: [...snapshot.config.displays, newDisplay(kind, snapshot, t(`app.displays.kind.${kind}`))] });
  };

  const [primary = 'en', second = ''] = snapshot.config.language.display;
  const web = snapshot.displays.find((d) => d.config.driver === 'web' && d.config.enabled);
  const chosen = choice ? snapshot.displays.find((d) => d.config.driver === choice && d.config.enabled) : undefined;

  return (
    <>
      <div>
        <h1 className={ui.title}>{t('app.setup.displayTitle')}</h1>
        <p className={ui.lead}>{t('app.setup.displayLead')}</p>
      </div>
      <div className={ui.stack}>
        <button type="button" className={choice === 'simulator' ? styles.choiceOn : styles.choice} onClick={() => pick('simulator')}>
          <span className={styles.choiceTitle}>{t('app.setup.choice.simulator')}</span>
          <span className={ui.small}>{t('app.setup.choice.simulatorHint')}</span>
        </button>
        <button
          type="button"
          className={choice === 'window' ? styles.choiceOn : styles.choice}
          onClick={() => pick('window')}
          disabled={!hasSecond}
        >
          <span className={styles.choiceTitle}>{t('app.setup.choice.window')}</span>
          <span className={ui.small}>{t(hasSecond ? 'app.setup.choice.windowHint' : 'app.displays.plugIn')}</span>
        </button>
        <button type="button" className={choice === 'web' ? styles.choiceOn : styles.choice} onClick={() => pick('web')}>
          <span className={styles.choiceTitle}>{t('app.setup.choice.web')}</span>
          <span className={ui.small}>{t('app.setup.choice.webHint')}</span>
        </button>
        <button type="button" className={styles.choice} disabled>
          <span className={styles.choiceTitle}>{t('app.displays.addUsb')}</span>
          <span className={ui.small}>{t('app.displays.phase2')}</span>
        </button>
      </div>
      {choice === 'web' && web && (
        <div className={styles.pairing}>
          <div>
            <div className={ui.label}>{t('app.displays.pairingCode')}</div>
            <div className={styles.pairCode}>{web.config.pairingCode}</div>
          </div>
          <div className={ui.stack} style={{ gap: 4 }}>
            <span className={ui.small}>{t('app.displays.openOnPhone')}</span>
            {snapshot.lanUrls.map((url) => (
              <span key={url} className={ui.mono}>
                {url}
              </span>
            ))}
            <span className={ui.small}>{t('app.displays.paired', { count: web.status.clients })}</span>
          </div>
        </div>
      )}
      <label className={ui.field}>
        <span className={ui.label}>{t('app.setup.languageLabel')}</span>
        <select
          className={ui.select}
          value={second}
          onChange={(e) => updateConfig({ language: { display: [primary, ...(e.target.value ? [e.target.value] : [])] } })}
        >
          <option value="">{t('app.content.none')}</option>
          {DISPLAY_LANGUAGES.filter((lang) => lang !== primary).map((lang) => (
            <option key={lang} value={lang}>
              {t(`app.language.${lang}`)}
            </option>
          ))}
        </select>
        <span className={ui.hint}>{t('app.setup.languageHint')}</span>
      </label>
      {chosen && choice !== 'web' && (
        <div className={ui.row}>
          <Preview view={chosen} snapshot={snapshot} height={160} />
        </div>
      )}
      <div className={ui.row}>
        <button type="button" className={ui.ghost} onClick={back}>
          {t('app.common.back')}
        </button>
        <button type="button" className={ui.primary} disabled={!choice} onClick={next}>
          {t('app.common.next')}
        </button>
      </div>
    </>
  );
}

function Test({ snapshot, back }: { snapshot: AppSnapshot; back: () => void }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    void api.app.showAmount(100).then((result) => setShown(result.ok));
    return () => void api.app.clear();
  }, []);

  const finish = async (answer: AmountLockTest['answer'] | null) => {
    if (answer) await api.app.onboarding.saveTest(answer);
    await api.app.clear();
    await api.app.onboarding.complete();
  };

  const preview = snapshot.displays.find((d) => d.config.enabled && d.config.driver !== 'simulator') ?? snapshot.displays.find((d) => d.config.driver === 'simulator');

  return (
    <>
      <div>
        <h1 className={ui.title}>{t('app.setup.testTitle')}</h1>
        <p className={ui.lead}>{t('app.setup.testLead')}</p>
      </div>
      <div className={ui.row} style={{ alignItems: 'flex-start', gap: 20 }}>
        {preview && <Preview view={preview} snapshot={snapshot} height={240} />}
        <ol className={ui.stack} style={{ margin: 0, paddingLeft: 18 }}>
          <li>{t('app.setup.testStep1')}</li>
          <li>{t('app.setup.testStep2')}</li>
          <li>{t('app.setup.testStep3')}</li>
        </ol>
      </div>
      {!shown && <div className={ui.small}>{t('app.setup.testWaiting')}</div>}
      <div className={ui.cardTitle} style={{ margin: 0 }}>
        {t('app.setup.question')}
      </div>
      <div className={styles.answers}>
        {(['locked', 'editable', 'mixed'] as const).map((answer) => (
          <button key={answer} type="button" className={styles.choice} onClick={() => void finish(answer)}>
            <span className={styles.choiceTitle}>{t(`app.setup.answer.${answer}`)}</span>
          </button>
        ))}
      </div>
      <div className={ui.row}>
        <button type="button" className={ui.ghost} onClick={back}>
          {t('app.common.back')}
        </button>
        <button type="button" className={ui.ghost} onClick={() => void finish(null)}>
          {t('app.setup.skip')}
        </button>
      </div>
    </>
  );
}

/** Four screens from install to a working QR in about three minutes. */
export function Onboarding({ snapshot }: { snapshot: AppSnapshot }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const next = () => setStep((s) => Math.min(STEPS - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className={styles.onboarding}>
      <div className={styles.onboardingInner}>
        <div className={ui.spread}>
          <div className={ui.row}>
            <Mark />
            <strong>Counter Pay</strong>
          </div>
          <span className={ui.small}>{t('app.setup.step', { step: step + 1, total: STEPS })}</span>
        </div>
        <div className={styles.steps}>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i <= step ? styles.stepOn : styles.step} />
          ))}
        </div>
        {step === 0 && <Payee snapshot={snapshot} next={next} />}
        {step === 1 && <Shortcuts snapshot={snapshot} next={next} back={back} />}
        {step === 2 && <Display snapshot={snapshot} next={next} back={back} />}
        {step === 3 && <Test snapshot={snapshot} back={back} />}
      </div>
    </div>
  );
}
