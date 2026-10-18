/**
 * Wi-Fi frame displays (a Raspberry Pi with an e-Paper HAT, an ESP32 on Wi-Fi…) speak the
 * same frame protocol as USB boards, over TCP, once the PC has proved it is the PC the
 * display was paired with. Full description: docs/DISPLAY-PROTOCOL.md.
 *
 *   Finding:  the PC sends `discover` as a UDP broadcast to DISCOVERY_PORT; displays answer
 *             with `announce` to the sender.
 *   Pairing:  the display shows a 6-digit code on its own screen. The PC connects over TCP,
 *             gets a `challenge`, sends `pair` with the code, and receives the display's key.
 *   Later:    every connection starts with a fresh `challenge`; the PC answers with
 *             `auth` = HMAC-SHA256(key, nonce). The key itself never crosses the network again.
 *   Then:     who / hello / frame / ack / ping / state, exactly as over USB.
 *
 * A display only ever shows what an authenticated PC sends, so nobody else on the shop
 * Wi-Fi can put their own QR on it.
 */

export const DISCOVERY_PORT = 5180;
export const DISPLAY_TCP_PORT = 5181;

export interface DiscoverMessage {
  v: 1;
  t: 'discover';
}

export interface AnnounceMessage {
  v: 1;
  t: 'announce';
  /** Stable for the life of the display; survives address changes. */
  id: string;
  name: string;
  fw: string;
  /** Panel size in its landscape orientation. */
  w: number;
  h: number;
  profile?: string;
  /** TCP port of the display's frame server. */
  port: number;
  /** Already paired with a PC: it won't accept a new pairing until it is reset. */
  paired: boolean;
  /** How the panel is mounted, so the PC can draw upright from the start. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface ChallengeMessage {
  v: 1;
  t: 'challenge';
  id: string;
  nonce: string;
  paired: boolean;
}

export interface PairMessage {
  v: 1;
  t: 'pair';
  code: string;
  /** The PC's name, for the display's own log. */
  pc?: string;
}

export interface AuthMessage {
  v: 1;
  t: 'auth';
  mac: string;
}

export interface UnpairMessage {
  v: 1;
  t: 'unpair';
}

export interface PairedMessage {
  v: 1;
  t: 'paired';
  key: string;
}

export interface AuthedMessage {
  v: 1;
  t: 'authed';
}

export type DenyReason = 'code' | 'key' | 'paired' | 'busy';

export interface DeniedMessage {
  v: 1;
  t: 'denied';
  reason: DenyReason;
}

export type DisplayHandshake = ChallengeMessage | PairedMessage | AuthedMessage | DeniedMessage;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEX = /^[0-9a-f]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536;
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 4096;
}

/** A display's answer to `discover`. Anything malformed is ignored. */
export function parseAnnounce(value: unknown): AnnounceMessage | null {
  if (!isObject(value) || value.v !== 1 || value.t !== 'announce') return null;
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null;
  if (typeof value.name !== 'string' || value.name.length > 64) return null;
  if (typeof value.fw !== 'string' || value.fw.length > 32) return null;
  if (!isSize(value.w) || !isSize(value.h) || !isPort(value.port) || typeof value.paired !== 'boolean') return null;
  if (value.profile !== undefined && (typeof value.profile !== 'string' || value.profile.length > 64)) return null;
  if (value.rotation !== undefined && ![0, 90, 180, 270].includes(value.rotation as number)) return null;
  return value as unknown as AnnounceMessage;
}

/** What a display says before the frame protocol starts. */
export function parseHandshake(value: unknown): DisplayHandshake | null {
  if (!isObject(value) || value.v !== 1) return null;
  switch (value.t) {
    case 'challenge':
      if (typeof value.id !== 'string' || !ID.test(value.id) || typeof value.paired !== 'boolean') return null;
      if (typeof value.nonce !== 'string' || value.nonce.length < 16 || value.nonce.length > 128 || !HEX.test(value.nonce)) return null;
      return value as unknown as ChallengeMessage;
    case 'paired':
      if (typeof value.key !== 'string' || value.key.length !== 64 || !HEX.test(value.key)) return null;
      return value as unknown as PairedMessage;
    case 'authed':
      return value as unknown as AuthedMessage;
    case 'denied':
      if (!['code', 'key', 'paired', 'busy'].includes(value.reason as string)) return null;
      return value as unknown as DeniedMessage;
    default:
      return null;
  }
}

/** The 6-digit code a display shows while it waits to be paired. */
export function isPairingCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * `host:port`, with the display port as the default. The host can be an IP address or a
 * name such as `counter.local`; a `user@` in front (as people copy it from SSH) is ignored.
 */
export function splitAddress(address: string): { host: string; port: number } | null {
  const match = /^\s*(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?\s*$/.exec(address);
  if (!match) return null;
  const port = match[2] ? Number(match[2]) : DISPLAY_TCP_PORT;
  return isPort(port) ? { host: match[1]!, port } : null;
}
