import type { AmbientItem, AmbientReason, DisplayContent, Scene, SceneKind } from './scenes';
import { secondsLeft, TEXT_SIZES, type TextSize } from './scenes';

/**
 * Wire protocol v1: one JSON object per line. Amounts are integer paise.
 * The same messages travel over USB serial, WebSocket and in-process links.
 */

export const PROTOCOL_VERSION = 1;

/** Interval between pings from the PC. */
export const PING_INTERVAL_MS = 5_000;
/** A display that hears nothing for this long drops any pay QR and shows Ambient. */
export const LINK_LOSS_MS = 10_000;
/** Longest line either side accepts. Frame payloads are raw bytes after their header, never a line. */
export const MAX_LINE_LENGTH = 64 * 1024;

export type WireText = Record<string, string>;

export type WireAmbientItem =
  | { k: 'logo' }
  | ({ k: 'rating'; url: string } & WireText)
  | ({ k: 'text' } & WireText)
  | { k: 'image'; src: string }
  | ({ k: 'standee' } & WireText);

export interface PayMessage {
  v: 1;
  t: 'pay';
  seq: number;
  amt: number;
  ref: string;
  /** Seconds left. The display enforces it itself, so a crashed PC can't leave a QR up. */
  ttl: number;
  /** Web transports only. Smart devices build the link from the payee in their own flash. */
  uri?: string;
}

export interface ClearMessage {
  v: 1;
  t: 'clear';
  seq: number;
  then: 'thanks' | 'ambient';
}

export interface PlaylistMessage {
  v: 1;
  t: 'playlist';
  items: WireAmbientItem[];
  /** Seconds per slide. Devices may use a slower rate their panel needs. */
  slide?: number;
  /** Slides change only when the cashier presses a key: show slide `index`. */
  manual?: boolean;
  index?: number;
}

export interface PingMessage {
  v: 1;
  t: 'ping';
  seq: number;
}

/** Web and smart transports: branding and wording. Frame devices never need it. */
export interface ContentMessage {
  v: 1;
  t: 'content';
  shop: string;
  payee: string;
  accent: string;
  logo?: string;
  langs: string[];
  thanks: number;
  rating?: string;
  /** The shop's standee QR (no amount), for the standee slide. */
  standee?: string;
}

/**
 * Frame-mode devices: followed by `len` raw bytes (see frame.ts), then the device's ack.
 * `scene` and `ttl` let the device enforce the safety rules itself: it keeps the last
 * Ambient frame and falls back to it when a pay frame's ttl runs out or the PC goes quiet.
 */
export interface FrameMessage {
  v: 1;
  t: 'frame';
  seq: number;
  w: number;
  h: number;
  fmt: '1bpp' | '2bpp' | 'rgb565';
  len: number;
  refresh: 'full' | 'partial';
  scene?: SceneKind;
  /** Seconds a pay frame may stay up. */
  ttl?: number;
  /** How the panel is mounted. */
  rot?: 0 | 90 | 180 | 270;
}

/** Asks a device to send its hello, for boards that don't reset when the port opens. */
export interface WhoMessage {
  v: 1;
  t: 'who';
}

/** Shows a test pattern (size, orientation, colour bars) for a few seconds, then the scene again. */
export interface TestMessage {
  v: 1;
  t: 'test';
  seq: number;
  seconds: number;
}

export type PcMessage =
  | PayMessage
  | ClearMessage
  | PlaylistMessage
  | PingMessage
  | ContentMessage
  | FrameMessage
  | TestMessage
  | WhoMessage;

export interface HelloMessage {
  t: 'hello';
  fw: string;
  w: number;
  h: number;
  /** Masked UPI ID held by a smart device, so the cashier can confirm its payee. */
  vpa?: string;
  /** A preset profile id, when the device knows its panel. */
  profile?: string;
  /** Frame boards: `silent` when the panel didn't answer its last full refresh (wiring or power). */
  panel?: string;
}

export interface AckMessage {
  t: 'ack';
  seq: number;
  scene: SceneKind;
  /** Frame boards: `silent` when the panel didn't answer, so nothing was drawn. */
  panel?: string;
}

export interface StateMessage {
  t: 'state';
  scene: SceneKind;
  reason?: AmbientReason;
}

export type DisplayMessage = HelloMessage | AckMessage | StateMessage;

export function encodeLine(message: PcMessage | DisplayMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export interface SceneToMessageOptions {
  /** Include the full UPI link. True for web transports. */
  includeUri: boolean;
}

/** The message that puts a display into `scene`. Ambient and Thanks are both reached by a `clear`. */
export function sceneToMessage(
  scene: Scene,
  seq: number,
  now: number,
  options: SceneToMessageOptions,
): PayMessage | ClearMessage {
  switch (scene.kind) {
    case 'pay': {
      const message: PayMessage = {
        v: 1,
        t: 'pay',
        seq,
        amt: scene.amountPaise,
        ref: scene.ref,
        ttl: Math.max(1, secondsLeft(scene, now)),
      };
      if (options.includeUri) message.uri = scene.uri;
      return message;
    }
    case 'thanks':
      return { v: 1, t: 'clear', seq, then: 'thanks' };
    case 'ambient':
      return { v: 1, t: 'clear', seq, then: 'ambient' };
  }
}

export function toWirePlaylist(items: AmbientItem[]): WireAmbientItem[] {
  return items.map((item): WireAmbientItem => {
    switch (item.k) {
      case 'logo':
        return { k: 'logo' };
      case 'rating':
        return { ...(item.text ?? {}), k: 'rating', url: item.url, ...(item.size ? { size: item.size } : {}) };
      case 'text':
        return { ...item.text, k: 'text', ...(item.size ? { size: item.size } : {}) };
      case 'image':
        return { k: 'image', src: item.src };
      case 'standee':
        return { ...(item.text ?? {}), k: 'standee', ...(item.size ? { size: item.size } : {}) };
    }
  });
}

function withSize(item: AmbientItem, size: string | undefined): AmbientItem {
  return TEXT_SIZES.includes(size as TextSize) ? ({ ...item, size } as AmbientItem) : item;
}

export function fromWirePlaylist(items: WireAmbientItem[]): AmbientItem[] {
  return items.flatMap((item): AmbientItem[] => {
    switch (item.k) {
      case 'logo':
        return [{ k: 'logo' }];
      case 'rating': {
        const { k: _k, url, size, ...text } = item as typeof item & { size?: string };
        const base: AmbientItem = Object.keys(text).length ? { k: 'rating', url, text: text as WireText } : { k: 'rating', url };
        return [withSize(base, size)];
      }
      case 'text': {
        const { k: _k, size, ...text } = item as typeof item & { size?: string };
        return [withSize({ k: 'text', text: text as WireText }, size)];
      }
      case 'image':
        return [{ k: 'image', src: item.src }];
      case 'standee': {
        const { k: _k, size, ...text } = item as typeof item & { size?: string };
        return [withSize(Object.keys(text).length ? { k: 'standee', text: text as WireText } : { k: 'standee' }, size)];
      }
      default:
        return [];
    }
  });
}

export function contentToMessages(content: DisplayContent): [ContentMessage, PlaylistMessage] {
  const message: ContentMessage = {
    v: 1,
    t: 'content',
    shop: content.shopName,
    payee: content.payeeLabel,
    accent: content.accent,
    langs: content.languages,
    thanks: content.thanks.seconds,
  };
  if (content.logoUrl) message.logo = content.logoUrl;
  if (content.thanks.ratingUrl) message.rating = content.thanks.ratingUrl;
  if (content.standeeUri) message.standee = content.standeeUri;
  return [
    message,
    {
      v: 1,
      t: 'playlist',
      items: toWirePlaylist(content.ambient.items),
      slide: content.ambient.slideSeconds,
      ...(content.ambient.advance === 'key' ? { manual: true, index: content.ambient.index ?? 0 } : {}),
    },
  ];
}

const SCENE_KINDS: readonly string[] = ['ambient', 'pay', 'thanks'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStringRecord(value: Record<string, unknown>, skip: string[]): boolean {
  return Object.entries(value).every(([key, v]) => skip.includes(key) || typeof v === 'string');
}

function isWireItem(value: unknown): value is WireAmbientItem {
  if (!isObject(value)) return false;
  switch (value.k) {
    case 'logo':
      return true;
    case 'rating':
      return typeof value.url === 'string' && isStringRecord(value, ['k', 'url', 'size']);
    case 'text':
      return isStringRecord(value, ['k', 'size']);
    case 'image':
      return typeof value.src === 'string';
    case 'standee':
      return isStringRecord(value, ['k', 'size']);
    default:
      return false;
  }
}

/** Validates a message from a display. Anything malformed is dropped, never trusted. */
export function parseDisplayMessage(value: unknown): DisplayMessage | null {
  if (!isObject(value)) return null;
  switch (value.t) {
    case 'hello':
      if (typeof value.fw !== 'string' || !isCount(value.w) || !isCount(value.h)) return null;
      if (value.vpa !== undefined && typeof value.vpa !== 'string') return null;
      if (value.profile !== undefined && typeof value.profile !== 'string') return null;
      if (value.panel !== undefined && typeof value.panel !== 'string') return null;
      return value as unknown as HelloMessage;
    case 'ack':
      if (!isCount(value.seq) || !SCENE_KINDS.includes(value.scene as string)) return null;
      if (value.panel !== undefined && typeof value.panel !== 'string') return null;
      return value as unknown as AckMessage;
    case 'state':
      if (!SCENE_KINDS.includes(value.scene as string)) return null;
      if (value.reason !== undefined && typeof value.reason !== 'string') return null;
      return value as unknown as StateMessage;
    default:
      return null;
  }
}

/** Validates a message from the PC. Used by the display page and by firmware test harnesses. */
export function parsePcMessage(value: unknown): PcMessage | null {
  if (!isObject(value) || value.v !== PROTOCOL_VERSION) return null;
  switch (value.t) {
    case 'pay':
      if (!isCount(value.seq) || !isCount(value.amt) || value.amt === 0) return null;
      if (typeof value.ref !== 'string' || !isCount(value.ttl)) return null;
      if (value.uri !== undefined && typeof value.uri !== 'string') return null;
      return value as unknown as PayMessage;
    case 'clear':
      if (!isCount(value.seq) || (value.then !== 'thanks' && value.then !== 'ambient')) return null;
      return value as unknown as ClearMessage;
    case 'playlist':
      if (!Array.isArray(value.items) || !value.items.every(isWireItem)) return null;
      if (value.slide !== undefined && !isCount(value.slide)) return null;
      return value as unknown as PlaylistMessage;
    case 'ping':
      return isCount(value.seq) ? (value as unknown as PingMessage) : null;
    case 'content':
      if (typeof value.shop !== 'string' || typeof value.payee !== 'string') return null;
      if (typeof value.accent !== 'string' || !isCount(value.thanks)) return null;
      if (!Array.isArray(value.langs) || !value.langs.every((l) => typeof l === 'string')) return null;
      return value as unknown as ContentMessage;
    case 'frame':
      if (!isCount(value.seq) || !isCount(value.w) || !isCount(value.h) || !isCount(value.len)) return null;
      return value as unknown as FrameMessage;
    case 'test':
      return isCount(value.seq) && isCount(value.seconds) ? (value as unknown as TestMessage) : null;
    case 'who':
      return value as unknown as WhoMessage;
    default:
      return null;
  }
}

/**
 * Splits a byte stream into JSON lines. Partial lines are kept until their newline
 * arrives; lines that are too long or not JSON are reported and skipped.
 *
 * With `skipNoise`, a line that starts with garbage still yields the JSON object at its
 * end. Serial links need this: an ESP32 prints its boot messages at another baud rate,
 * and they arrive as noise on the same line as the board's first hello.
 */
export class LineDecoder {
  private buffer = '';

  constructor(
    private readonly onError: (reason: 'too-long' | 'bad-json', line: string) => void = () => {},
    private readonly options: { skipNoise?: boolean } = {},
  ) {}

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const values: unknown[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '').trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        const value = this.parse(line);
        if (value === undefined) this.onError('bad-json', line);
        else values.push(value);
      }
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_LINE_LENGTH) {
      this.onError('too-long', this.buffer.slice(0, 80));
      this.buffer = '';
    }
    return values;
  }

  private parse(line: string): unknown {
    try {
      return JSON.parse(line);
    } catch {
      if (!this.options.skipNoise) return undefined;
    }
    // Try each `{"` from the left: the first that parses to the end of the line is the message.
    for (let at = line.indexOf('{"', 1); at !== -1; at = line.indexOf('{"', at + 1)) {
      try {
        return JSON.parse(line.slice(at));
      } catch {
        // Still noise; keep looking.
      }
    }
    return undefined;
  }
}
