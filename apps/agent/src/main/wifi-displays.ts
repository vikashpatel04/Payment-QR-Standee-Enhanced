import {
  type AnnounceMessage,
  type DenyReason,
  DISCOVERY_PORT,
  type DisplayConfig,
  type DisplayHandshake,
  parseAnnounce,
  parseHandshake,
  splitAddress,
} from '@counterpay/core';
import type { DriverStatus, SerialLink, SerialPorts } from '@counterpay/drivers';
import { createHmac } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { connect, type Socket } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';

/** A display that answered on the network, ready to pair or already paired. */
export interface FoundDisplay {
  id: string;
  name: string;
  fw: string;
  w: number;
  h: number;
  profile?: string;
  /** host:port of its frame server. */
  address: string;
  paired: boolean;
  rotation?: 0 | 90 | 180 | 270;
}

export type PairFailure = DenyReason | 'unreachable' | 'address';

/** Thrown when a display refuses: the driver shows the detail ("Pair again") instead of just waiting. */
export class DisplayRefused extends Error {
  readonly detail: DriverStatus['detail'];
  constructor(readonly reason: PairFailure) {
    super(`Display refused: ${reason}`);
    this.detail = reason === 'key' ? 'unpaired' : undefined;
  }
}

const HANDSHAKE_MS = 5_000;
/** Wi-Fi displays answer every ping; this much silence means the link is gone, even if TCP hasn't noticed. */
const SILENCE_MS = 12_000;

/** The broadcast address of every IPv4 network this PC is on, plus the limited broadcast. */
function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      const ip = net.address.split('.').map(Number);
      const mask = net.netmask.split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      out.add(ip.map((part, i) => (part & mask[i]!) | (~mask[i]! & 255)).join('.'));
    }
  }
  return [...out];
}

/**
 * Asks the network who is there. Replies to a broadcast this PC sent are let in by the
 * Windows firewall, so nothing needs opening for discovery. `hosts` are asked directly too,
 * for networks that drop broadcasts.
 */
export function discover(options: { timeoutMs?: number; hosts?: string[] } = {}): Promise<FoundDisplay[]> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const found = new Map<string, FoundDisplay>();
  return new Promise((resolve) => {
    const socket = createSocket({ type: 'udp4' });
    const finish = () => {
      clearTimeout(timer);
      clearTimeout(again);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    let again: NodeJS.Timeout | undefined;
    socket.on('error', finish);
    socket.on('message', (data, from) => {
      let value: unknown;
      try {
        value = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      const announce = parseAnnounce(value);
      if (announce) found.set(announce.id, toFound(announce, from.address));
    });
    socket.bind(0, () => {
      socket.setBroadcast(true);
      const message = Buffer.from(`${JSON.stringify({ v: 1, t: 'discover' })}\n`);
      const targets = [...broadcastAddresses(), ...(options.hosts ?? [])];
      const send = () => {
        for (const host of targets) socket.send(message, DISCOVERY_PORT, host, () => {});
      };
      send();
      // UDP can drop a packet; ask once more halfway through.
      again = setTimeout(send, timeoutMs / 2);
    });
  });
}

function toFound(announce: AnnounceMessage, host: string): FoundDisplay {
  return {
    id: announce.id,
    name: announce.name,
    fw: announce.fw,
    w: announce.w,
    h: announce.h,
    ...(announce.profile ? { profile: announce.profile } : {}),
    address: `${host}:${announce.port}`,
    paired: announce.paired,
    ...(announce.rotation !== undefined ? { rotation: announce.rotation } : {}),
  };
}

/** A TCP connection to a display, read line by line until the frame protocol takes over. */
class Handshake {
  private text = '';
  private waiting: ((message: DisplayHandshake | null) => void) | null = null;
  private queue: Array<DisplayHandshake | null> = [];
  private closed = false;

  private constructor(readonly socket: Socket) {
    socket.on('data', this.onData);
    socket.on('close', () => {
      this.closed = true;
      this.deliver(null);
    });
    socket.on('error', () => {});
  }

  static open(address: string): Promise<Handshake> {
    const target = splitAddress(address);
    if (!target) return Promise.reject(new DisplayRefused('address'));
    return new Promise((resolve, reject) => {
      const socket = connect({ host: target.host, port: target.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new DisplayRefused('unreachable'));
      }, HANDSHAKE_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 5_000);
        resolve(new Handshake(socket));
      });
      socket.once('error', () => {
        clearTimeout(timer);
        reject(new DisplayRefused('unreachable'));
      });
    });
  }

  private readonly onData = (chunk: Buffer) => {
    this.text += chunk.toString('latin1');
    let newline = this.text.indexOf('\n');
    while (newline !== -1) {
      const line = this.text.slice(0, newline).trim();
      this.text = this.text.slice(newline + 1);
      if (line) {
        let value: unknown = null;
        try {
          value = JSON.parse(line);
        } catch {
          // Not a handshake line.
        }
        this.deliver(parseHandshake(value));
      }
      newline = this.text.indexOf('\n');
    }
  };

  private deliver(message: DisplayHandshake | null): void {
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting(message);
    } else {
      this.queue.push(message);
    }
  }

  /** The next handshake line, or null when the display hangs up, says nonsense or takes too long. */
  next(): Promise<DisplayHandshake | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        resolve(null);
      }, HANDSHAKE_MS);
      this.waiting = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }

  send(message: object): void {
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  /** Hands the socket to the frame driver: any bytes that arrived after the handshake come first. */
  release(): SerialLink {
    this.socket.off('data', this.onData);
    const leftover = Buffer.from(this.text, 'latin1');
    const socket = this.socket;
    let silence: NodeJS.Timeout | undefined;
    const watch = () => {
      clearTimeout(silence);
      silence = setTimeout(() => socket.destroy(), SILENCE_MS);
    };
    watch();
    socket.on('data', watch);
    socket.on('close', () => clearTimeout(silence));
    return {
      write: (data) => {
        if (!socket.destroyed) socket.write(typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data));
      },
      onData: (handler) => {
        if (leftover.length) handler(new Uint8Array(leftover));
        socket.on('data', (chunk: Buffer) => handler(new Uint8Array(chunk)));
      },
      onClose: (handler) => {
        socket.on('close', () => handler());
      },
      close: () =>
        new Promise<void>((resolve) => {
          clearTimeout(silence);
          if (socket.destroyed) return resolve();
          socket.once('close', () => resolve());
          socket.destroy();
        }),
    };
  }

  close(): void {
    this.socket.destroy();
  }
}

function mac(key: string, nonce: string): string {
  return createHmac('sha256', Buffer.from(key, 'hex')).update(nonce, 'utf8').digest('hex');
}

/** Opens and authenticates a link to a paired display. Throws DisplayRefused when it won't have us. */
async function authenticate(address: string, deviceId: string, key: string): Promise<Handshake> {
  const link = await Handshake.open(address);
  const challenge = await link.next();
  if (!challenge || challenge.t !== 'challenge') {
    link.close();
    throw new DisplayRefused('unreachable');
  }
  if (challenge.id !== deviceId) {
    // Another display now has this address.
    link.close();
    throw new DisplayRefused('unreachable');
  }
  link.send({ v: 1, t: 'auth', mac: mac(key, challenge.nonce) });
  const reply = await link.next();
  if (reply?.t === 'authed') return link;
  link.close();
  throw new DisplayRefused(reply?.t === 'denied' ? reply.reason : 'unreachable');
}

/** Pairs with the display at `address` using the code on its screen. Returns its id and key. */
export async function pair(address: string, code: string): Promise<{ id: string; key: string }> {
  const link = await Handshake.open(address);
  try {
    const challenge = await link.next();
    if (!challenge || challenge.t !== 'challenge') throw new DisplayRefused('unreachable');
    link.send({ v: 1, t: 'pair', code, pc: hostname().slice(0, 64) });
    const reply = await link.next();
    if (reply?.t === 'paired') return { id: challenge.id, key: reply.key };
    throw new DisplayRefused(reply?.t === 'denied' ? reply.reason : 'unreachable');
  } finally {
    link.close();
  }
}

/** Tells a paired display to forget this PC, so it shows its pairing code again. Best effort. */
export async function unpair(config: DisplayConfig): Promise<void> {
  if (!config.device || !config.key) return;
  const found = await discover({ timeoutMs: 1_000, hosts: hostsOf(config) });
  const address = found.find((d) => d.id === config.device)?.address ?? config.address;
  if (!address) return;
  const link = await authenticate(address, config.device, config.key);
  link.send({ v: 1, t: 'unpair' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  link.close();
}

function hostsOf(config: DisplayConfig): string[] {
  const target = config.address ? splitAddress(config.address) : null;
  return target ? [target.host] : [];
}

/**
 * How the frame driver reaches one paired Wi-Fi display: look it up by id on the network
 * (its address may have changed), falling back to the address it was paired at.
 */
export function wifiPorts(config: DisplayConfig): SerialPorts {
  return {
    async detect() {
      const found = await discover({ timeoutMs: 1_200, hosts: hostsOf(config) });
      return found.find((d) => d.id === config.device)?.address ?? config.address ?? null;
    },
    async open(address) {
      return (await authenticate(address, config.device ?? '', config.key ?? '')).release();
    },
  };
}
