import type { DisplayLink } from '@counterpay/drivers';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { WsLink } from './ws-link';

/** Close code the display page treats as "pair again". */
const UNAUTHORIZED = 4001;
const UNKNOWN_DISPLAY = 4004;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface ServerDeps {
  version: string;
  /** Random per launch. Local display windows and previews present it. */
  localKey: string;
  displayDir(): string;
  /** Images the shop added to the Ambient playlist. */
  contentDir(): string;
  logoFile(): string | null;
  attach(displayId: string, link: DisplayLink): boolean;
  /** Wi-Fi pairing: a valid code for an enabled Web display returns a long-lived token. */
  pair(code: string): string | null;
  displayForToken(token: string): string | null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(res: ServerResponse, file: string, frameable: boolean): void {
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const isHtml = type.startsWith('text/html');
  const headers: Record<string, string> = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  if (isHtml) {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: wss:",
      frameable ? '' : "frame-ancestors 'none'",
    ]
      .filter(Boolean)
      .join('; ');
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/** Resolves a URL path inside `root`, refusing anything that climbs out of it. */
function staticFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  const file = join(root, relative || 'index.html');
  if (file !== root && !file.startsWith(root + sep)) return null;
  if (!existsSync(file)) return null;
  return statSync(file).isDirectory() ? (existsSync(join(file, 'index.html')) ? join(file, 'index.html') : null) : file;
}

/** Serves /content/logo and /content/images/<name>. Returns false if the path is neither. */
function serveContent(res: ServerResponse, path: string, deps: ServerDeps): boolean {
  if (path === '/content/logo') {
    serveLogo(res, deps);
    return true;
  }
  const image = /^\/content\/images\/([a-f0-9]{16}\.(?:png|jpe?g|webp))$/.exec(path);
  if (!image) return false;
  const file = join(deps.contentDir(), image[1]!);
  if (existsSync(file)) serveFile(res, file, true);
  else send(res, 404, { error: 'not_found' });
  return true;
}

function serveLogo(res: ServerResponse, deps: ServerDeps): void {
  const logo = deps.logoFile();
  if (logo && existsSync(logo)) serveFile(res, logo, true);
  else send(res, 404, { error: 'no_logo' });
}

/** Drops sockets that stop answering, so a sleeping phone counts as gone within ~10 s. */
function heartbeat(wss: WebSocketServer): () => void {
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (socket) => {
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
  });
  const timer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.get(socket)) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, 5_000);
  return () => clearInterval(timer);
}

abstract class BaseServer {
  protected server: Server | null = null;
  protected wss: WebSocketServer | null = null;
  private stopHeartbeat: (() => void) | null = null;

  constructor(protected readonly deps: ServerDeps) {}

  get running(): boolean {
    return this.server !== null;
  }

  /** The port actually bound (useful when started on port 0). */
  get port(): number | null {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : null;
  }

  protected abstract handle(req: IncomingMessage, res: ServerResponse, url: URL): void;
  protected abstract connect(socket: WebSocket, url: URL): void;

  async start(port: number, host: string): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://counterpay.local');
      try {
        this.handle(req, res, url);
      } catch (error) {
        console.error('[server]', error);
        if (!res.headersSent) send(res, 500, { error: 'internal' });
      }
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://counterpay.local');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
        this.connect(ws, url);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.stopHeartbeat = heartbeat(wss);
    this.server = server;
    this.wss = wss;
  }

  async stop(): Promise<void> {
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    for (const client of this.wss?.clients ?? []) client.terminate();
    this.wss?.close();
    const server = this.server;
    this.server = null;
    this.wss = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/**
 * 127.0.0.1 only. Serves the display page at /display/ for this PC's display windows
 * and live previews, and (Phase 3) the local API for point-of-sale apps and the CLI.
 */
export class LocalServer extends BaseServer {
  protected handle(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const path = url.pathname;
    if (path === '/' || path === '/display') {
      res.writeHead(302, { Location: '/display/' });
      res.end();
      return;
    }
    if (path.startsWith('/display/')) {
      const file = staticFile(this.deps.displayDir(), path.slice('/display/'.length));
      if (file) serveFile(res, file, true);
      else send(res, 404, { error: 'not_found' });
      return;
    }
    if (serveContent(res, path, this.deps)) return;
    if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, version: this.deps.version });
    if (path.startsWith('/api/')) {
      // TODO(phase-3): POST /api/pay, POST /api/clear, GET /api/state, GET /api/history and WS /api/events,
      // all behind the bearer token from Settings (config.api.token) and only when config.api.enabled.
      return send(res, 501, { error: 'not_implemented', phase: 3 });
    }
    send(res, 404, { error: 'not_found' });
  }

  protected connect(socket: WebSocket, url: URL): void {
    const id = url.searchParams.get('id');
    if (url.searchParams.get('key') !== this.deps.localKey || !id) {
      socket.close(UNAUTHORIZED, 'unauthorized');
      return;
    }
    const role = url.searchParams.get('role') === 'preview' ? 'preview' : 'display';
    if (!this.deps.attach(id, new WsLink(socket, role))) socket.close(UNKNOWN_DISPLAY, 'unknown display');
  }
}

/** Five pairing tries per address per minute. */
class PairLimiter {
  private readonly tries = new Map<string, { count: number; resetAt: number }>();

  allow(address: string, now = Date.now()): boolean {
    const entry = this.tries.get(address);
    if (!entry || now >= entry.resetAt) {
      this.tries.set(address, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= 5;
  }
}

/**
 * The shop Wi-Fi. Runs only while a Web display is enabled. Read-only: it serves the
 * display page and pushes scenes to paired screens. The API is never exposed here.
 */
export class LanServer extends BaseServer {
  private readonly limiter = new PairLimiter();

  protected handle(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const path = url.pathname;
    if (path === '/pair') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      if (!this.limiter.allow(req.socket.remoteAddress ?? '?')) return send(res, 429, { error: 'too_many' });
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 1024) req.destroy();
      });
      req.on('end', () => {
        let code = '';
        try {
          code = String((JSON.parse(body) as { code?: unknown }).code ?? '');
        } catch {
          // Treated as a wrong code below.
        }
        const token = /^\d{6}$/.test(code) ? this.deps.pair(code) : null;
        if (token) send(res, 200, { token });
        else send(res, 401, { error: 'wrong_code' });
      });
      return;
    }
    if (serveContent(res, path, this.deps)) return;
    if (req.method !== 'GET') return send(res, 405, { error: 'method' });
    const file = staticFile(this.deps.displayDir(), path);
    if (file) serveFile(res, file, false);
    else send(res, 404, { error: 'not_found' });
  }

  protected connect(socket: WebSocket, url: URL): void {
    const token = url.searchParams.get('token') ?? '';
    const id = this.deps.displayForToken(token);
    if (!id) {
      socket.close(UNAUTHORIZED, 'pair again');
      return;
    }
    if (!this.deps.attach(id, new WsLink(socket, 'display'))) socket.close(UNAUTHORIZED, 'pair again');
  }

  /** What a phone types into its browser. */
  static urls(port: number): string[] {
    const urls: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const address of list ?? []) {
        if (address.family === 'IPv4' && !address.internal) urls.push(`http://${address.address}:${port}`);
      }
    }
    return urls;
  }
}
