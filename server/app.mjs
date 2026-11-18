// HTTP- und WebSocket-Dienst für Mathebingo (Typ B: statische App mit kleinem Node-Dienst).
// Alles läuft unter BASE_PATH (Standard /mathebingo); Caddy entfernt den Präfix nicht.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { sessionFromCookie } from './auth.mjs';
import { Relay, LIMITS } from './relay.mjs';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const STATIC_DIRS = ['css', 'js', 'vendor'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

export function readConfig(env = process.env) {
  const base = (env.BASE_PATH ?? '/mathebingo').trim().replace(/\/+$/, '');
  return {
    port: Number(env.PORT) || 3005,
    basePath: base && !base.startsWith('/') ? `/${base}` : base,
    secret: env.AUTH_SECRET || '',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    testSystem: env.TESTSYSTEM === 'true',
  };
}

/** Rechte Adresse aus X-Forwarded-For: die hat der zentrale Caddy gesetzt, davor kann der Client schreiben, was er will. */
export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || '?';
}

export function createApp(config, { limits = {}, log = (msg) => console.log(`[mathebingo] ${msg}`) } = {}) {
  const cfg = { ...config };
  const relay = new Relay(limits, log);
  const wss = new WebSocketServer({ noServer: true, maxPayload: Math.max(LIMITS.hostMsgBytes, limits.hostMsgBytes || 0), perMessageDeflate: false });

  const headers = (extra = {}) => ({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(cfg.testSystem ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    ...extra,
  });

  function reply(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
    res.writeHead(status, headers({ 'Content-Type': type, 'Cache-Control': 'no-store', ...extra }));
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }

  async function serveFile(req, res, rel) {
    const file = normalize(join(ROOT, rel));
    if (!STATIC_DIRS.some((d) => file.startsWith(join(ROOT, d) + sep)) && file !== join(ROOT, 'index.html')) return reply(res, 404, 'Nicht gefunden');
    let st;
    try { st = await stat(file); } catch { return reply(res, 404, 'Nicht gefunden'); }
    if (!st.isFile()) return reply(res, 404, 'Nicht gefunden');
    const lastMod = st.mtime.toUTCString();
    const cache = extname(file) === '.woff2' ? 'public, max-age=86400' : 'no-cache';
    if (req.headers['if-modified-since'] === lastMod) {
      res.writeHead(304, headers({ 'Last-Modified': lastMod, 'Cache-Control': cache }));
      return res.end();
    }
    const body = await readFile(file);
    res.writeHead(200, headers({ 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Last-Modified': lastMod, 'Cache-Control': cache }));
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function onRequest(req, res) {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reply(res, 400, 'Ungültige Adresse'); }
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return reply(res, 400, 'Ungültige Adresse'); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Nicht erlaubt', undefined, { Allow: 'GET, HEAD' });
    if (cfg.basePath && path === cfg.basePath) return reply(res, 308, '', undefined, { Location: `${cfg.basePath}/${url.search}` });
    if (!path.startsWith(`${cfg.basePath}/`)) return reply(res, 404, 'Nicht gefunden');
    const rel = path.slice(cfg.basePath.length + 1);
    if (rel.includes('\0') || rel.split('/').some((seg) => seg === '..' || seg.startsWith('.'))) return reply(res, 404, 'Nicht gefunden');

    if (rel === 'health') return reply(res, 200, 'ok');
    if (rel === 'api/me') {
      const s = await sessionFromCookie(req.headers.cookie, cfg.secret);
      return reply(res, 200, JSON.stringify({ relay: true, name: s?.name || null, isTeacher: !!s?.isTeacher, testSystem: cfg.testSystem }),
        'application/json; charset=utf-8');
    }
    if (rel === '' || rel === 'index.html') return serveFile(req, res, 'index.html');
    if (STATIC_DIRS.includes(rel.split('/')[0])) return serveFile(req, res, rel);
    return reply(res, 404, 'Nicht gefunden');
  }

  function reject(socket, status, text) {
    try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* egal */ }
  }

  async function onUpgrade(req, socket, head) {
    socket.on('error', () => {});
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reject(socket, 400, 'Bad Request'); }
    if (url.pathname !== `${cfg.basePath}/ws`) return reject(socket, 404, 'Not Found');
    const origin = String(req.headers.origin || '').replace(/\/+$/, '');
    if (!origin || !cfg.allowedOrigins.includes(origin)) return reject(socket, 403, 'Forbidden');
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
    if (role === 'host') {
      const s = await sessionFromCookie(req.headers.cookie, cfg.secret);
      if (!s?.isTeacher) return reject(socket, 401, 'Unauthorized');
    }
    const ip = clientIp(req);
    wss.handleUpgrade(req, socket, head, (ws) => relay.attach(ws, { role, ip }));
  }

  const server = createServer((req, res) => {
    onRequest(req, res).catch(() => { try { reply(res, 500, 'Fehler'); } catch { /* egal */ } });
  });
  server.on('upgrade', (req, socket, head) => { onUpgrade(req, socket, head).catch(() => reject(socket, 500, 'Error')); });

  return {
    server,
    relay,
    config: cfg,
    async close() {
      relay.shutdown();
      await new Promise((r) => server.close(() => r()));
      server.closeAllConnections?.();
    },
  };
}
