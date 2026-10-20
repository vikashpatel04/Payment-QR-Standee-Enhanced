import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DisplayRefused, keyWorks, pair, wifiPorts } from '../src/main/wifi-displays';

/** A display on a local port that follows docs/DISPLAY-PROTOCOL.md (pairing and authentication only). */
class FakeDisplay {
  readonly id = 'fake01';
  code = '482913';
  key: string | null = null;
  received: string[] = [];
  private server: Server;
  port = 0;

  constructor() {
    this.server = createServer((socket) => this.session(socket));
  }

  listen(): Promise<void> {
    return new Promise((resolve) =>
      this.server.listen(0, '127.0.0.1', () => {
        this.port = (this.server.address() as { port: number }).port;
        resolve();
      }),
    );
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private session(socket: Socket): void {
    const nonce = randomBytes(16).toString('hex');
    const say = (message: object) => socket.write(`${JSON.stringify(message)}\n`);
    say({ v: 1, t: 'challenge', id: this.id, nonce, paired: this.key !== null });
    let authed = false;
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString('latin1');
      let newline = text.indexOf('\n');
      while (newline !== -1) {
        const message = JSON.parse(text.slice(0, newline)) as Record<string, string>;
        text = text.slice(newline + 1);
        newline = text.indexOf('\n');
        if (authed) {
          this.received.push(message.t!);
          if (message.t === 'who') say({ t: 'hello', fw: 'fake', w: 250, h: 122 });
          continue;
        }
        if (message.t === 'pair') {
          if (this.key) say({ v: 1, t: 'denied', reason: 'paired' });
          else if (message.code !== this.code) say({ v: 1, t: 'denied', reason: 'code' });
          else {
            this.key = randomBytes(32).toString('hex');
            say({ v: 1, t: 'paired', key: this.key });
            authed = true;
          }
        } else if (message.t === 'auth') {
          const want = this.key && createHmac('sha256', Buffer.from(this.key, 'hex')).update(nonce).digest('hex');
          if (want && want === message.mac) {
            say({ v: 1, t: 'authed' });
            authed = true;
          } else {
            say({ v: 1, t: 'denied', reason: 'key' });
            socket.end();
          }
        }
      }
    });
    socket.on('error', () => {});
  }
}

describe('Wi-Fi displays', () => {
  let display: FakeDisplay;
  let address: string;

  beforeEach(async () => {
    display = new FakeDisplay();
    await display.listen();
    address = `127.0.0.1:${display.port}`;
  });

  afterEach(() => display.close());

  it('pairs with the code shown on the display and gets its key', async () => {
    const result = await pair(address, '482913');
    expect(result).toEqual({ id: 'fake01', key: display.key });
    expect(result.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a wrong code, an already paired display and nobody listening', async () => {
    await expect(pair(address, '000000')).rejects.toMatchObject({ reason: 'code' });
    await pair(address, '482913');
    await expect(pair(address, '482913')).rejects.toMatchObject({ reason: 'paired' });
    await expect(pair('127.0.0.1:1', '482913')).rejects.toMatchObject({ reason: 'unreachable' });
    await expect(pair('not an address', '482913')).rejects.toMatchObject({ reason: 'address' });
  });

  it('opens an authenticated link with the key, without sending the key', async () => {
    const { id, key } = await pair(address, '482913');
    const ports = wifiPorts({ id: 'wifi-1', driver: 'wifi-frame', enabled: true, device: id, address, key });
    const link = await ports.open(address);
    const replies: string[] = [];
    link.onData((chunk) => replies.push(Buffer.from(chunk).toString('latin1')));
    link.write('{"v":1,"t":"who"}\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(display.received).toEqual(['who']);
    expect(replies.join('')).toContain('"t":"hello"');
    await link.close();
  });

  it('refuses a wrong key as "pair again"', async () => {
    const { id } = await pair(address, '482913');
    const ports = wifiPorts({ id: 'wifi-1', driver: 'wifi-frame', enabled: true, device: id, address, key: '0'.repeat(64) });
    const error = await ports.open(address).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DisplayRefused);
    expect(error).toMatchObject({ reason: 'key', detail: 'unpaired' });
  });

  it('tells whether a display still knows this PC, for pairing it again without a reset', async () => {
    const { id, key } = await pair(address, '482913');
    expect(await keyWorks(address, id, key)).toBe(true);
    expect(await keyWorks(address, id, '0'.repeat(64))).toBe(false);
    expect(await keyWorks('127.0.0.1:1', id, key)).toBe(false);
  });

  it('refuses to talk to a different display that took the address', async () => {
    const { key } = await pair(address, '482913');
    const ports = wifiPorts({ id: 'wifi-1', driver: 'wifi-frame', enabled: true, device: 'someone-else', address, key });
    await expect(ports.open(address)).rejects.toMatchObject({ reason: 'unreachable' });
  });
});
