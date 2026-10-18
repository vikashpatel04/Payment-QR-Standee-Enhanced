import { type DisplayContent, FRAME_STAMP, frameLength, nextStamp, packFrame, readStamp, unpackFrame } from '@counterpay/core';
import type { FrameRenderer, FrameRequest, RenderedFrame } from '@counterpay/drivers';
import { BrowserWindow, nativeImage } from 'electron';
import { setTimeout as sleep } from 'node:timers/promises';

/** How long to keep re-capturing for a fresh frame before giving up on this render. */
const FRESH_TRIES = 25;
const FRESH_WAIT_MS = 40;

/** Content paths like /content/logo are served by the local display server. */
function absolute(content: DisplayContent | null, baseUrl: string): DisplayContent | null {
  if (!content) return null;
  const abs = (path: string) => (path.startsWith('/') ? `${baseUrl}${path}` : path);
  return {
    ...content,
    ...(content.logoUrl ? { logoUrl: abs(content.logoUrl) } : {}),
    ambient: {
      ...content.ambient,
      items: content.ambient.items.map((item) => (item.k === 'image' ? { ...item, src: abs(item.src) } : item)),
    },
  };
}

/**
 * Draws frames for E-ink displays: the display app's frame page in a window that is never
 * shown, sized to the panel's exact pixels, captured and thresholded to 1 bpp.
 * One window serves every frame display; renders run one at a time.
 * (Electron's offscreen mode isn't used: capturing from it fails with UnknownVizError.)
 */
export class OffscreenFrameRenderer implements FrameRenderer {
  private win: BrowserWindow | null = null;
  private loading: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Device pixels per CSS pixel; frames must be drawn 1:1. */
  private scale = 1;
  private stamp = 0;

  constructor(
    private readonly pageFile: () => string,
    private readonly baseUrl: () => string,
  ) {}

  render(request: FrameRequest): Promise<RenderedFrame> {
    const job = this.queue.then(() => this.draw(request));
    this.queue = job.catch(() => {});
    return job;
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.loading = null;
  }

  private async window(width: number, height: number): Promise<BrowserWindow> {
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        show: false,
        width,
        height,
        useContentSize: true,
        frame: false,
        skipTaskbar: true,
        focusable: false,
        webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
      });
      this.loading = this.win.loadFile(this.pageFile());
    }
    await this.loading;
    // With display scaling, lay the page out at device pixels: a smaller window, zoomed out.
    const w = Math.round(width / this.scale);
    const h = Math.round(height / this.scale);
    const [cw, ch] = this.win.getContentSize();
    if (cw !== w || ch !== h) this.win.setContentSize(w, h);
    this.win.webContents.setZoomFactor(1 / this.scale);
    return this.win;
  }

  private async draw(request: FrameRequest, retried = false): Promise<RenderedFrame> {
    const { width, height } = request;
    // The page is the panel plus the stamp strip under it.
    const rows = height + FRAME_STAMP.height;
    const win = await this.window(width, rows);
    this.stamp = nextStamp(this.stamp);
    const input = { ...request, content: absolute(request.content, this.baseUrl()), stamp: this.stamp };
    await win.webContents.executeJavaScript(`window.renderFrame(${JSON.stringify(input)})`, true);

    // A window that is never shown may hand back its previous paint: capture until the stamp matches.
    for (let attempt = 0; attempt < FRESH_TRIES; attempt++) {
      if (attempt > 0) await sleep(FRESH_WAIT_MS);
      const image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      const size = image.getSize();
      const scale = size.width / Math.round(width / this.scale);
      if (!retried && Math.abs(scale - this.scale) > 0.01 && Math.abs(scale - 1) > 0.01) {
        this.scale = scale;
        return this.draw(request, true);
      }
      if (size.width < width || size.height < rows) continue;
      const exact = size.width === width && size.height === rows ? image : image.crop({ x: 0, y: 0, width, height: rows });
      const page = packFrame(exact.toBitmap(), width, rows, 'bgra');
      if (readStamp(page, width, height) !== this.stamp) continue;
      return this.finish(page.slice(0, frameLength(width, height)), width, height);
    }
    throw new Error(`Frame ${this.stamp} never painted`);
  }

  private finish(bits: Uint8Array, width: number, height: number): RenderedFrame {
    const preview = nativeImage
      .createFromBitmap(Buffer.from(unpackFrame(bits, width, height, 'bgra')), { width, height })
      .toDataURL();
    return { bits, preview };
  }
}
