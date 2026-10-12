import type { DisplayMessage, PcMessage } from '@counterpay/core';
import type { DisplayLink } from '@counterpay/drivers';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { LanServer, LocalServer, type ServerDeps } from '../src/main/server';

const KEY = 'local-key-123';
const CODE = '482913';
const TOKEN = 'paired-token';

let dir: string;
let secretDir: string;
let attached: Array<{ id: string; link: DisplayLink }>;
let deps: ServerDeps;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'counterpay-display-'));
  secretDir = mkdtempSync(join(tmpdir(), 'counterpay-secret-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>display</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(secretDir, 'secret.txt'), 'nope');
  attached = [];
  deps = {
    version: '0.1.0-test',
    localKey: KEY,
    displayDir: () => dir,
    contentDir: () => secretDir,
    logoFile: () => null,
    attach: (id, link) => {
      if (id !== 'sim' && id !== 'phone-1') return false;
      attached.push({ id, link });
      return true;
    },
    pair: (code) => (code === CODE ? TOKEN : null),
    displayForToken: (token) => (token === TOKEN ? 'phone-1' : null),
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(secretDir, { recursive: true, force: true });
});

async function started<T extends LocalServer | LanServer>(server: T): Promise<{ server: T; base: string; ws: string }> {
  await server.start(0, '127.0.0.1');
  return { server, base: `http://127.0.0.1:${server.port}`, ws: `ws://127.0.0.1:${server.port}` };
}

function closeCode(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on('close', (code) => resolve(code));
    socket.on('error', reject);
  });
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on('open', () => resolve(socket));
    socket.on('error', reject);
  });
}

describe('LocalServer', () => {
  let ctx: Awaited<ReturnType<typeof started<LocalServer>>>;

  beforeEach(async () => {
    ctx = await started(new LocalServer(deps));
  });

  afterEach(async () => {
    await ctx.server.stop();
  });

  it('serves the display page under /display/ with a CSP', async () => {
    const response = await fetch(`${ctx.base}/display/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>display</title>');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect((await fetch(`${ctx.base}/display/assets/app.js`)).headers.get('content-type')).toContain('javascript');
  });

  it('refuses paths that climb out of the display folder', async () => {
    for (const path of ['/display/..%2f..%2fsecret.txt', '/display/../../etc/hosts', '/display/%2e%2e/%2e%2e/x']) {
      expect((await fetch(`${ctx.base}${path}`)).status).toBe(404);
    }
  });

  it('only serves well-formed image names from the content folder', async () => {
    expect((await fetch(`${ctx.base}/content/images/secret.txt`)).status).toBe(404);
    expect((await fetch(`${ctx.base}/content/images/0123456789abcdef.png`)).status).toBe(404);
  });

  it('answers health and keeps the Phase 3 API as a stub', async () => {
    expect(await (await fetch(`${ctx.base}/api/health`)).json()).toEqual({ ok: true, version: '0.1.0-test' });
    const pay = await fetch(`${ctx.base}/api/pay`, { method: 'POST', body: '{"amount":1140}' });
    expect(pay.status).toBe(501);
  });

  it('closes a display socket with the wrong key', async () => {
    expect(await closeCode(`${ctx.ws}/ws?id=sim&key=wrong`)).toBe(4001);
    expect(attached).toHaveLength(0);
  });

  it('closes a socket for an unknown display', async () => {
    expect(await closeCode(`${ctx.ws}/ws?id=nobody&key=${KEY}`)).toBe(4004);
  });

  it('attaches a display page and carries messages both ways', async () => {
    const socket = await open(`${ctx.ws}/ws?id=sim&key=${KEY}&role=preview`);
    await new Promise((r) => setTimeout(r, 50));
    expect(attached).toHaveLength(1);
    const { link } = attached[0]!;
    expect(link.role).toBe('preview');

    const fromDisplay: DisplayMessage[] = [];
    link.onMessage((m) => fromDisplay.push(m));
    const received = new Promise<PcMessage>((resolve) => socket.once('message', (data) => resolve(JSON.parse(String(data)))));
    link.send({ v: 1, t: 'ping', seq: 7 });
    expect(await received).toEqual({ v: 1, t: 'ping', seq: 7 });

    socket.send(JSON.stringify({ t: 'ack', seq: 7, scene: 'ambient' }));
    socket.send('not json');
    socket.send(JSON.stringify({ t: 'pay', amt: 1 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(fromDisplay).toEqual([{ t: 'ack', seq: 7, scene: 'ambient' }]);

    const closed = new Promise<void>((resolve) => link.onClose(resolve));
    socket.close();
    await closed;
  });
});

describe('LanServer', () => {
  let ctx: Awaited<ReturnType<typeof started<LanServer>>>;

  beforeEach(async () => {
    ctx = await started(new LanServer(deps));
  });

  afterEach(async () => {
    await ctx.server.stop();
  });

  const pair = (code: string) =>
    fetch(`${ctx.base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });

  it('serves the display page at the root and never the API', async () => {
    expect((await fetch(`${ctx.base}/`)).status).toBe(200);
    expect((await fetch(`${ctx.base}/api/health`)).status).toBe(404);
    expect((await fetch(`${ctx.base}/api/pay`, { method: 'POST' })).status).toBe(405);
  });

  it('forbids being framed by other pages', async () => {
    expect((await fetch(`${ctx.base}/`)).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('pairs with the right code only', async () => {
    expect((await pair('000000')).status).toBe(401);
    expect((await pair('12')).status).toBe(401);
    const ok = await pair(CODE);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ token: TOKEN });
  });

  it('limits pairing tries', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await pair('111111')).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('attaches a paired screen as a display and refuses unknown tokens', async () => {
    expect(await closeCode(`${ctx.ws}/ws?token=stolen`)).toBe(4001);
    const socket = await open(`${ctx.ws}/ws?token=${TOKEN}`);
    await new Promise((r) => setTimeout(r, 50));
    expect(attached.map((a) => [a.id, a.link.role])).toEqual([['phone-1', 'display']]);
    socket.close();
  });
});
