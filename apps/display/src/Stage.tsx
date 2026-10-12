import { type ReactNode, useEffect, useState } from 'react';
import styles from './Stage.module.css';

/** Scenes are laid out on a fixed canvas and scaled to fit, so every screen shows the same design. */
const PORTRAIT = { w: 320, h: 480 };
const LANDSCAPE = { w: 640, h: 400 };

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

export interface StageProps {
  rotate: 0 | 90 | 180 | 270;
  /** Fills the whole screen, including any space around the canvas. */
  background: string;
  children: (layout: 'portrait' | 'landscape') => ReactNode;
}

export function Stage({ rotate, background, children }: StageProps) {
  const viewport = useViewport();
  const turned = rotate === 90 || rotate === 270;
  const w = turned ? viewport.h : viewport.w;
  const h = turned ? viewport.w : viewport.h;
  const layout = w / h >= 1.15 ? 'landscape' : 'portrait';
  const canvas = layout === 'landscape' ? LANDSCAPE : PORTRAIT;
  const scale = Math.min(w / canvas.w, h / canvas.h);

  return (
    <div className={styles.viewport} style={{ background }}>
      <div
        className={styles.rotor}
        style={{ width: w, height: h, transform: `translate(-50%, -50%) rotate(${rotate}deg)` }}
      >
        <div
          className={styles.canvas}
          data-layout={layout}
          style={{ width: canvas.w, height: canvas.h, transform: `translate(-50%, -50%) scale(${scale})` }}
        >
          {children(layout)}
        </div>
      </div>
    </div>
  );
}
