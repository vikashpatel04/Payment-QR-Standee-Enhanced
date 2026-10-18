/**
 * A display profile describes a screen so scene layouts can adapt: portrait or
 * landscape, colour or mono, small or large, and how fast it can refresh.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface DisplayProfile {
  id: string;
  /** The panel's product name, for pickers. */
  name?: string;
  /** Logical size in CSS pixels, before rotation. */
  w: number;
  h: number;
  color: 'color' | 'gray4' | 'mono';
  tech: 'monitor' | 'lcd' | 'eink';
  /** Browser displays render the display page; smart devices draw scenes; frame devices show PC-rendered pixels. */
  mode: 'browser' | 'smart' | 'frame';
  refresh?: { fullMs: number; partialMs?: number };
  rotation: Rotation;
  /** Panels that can't animate use a slower Ambient slide rate than the config's. */
  slideSeconds?: number;
}

export const PROFILE_PRESETS: Readonly<Record<string, DisplayProfile>> = {
  /** The reference customer display: 3.5" portrait colour TFT. */
  'tft-3in5': { id: 'tft-3in5', w: 320, h: 480, color: 'color', tech: 'lcd', mode: 'smart', rotation: 0 },
  /** Waveshare 2.13" e-Paper HAT V4 (SSD1680, FPC-A002). Small: a UPI QR fits at 2 px per module. */
  'waveshare-2in13-v4': {
    id: 'waveshare-2in13-v4',
    name: 'Waveshare 2.13" e-Paper V4',
    w: 250,
    h: 122,
    color: 'mono',
    tech: 'eink',
    mode: 'frame',
    refresh: { fullMs: 2000, partialMs: 400 },
    rotation: 0,
    slideSeconds: 60,
  },
  /**
   * Waveshare 2.13" e-Paper HAT (B) V4: black, white and red; only black is used. No partial
   * refresh. A full refresh measured 4.4 s on a Raspberry Pi; true three-colour glass can take
   * up to 15 s, hence the long ack allowance and the slow Ambient rotation.
   */
  'waveshare-2in13b-v4': {
    id: 'waveshare-2in13b-v4',
    name: 'Waveshare 2.13" e-Paper (B) V4, red',
    w: 250,
    h: 122,
    color: 'mono',
    tech: 'eink',
    mode: 'frame',
    refresh: { fullMs: 16000 },
    rotation: 0,
    slideSeconds: 120,
  },
  'waveshare-4in2': {
    id: 'waveshare-4in2',
    name: 'Waveshare 4.2" e-Paper V2',
    w: 400,
    h: 300,
    color: 'mono',
    tech: 'eink',
    mode: 'frame',
    refresh: { fullMs: 2000, partialMs: 400 },
    rotation: 0,
    slideSeconds: 60,
  },
  'waveshare-7in5': {
    id: 'waveshare-7in5',
    name: 'Waveshare 7.5" e-Paper V2',
    w: 800,
    h: 480,
    color: 'mono',
    tech: 'eink',
    mode: 'frame',
    refresh: { fullMs: 4000 },
    rotation: 0,
    slideSeconds: 60,
  },
  /** Simulator, phones and monitors: the display page fills whatever it is given. */
  browser: { id: 'browser', w: 320, h: 480, color: 'color', tech: 'monitor', mode: 'browser', rotation: 0 },
};

/** Panels a frame-mode USB display can use, for the Displays page. */
export function frameProfiles(): DisplayProfile[] {
  return Object.values(PROFILE_PRESETS).filter((p) => p.mode === 'frame');
}

export function getProfile(id: string | undefined): DisplayProfile {
  return (id && PROFILE_PRESETS[id]) || PROFILE_PRESETS.browser!;
}

export function isPortrait(profile: Pick<DisplayProfile, 'w' | 'h' | 'rotation'>): boolean {
  const turned = profile.rotation === 90 || profile.rotation === 270;
  return turned ? profile.w > profile.h : profile.h >= profile.w;
}

/**
 * Whole pixels per QR module for frame rendering: never anti-aliased, never dithered.
 * Returns 0 when the code can't fit at 2 px per module, which no scanner reads reliably.
 */
export function pixelsPerModule(availablePx: number, modules: number, quietZone = 4): number {
  const ppm = Math.floor(availablePx / (modules + quietZone * 2));
  return ppm >= 2 ? ppm : 0;
}
