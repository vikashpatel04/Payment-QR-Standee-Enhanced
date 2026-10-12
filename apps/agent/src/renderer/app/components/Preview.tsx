import type { AppSnapshot, DisplayView } from '@shared/api';
import styles from './Preview.module.css';

/** Width × height the preview frame should have, from the display's shape. */
function shape(view: DisplayView, snapshot: AppSnapshot): { w: number; h: number } {
  const { config, status } = view;
  let w = 320;
  let h = 480;
  if (config.driver === 'window') {
    const monitor = snapshot.monitors.find((m) => m.index === (config.monitor ?? 2));
    if (monitor) {
      w = monitor.width;
      h = monitor.height;
    }
  } else if (status.size) {
    w = status.size.w;
    h = status.size.h;
  }
  const turned = config.rotation === 90 || config.rotation === 270;
  return turned ? { w: h, h: w } : { w, h };
}

/**
 * Exactly what the customer sees now: the display page itself, read-only, in a frame
 * the shape of the real screen.
 */
export function Preview({ view, snapshot, height = 200 }: { view: DisplayView; snapshot: AppSnapshot; height?: number }) {
  if (!view.previewUrl) return <div className={styles.off} style={{ height, width: (height * 2) / 3 }} />;
  const { w, h } = shape(view, snapshot);
  const width = Math.round(Math.min(height * (w / h), height * 1.8));
  // The preview page renders unrotated; rotation is shown by the frame's shape.
  const url = view.previewUrl.replace(/&rotate=\d+/, '');
  return (
    <div className={styles.frame} style={{ width, height }}>
      <iframe
        className={styles.iframe}
        src={url}
        title={view.config.name ?? view.config.id}
        sandbox="allow-scripts allow-same-origin"
        tabIndex={-1}
      />
    </div>
  );
}
