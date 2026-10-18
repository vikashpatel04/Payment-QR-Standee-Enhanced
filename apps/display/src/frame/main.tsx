import { FRAME_STAMP, stampBits } from '@counterpay/core';
import { createRoot } from 'react-dom/client';
import '../i18n';
import { FrameView, type FrameInput } from './FrameView';
import './frame.css';

declare global {
  interface Window {
    /** Called by the agent: draws one frame and resolves once it is fully painted. */
    renderFrame(input: FrameInput & { stamp?: number }): Promise<boolean>;
  }
}

const root = createRoot(document.getElementById('root')!);
const fontsReady = Promise.all(
  ['400 16px "Inter Variable"', '600 16px "Inter Variable"', '700 16px "Inter Variable"'].map((font) => document.fonts.load(font)),
).catch(() => []);

/** Two animation frames, or 100 ms if the page isn't being painted (hidden pages pause animation frames). */
const nextPaint = () =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    new Promise<void>((resolve) => setTimeout(resolve, 100)),
  ]);

/** Under the panel area: the render's stamp, so the agent can tell a fresh capture from a stale one. */
function Stamp({ value }: { value: number }) {
  return (
    <div style={{ display: 'flex', height: FRAME_STAMP.height, background: '#fff' }}>
      {stampBits(value).map((black, i) => (
        <div key={i} style={{ width: FRAME_STAMP.block, height: FRAME_STAMP.height, background: black ? '#000' : '#fff' }} />
      ))}
    </div>
  );
}

window.renderFrame = async ({ stamp, ...input }) => {
  await fontsReady;
  await new Promise<void>((resolve) =>
    root.render(
      <>
        <FrameView input={input} onLaidOut={resolve} />
        {stamp !== undefined && <Stamp value={stamp} />}
      </>,
    ),
  );
  await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  await nextPaint();
  return true;
};
