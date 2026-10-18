import { DEFAULT_MAX_RUPEES } from './amount';
import type { Rotation } from './profiles';
import { DEFAULT_REF_PREFIX, isValidRefPrefix } from './refs';
import type { AmbientItem, LocalText } from './scenes';

export const CONFIG_SCHEMA_VERSION = 1;

export type DriverKind = 'simulator' | 'window' | 'web' | 'serial-frame' | 'wifi-frame' | 'serial-smart';

export interface DisplayConfig {
  id: string;
  driver: DriverKind;
  enabled: boolean;
  name?: string;
  /** Window driver: 1-based monitor number, as Windows numbers them. */
  monitor?: number;
  rotation?: Rotation;
  /** Web driver: the code a phone or tablet enters to pair. */
  pairingCode?: string;
  /** Serial drivers: a COM port, or `auto`. */
  port?: string;
  profile?: string;
  /** Wi-Fi frame displays: the display's own id, its address when it was paired (host:port), and its key. */
  device?: string;
  address?: string;
  key?: string;
}

export interface CounterPayConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  upi: {
    /** The decoded standee QR. Empty until first-run setup imports it. */
    baseUri: string;
    payeeLabel: string;
    addMam: boolean;
  };
  shortcuts: { summon: string; clear: string };
  pay: { ttlSeconds: number; maxRupees: number; refPrefix: string };
  thanks: { seconds: number; text?: LocalText };
  displays: DisplayConfig[];
  ambient: { slideSeconds: number; items: AmbientItem[] };
  brand: { shopName: string; logoPath: string; accent: string };
  /** Customer display languages, primary first; two are shown together. The app itself is in English. */
  language: { display: string[] };
  history: { retentionDays: number };
  api: { enabled: boolean; token: string };
  updates: { channel: 'stable' | 'beta'; quietHours: [string, string] };
  /** Local display server (127.0.0.1) and Wi-Fi display server. Changes apply on restart. */
  server: { localPort: number; lanPort: number };
  startAtLogin: boolean;
}

export interface ConfigSecrets {
  /** A random bearer token for the local API. */
  token(): string;
  /** A short code a phone enters to pair as a Web display. */
  pairingCode(): string;
}

export const DEFAULT_ACCENT = '#14B37D';
export const DEFAULT_LOCAL_PORT = 5178;
export const DEFAULT_LAN_PORT = 5179;
/**
 * Languages the customer display can show. English plus the common Indian languages;
 * a display shows up to two at once. Each has a locale file with at least the display text.
 */
export const DISPLAY_LANGUAGES = ['en', 'hi', 'bn', 'mr', 'te', 'ta', 'gu', 'kn', 'ml', 'pa', 'or'] as const;

export function defaultConfig(secrets: ConfigSecrets): CounterPayConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    upi: { baseUri: '', payeeLabel: '', addMam: false },
    shortcuts: { summon: 'F9', clear: 'Shift+F9' },
    pay: { ttlSeconds: 180, maxRupees: DEFAULT_MAX_RUPEES, refPrefix: DEFAULT_REF_PREFIX },
    thanks: { seconds: 10 },
    displays: [{ id: 'sim', driver: 'simulator', enabled: true, name: 'Simulator' }],
    ambient: {
      slideSeconds: 8,
      items: [{ k: 'logo' }],
    },
    brand: { shopName: '', logoPath: '', accent: DEFAULT_ACCENT },
    language: { display: ['en'] },
    history: { retentionDays: 365 },
    api: { enabled: false, token: secrets.token() },
    updates: { channel: 'stable', quietHours: ['22:00', '08:00'] },
    server: { localPort: DEFAULT_LOCAL_PORT, lanPort: DEFAULT_LAN_PORT },
    startAtLogin: true,
  };
}

const DRIVERS: readonly DriverKind[] = ['simulator', 'window', 'web', 'serial-frame', 'wifi-frame', 'serial-smart'];
const ROTATIONS: readonly number[] = [0, 90, 180, 270];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function localText(value: unknown): LocalText | undefined {
  if (!isObject(value)) return undefined;
  const entries = Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function ambientItem(value: unknown): AmbientItem | null {
  if (!isObject(value)) return null;
  switch (value.k) {
    case 'logo':
      return { k: 'logo' };
    case 'rating': {
      if (typeof value.url !== 'string') return null;
      const text = localText(value.text);
      return text ? { k: 'rating', url: value.url, text } : { k: 'rating', url: value.url };
    }
    case 'text': {
      const text = localText(value.text);
      return text ? { k: 'text', text } : null;
    }
    case 'image':
      return typeof value.src === 'string' ? { k: 'image', src: value.src } : null;
    case 'standee': {
      const text = localText(value.text);
      return text ? { k: 'standee', text } : { k: 'standee' };
    }
    default:
      return null;
  }
}

function displayConfig(value: unknown): DisplayConfig | null {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id) return null;
  if (!DRIVERS.includes(value.driver as DriverKind)) return null;
  const display: DisplayConfig = { id: value.id, driver: value.driver as DriverKind, enabled: bool(value.enabled, false) };
  if (typeof value.name === 'string') display.name = value.name;
  if (typeof value.monitor === 'number') display.monitor = int(value.monitor, 1, 1, 16);
  if (ROTATIONS.includes(value.rotation as number)) display.rotation = value.rotation as Rotation;
  if (typeof value.pairingCode === 'string') display.pairingCode = value.pairingCode;
  if (typeof value.port === 'string') display.port = value.port;
  if (typeof value.profile === 'string') display.profile = value.profile;
  if (typeof value.device === 'string') display.device = value.device;
  if (typeof value.address === 'string') display.address = value.address;
  if (typeof value.key === 'string') display.key = value.key;
  return display;
}

/**
 * Brings any stored value up to the current schema: unknown keys dropped, missing
 * keys defaulted, numbers clamped. A broken config never stops the agent starting.
 */
export function normalizeConfig(raw: unknown, secrets: ConfigSecrets): CounterPayConfig {
  const d = defaultConfig(secrets);
  const r = isObject(raw) ? migrateConfig(raw) : {};
  const upi = isObject(r.upi) ? r.upi : {};
  const shortcuts = isObject(r.shortcuts) ? r.shortcuts : {};
  const pay = isObject(r.pay) ? r.pay : {};
  const thanks = isObject(r.thanks) ? r.thanks : {};
  const ambient = isObject(r.ambient) ? r.ambient : {};
  const brand = isObject(r.brand) ? r.brand : {};
  const language = isObject(r.language) ? r.language : {};
  const history = isObject(r.history) ? r.history : {};
  const api = isObject(r.api) ? r.api : {};
  const updates = isObject(r.updates) ? r.updates : {};
  const server = isObject(r.server) ? r.server : {};
  const localPort = int(server.localPort, d.server.localPort, 1024, 65535);
  const lanPort = int(server.lanPort, d.server.lanPort, 1024, 65535);

  const refPrefix = str(pay.refPrefix, d.pay.refPrefix).toUpperCase();
  const displays = Array.isArray(r.displays)
    ? r.displays.map(displayConfig).filter((x): x is DisplayConfig => x !== null)
    : d.displays;
  const items = Array.isArray(ambient.items)
    ? ambient.items.map(ambientItem).filter((x): x is AmbientItem => x !== null)
    : d.ambient.items;
  const displayLangs = Array.isArray(language.display)
    ? language.display.filter((l): l is string => typeof l === 'string' && l.length > 0).slice(0, 2)
    : d.language.display;
  const quietHours =
    Array.isArray(updates.quietHours) &&
    updates.quietHours.length === 2 &&
    updates.quietHours.every((t) => typeof t === 'string' && TIME_PATTERN.test(t))
      ? (updates.quietHours as [string, string])
      : d.updates.quietHours;
  const thanksText = localText(thanks.text);

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    upi: {
      baseUri: str(upi.baseUri, d.upi.baseUri),
      payeeLabel: str(upi.payeeLabel, d.upi.payeeLabel),
      addMam: bool(upi.addMam, d.upi.addMam),
    },
    shortcuts: {
      summon: str(shortcuts.summon, d.shortcuts.summon) || d.shortcuts.summon,
      clear: str(shortcuts.clear, d.shortcuts.clear) || d.shortcuts.clear,
    },
    pay: {
      ttlSeconds: int(pay.ttlSeconds, d.pay.ttlSeconds, 30, 900),
      maxRupees: int(pay.maxRupees, d.pay.maxRupees, 1, 10_000_000),
      refPrefix: isValidRefPrefix(refPrefix) ? refPrefix : d.pay.refPrefix,
    },
    thanks: { seconds: int(thanks.seconds, d.thanks.seconds, 0, 60), ...(thanksText ? { text: thanksText } : {}) },
    displays: displays.some((x) => x.driver === 'simulator') ? displays : [...d.displays, ...displays],
    ambient: {
      slideSeconds: int(ambient.slideSeconds, d.ambient.slideSeconds, 3, 600),
      items: items.length ? items : d.ambient.items,
    },
    brand: {
      shopName: str(brand.shopName, d.brand.shopName),
      logoPath: str(brand.logoPath, d.brand.logoPath),
      accent: HEX_PATTERN.test(str(brand.accent, '')) ? str(brand.accent, '') : d.brand.accent,
    },
    language: { display: displayLangs.length ? displayLangs : d.language.display },
    history: { retentionDays: int(history.retentionDays, d.history.retentionDays, 1, 3650) },
    api: { enabled: bool(api.enabled, d.api.enabled), token: str(api.token, '') || d.api.token },
    updates: { channel: updates.channel === 'beta' ? 'beta' : 'stable', quietHours },
    server: { localPort, lanPort: lanPort === localPort ? (localPort === 65535 ? 65534 : localPort + 1) : lanPort },
    startAtLogin: bool(r.startAtLogin, d.startAtLogin),
  };
}

/**
 * Upgrades older stored shapes step by step. The agent backs up the config file
 * before calling this with a version change.
 */
export function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : CONFIG_SCHEMA_VERSION;
  if (version > CONFIG_SCHEMA_VERSION) {
    // Written by a newer app (e.g. after "Reinstall previous version"). Read what we understand.
    return raw;
  }
  // v1 is the first schema. Future steps go here: if (version < 2) raw = v1ToV2(raw); …
  return raw;
}

/** Is the payee set up well enough to show a QR? */
export function isPayeeConfigured(config: Pick<CounterPayConfig, 'upi'>): boolean {
  return /^upi:\/\/pay\?/i.test(config.upi.baseUri) && /[?&]pa=[^&]+/i.test(config.upi.baseUri);
}
