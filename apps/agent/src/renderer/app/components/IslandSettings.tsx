import type { CounterPayConfig } from '@counterpay/core';
import type { IslandLook } from '@shared/api';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../shared/api';
import { type IslandContent, IslandView, SPEED } from '../../shared/island/IslandView';
import { updateConfig } from '../hooks';
import { Toggle } from './Toggle';
import ui from '../ui.module.css';
import styles from './island-settings.module.css';

const SPEEDS: IslandLook['speed'][] = ['fast', 'medium', 'slow'];

/** A slider that keeps its own value while dragged, so a late settings echo never pulls the thumb back. */
function useSliderValue(value: number) {
  const [draft, setDraft] = useState(value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setDraft(value);
  }, [value]);
  const bind = {
    onPointerDown: () => (dragging.current = true),
    onPointerUp: () => (dragging.current = false),
    onBlur: () => (dragging.current = false),
  };
  return [draft, setDraft, bind] as const;
}

/** Settings › Info Island: the switch, its size, corner roundness and speed, a live preview, and a try-out on screen. */
export function IslandSettings({ config }: { config: CounterPayConfig }) {
  const { t } = useTranslation();
  const [size, setSize, sizeBind] = useSliderValue(config.island.size);
  const [roundness, setRoundness, roundBind] = useSliderValue(config.island.roundness);
  const [hover, setHover] = useState(false);
  const [tucked, setTucked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const speed = config.island.speed;

  // Changing the speed replays the island coming out, at the new speed.
  const firstSpeed = useRef(true);
  useEffect(() => {
    if (firstSpeed.current) {
      firstSpeed.current = false;
      return;
    }
    setTucked(true);
    const id = window.setTimeout(() => setTucked(false), 450 * SPEED[speed]);
    return () => clearTimeout(id);
  }, [speed]);

  const look: IslandLook = { size, roundness, speed, reduceMotion: config.reduceMotion };
  const sample: IslandContent = {
    kind: 'pay',
    id: -1,
    amountPaise: 114000,
    totalMs: 180_000,
    leftMs: 167_000,
    reach: 'online',
    confirmed: true,
    look,
  };

  const tryIt = async () => {
    const result = await api.app.previewIsland();
    setNotice(result === 'busy' ? t('app.settings.islandTryBusy') : t('app.settings.islandTryShown'));
  };

  return (
    <section className={ui.card}>
      <h2 className={ui.cardTitle}>{t('app.settings.islandTitle')}</h2>
      <div className={ui.setting}>
        <div className={ui.settingText}>
          <span className={ui.settingName}>{t('app.settings.infoIsland')}</span>
          <span className={ui.small}>{t('app.settings.infoIslandHint')}</span>
        </div>
        <Toggle on={config.infoIsland} label={t('app.settings.infoIsland')} onChange={(infoIsland) => updateConfig({ infoIsland })} />
      </div>

      {config.infoIsland && (
        <>
          <div className={styles.preview} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
            <div className={styles.bezel} />
            <div className={styles.stage}>
              <IslandView content={sample} leftMs={167_000} look={look} tucked={tucked} hover={hover} />
            </div>
          </div>

          <div className={ui.setting}>
            <div className={ui.settingText}>
              <span className={ui.settingName}>{t('app.settings.islandSize')}</span>
              <span className={ui.small}>{t('app.settings.islandSizeHint')}</span>
            </div>
            <div className={styles.slider}>
              <input
                type="range"
                min={60}
                max={140}
                step={5}
                value={size}
                aria-label={t('app.settings.islandSize')}
                {...sizeBind}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setSize(next);
                  updateConfig({ island: { size: next } });
                }}
              />
              <span className={styles.value}>{size}%</span>
            </div>
          </div>

          <div className={ui.setting}>
            <div className={ui.settingText}>
              <span className={ui.settingName}>{t('app.settings.islandRoundness')}</span>
              <span className={ui.small}>{t('app.settings.islandRoundnessHint')}</span>
            </div>
            <div className={styles.slider}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={roundness}
                aria-label={t('app.settings.islandRoundness')}
                {...roundBind}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setRoundness(next);
                  updateConfig({ island: { roundness: next } });
                }}
              />
              <span className={styles.value}>{roundness}%</span>
            </div>
          </div>

          <div className={ui.setting}>
            <div className={ui.settingText}>
              <span className={ui.settingName}>{t('app.settings.islandSpeed')}</span>
              <span className={ui.small}>{t('app.settings.islandSpeedHint')}</span>
            </div>
            <select
              className={ui.select}
              value={speed}
              aria-label={t('app.settings.islandSpeed')}
              onChange={(e) => updateConfig({ island: { speed: e.target.value as IslandLook['speed'] } })}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {t(`app.settings.islandSpeeds.${s}`)}
                </option>
              ))}
            </select>
          </div>

          <div className={ui.setting}>
            <div className={ui.settingText}>
              <span className={ui.settingName}>{t('app.settings.islandTry')}</span>
              <span className={ui.small}>{notice ?? t('app.settings.islandTryHint')}</span>
            </div>
            <button type="button" className={ui.button} onClick={() => void tryIt()}>
              {t('app.settings.islandTry')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
