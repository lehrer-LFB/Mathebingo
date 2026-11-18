// Netzwerkschicht mit zwei austauschbaren Transporten. Die Spiellogik kennt nur diese Schnittstelle:
//
//   Host:    new HostNet(code, { status(s, info), data(conn, msg), close(conn), room(code), token(t), initialToken })
//            conn = { pid, open, send(msg), close(), kick() }      → destroy()
//   Spieler: new PlayerNet(room, { status(s, info), open(), data(msg), token(t), initialToken })
//            send(msg) → bool, retry(delay), destroy()
//
// • relay: WebSocket über den Schulserver (webapps.das-rsg.de/mathebingo). Läuft über HTTPS/443.
// • peer:  PeerJS/WebRTC direkt zwischen den Geräten (GitHub-Pages-Version, PeerJS wird nachgeladen).
// Welcher Transport gilt, entscheidet detectMode(): Antwortet ./api/me, ist ein Relay da.

export const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

let MODE = 'peer';
export const mode = () => MODE;

/** Fragt den eigenen Server; ohne Antwort (z. B. GitHub Pages) → PeerJS. */
export async function detectMode() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('./api/me', { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
    clearTimeout(t);
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
      const me = await r.json();
      if (me && me.relay === true) { MODE = 'relay'; return { mode: MODE, me }; }
    }
  } catch { /* kein Server → Peer */ }
  MODE = 'peer';
  return { mode: MODE, me: null };
}

export async function fetchMe() {
  try {
    const r = await fetch('./api/me', { cache: 'no-store', credentials: 'same-origin' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** PeerJS nur im Peer-Modus nachladen (unter dem Schulserver nie). */
export function loadPeerJs() {
  if (typeof Peer === 'function') return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.onload = () => resolve(typeof Peer === 'function');
    s.onerror = () => resolve(false);
    document.head.append(s);
  });
}

export function HostNet(code, h) { return MODE === 'relay' ? new RelayHost(code, h) : new PeerHost(code, h); }
export function PlayerNet(room, h) { return MODE === 'relay' ? new RelayPlayer(room, h) : new PeerPlayer(room, h); }

// =====================================================================
// Relay (WebSocket)
// =====================================================================

const wsUrl = (role) => {
  const u = new URL(role === 'host' ? 'ws?role=host' : 'ws', location.href);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.hash = '';
  return u.href;
};

/** Gemeinsame Basis: Verbindung halten, Ping/Pong, Wiederverbinden mit Backoff. */
class RelaySocket {
  constructor(role) {
    this.role = role;
    this.ws = null;
    this.destroyed = false;
    this.stopped = false; // kein automatisches Wiederverbinden (z. B. Raum unbekannt, entfernt)
    this.attempt = 0;
    this.timer = null;
    this.pingTimer = null;
    this.pongTimer = null;
    this.onVisible = () => { if (document.visibilityState === 'visible') this.check(); };
    this.onOnline = () => this.check();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
  }

  isOpen() { return !!this.ws && this.ws.readyState === 1 && this.ready; }

  /** iPad wieder aktiv: tote Verbindung sofort erkennen statt auf den nächsten Ping zu warten. */
  check() {
    if (this.destroyed || this.stopped) return;
    if (!this.ws || this.ws.readyState > 1) return this.retry(100);
    this.ping();
  }

  connect() {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.stopped = false;
    this.ready = false;
    let ws;
    try { ws = this.ws = new WebSocket(wsUrl(this.role)); } catch { return this.retry(); }
    ws.onopen = () => { if (this.ws === ws) { this.startPing(); this.hello(); } };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m && m.op === 'pong') { clearTimeout(this.pongTimer); return; }
      if (m && m.op === 'shutdown') { this.restarting = true; return; }
      this.onOp(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.stopPing();
      const wasReady = this.ready;
      this.ready = false;
      this.ws = null;
      if (this.destroyed) return;
      this.lost(e.code, wasReady);
    };
    ws.onerror = () => { /* close folgt */ };
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  ping() {
    if (!this.send({ op: 'ping' })) return;
    clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      // keine Antwort: Verbindung ist tot (typisch nach Display-Sperre am iPad)
      const ws = this.ws;
      const wasReady = this.ready;
      this.ws = null;
      this.ready = false;
      this.stopPing();
      try { ws?.close(); } catch { /* egal */ }
      this.lost(1006, wasReady);
    }, PONG_TIMEOUT_MS);
  }

  startPing() { this.stopPing(); this.pingTimer = setInterval(() => this.ping(), PING_MS); }
  stopPing() { clearInterval(this.pingTimer); clearTimeout(this.pongTimer); }

  retry(delay) {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    const d = delay ?? Math.min(15000, 1000 * 2 ** Math.min(this.attempt, 4)) + Math.random() * 500;
    this.attempt++;
    this.timer = setTimeout(() => this.connect(), d);
  }

  stop() { this.stopped = true; clearTimeout(this.timer); }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.stopPing();
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    try { this.ws?.close(1000); } catch { /* egal */ }
  }
}

class RelayHost extends RelaySocket {
  constructor(code, h) {
    super('host');
    this.code = code;
    this.h = h;
    this.token = h.initialToken || null;
    this.conns = new Map(); // pid -> conn
    this.connect();
  }

  hello() { this.send({ op: 'open', room: this.code, token: this.token, locked: !!this.h.locked?.() }); }

  /** Raum für neue Beitritte sperren/öffnen (Bekannte dürfen weiter zurück). */
  setLocked(locked) { this.send({ op: 'lock', locked: !!locked }); }

  conn(pid) {
    let c = this.conns.get(pid);
    if (!c) {
      c = {
        pid, open: true,
        send: (data) => this.send({ op: 'msg', to: pid, data }),
        close: () => { this.forget(pid); this.send({ op: 'drop', pid }); },
        kick: () => { this.forget(pid); this.send({ op: 'kick', pid }); },
      };
      this.conns.set(pid, c);
    }
    return c;
  }

  forget(pid) {
    const c = this.conns.get(pid);
    if (!c) return;
    c.open = false;
    this.conns.delete(pid);
  }

  broadcast(data) { return this.send({ op: 'msg', data }); }

  onOp(m) {
    switch (m.op) {
      case 'opened':
        this.ready = true;
        this.attempt = 0;
        this.restarting = false;
        if (m.room !== this.code) { this.code = m.room; this.h.room?.(m.room); }
        this.token = m.token;
        this.h.token?.(m.token);
        for (const [pid, c] of this.conns) { c.open = false; this.h.close(c); this.conns.delete(pid); }
        this.h.status('online');
        break;
      case 'error':
        if (m.code === 'roomTaken') { this.code = null; this.token = null; this.hello(); } // anderer Code
        else if (m.code === 'tooManyRooms') { this.h.status('full'); this.retry(30000); try { this.ws.close(); } catch { /* egal */ } }
        break;
      case 'peer':
        if (m.online) this.conn(m.pid);
        else { const c = this.conns.get(m.pid); if (c) { this.forget(m.pid); this.h.close(c); } }
        break;
      case 'msg':
        this.h.data(this.conn(m.from), m.data);
        break;
      case 'replaced':
        this.stop();
        this.h.status('replaced');
        break;
      case 'closed':
        this.stop();
        this.h.status('closed', m.reason);
        break;
      default:
    }
  }

  async lost(code, wasReady) {
    for (const [pid, c] of this.conns) { c.open = false; this.h.close(c); this.conns.delete(pid); }
    if (this.stopped) return;
    this.h.status(this.restarting ? 'restart' : 'reconnecting');
    if (!wasReady && this.attempt >= 1) {
      // Abgewiesen? Dann ist meist die Anmeldung abgelaufen.
      const me = await fetchMe();
      if (me && !me.isTeacher) { this.h.status('login'); return this.retry(20000); }
    }
    this.retry(this.restarting ? 1500 + Math.random() * 2000 : undefined);
  }

  /** Spieler:in entfernen, auch wenn sie gerade offline ist (Platz im Relay). */
  kickPid(pid) { this.forget(pid); this.send({ op: 'kick', pid }); }

  /** Raum endgültig schließen (Neues Spiel). */
  closeRoom() { this.send({ op: 'close' }); this.stop(); }
}

class RelayPlayer extends RelaySocket {
  constructor(room, h) {
    super('player');
    this.room = room;
    this.h = h;
    this.token = h.initialToken || null;
    this.h.status('connecting');
    this.connect();
  }

  hello() { this.send({ op: 'join', room: this.room, token: this.token }); }

  isOpen() { return super.isOpen() && this.hostOnline; }

  send(obj) {
    // Spiel-Nachrichten gehen eingepackt an den Host; Steuerbefehle direkt
    return obj && obj.op ? super.send(obj) : (this.isOpen() && super.send({ op: 'msg', data: obj }));
  }

  onOp(m) {
    switch (m.op) {
      case 'joined':
        this.ready = true;
        this.attempt = 0;
        this.restarting = false;
        this.token = m.token;
        this.h.token?.(m.token);
        this.hostOnline = !!m.host;
        if (m.host) { this.h.status('online'); this.h.open(); } else this.h.status('host-away');
        break;
      case 'host':
        this.hostOnline = !!m.online;
        if (m.online) { this.h.status('online'); this.h.open(); } else this.h.status('host-away');
        break;
      case 'msg':
        this.h.data(m.data);
        break;
      case 'error':
        this.stop();
        this.h.status({ noRoom: 'no-host', full: 'full', rate: 'rate', locked: 'locked' }[m.code] || 'offline', m);
        try { this.ws.close(); } catch { /* egal */ }
        break;
      case 'kicked':
        this.stop();
        this.h.data({ t: 'kicked' });
        break;
      case 'replaced':
        this.stop();
        this.h.status('replaced');
        break;
      case 'closed':
        this.stop();
        this.h.data({ t: 'closed', reason: m.reason });
        break;
      default:
    }
  }

  lost() {
    this.hostOnline = false;
    if (this.stopped) return;
    this.h.status(this.restarting ? 'restart' : 'offline');
    this.retry(this.restarting ? 2500 + Math.random() * 3000 : undefined);
  }

  /** Neuer Versuch (z. B. nach „Raum nicht gefunden“ oder erneutem Beitreten). */
  retry(delay) { this.stopped = false; super.retry(delay); }

  setRoom(room) { if (room !== this.room) { this.room = room; this.token = null; } }
}

// =====================================================================
// PeerJS (WebRTC) – für die GitHub-Pages-Version
// =====================================================================

const PEER_OPTS = { debug: 1 };
export const peerId = (code) => `mathebingo-${code}`;

class PeerHost {
  constructor(code, h) {
    this.id = peerId(code);
    this.h = h;
    this.tries = 0;
    this.conns = new Set();
    this.start();
  }

  start() {
    const peer = (this.peer = new Peer(this.id, PEER_OPTS));
    peer.on('open', () => { this.tries = 0; this.h.status('online'); });
    peer.on('connection', (conn) => {
      conn.kick = () => { try { conn.send({ t: 'kicked' }); } catch { /* egal */ } setTimeout(() => { try { conn.close(); } catch { /* egal */ } }, 300); };
      this.conns.add(conn);
      conn.on('data', (d) => this.h.data(conn, d));
      const gone = () => { this.conns.delete(conn); this.h.close(conn); };
      conn.on('close', gone);
      conn.on('error', gone);
    });
    peer.on('disconnected', () => {
      if (peer.destroyed || this.peer !== peer) return;
      this.h.status('reconnecting');
      setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000);
    });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id') {
        // Nach einem Neuladen hält der Server die alte ID noch kurz fest
        this.tries++;
        this.h.status('busy', this.tries);
        peer.destroy();
        setTimeout(() => this.start(), 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.h.status('reconnecting');
        setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 3000);
      } else if (err.type === 'browser-incompatible') {
        this.h.status('incompatible');
      } else {
        console.warn('PeerJS:', err.type, err);
      }
    });
  }

  broadcast(data) { for (const c of this.conns) { try { if (c.open) c.send(data); } catch { /* egal */ } } }
  closeRoom() { this.broadcast({ t: 'closed' }); }
  destroy() { try { this.peer.destroy(); } catch { /* egal */ } }
}

class PeerPlayer {
  constructor(room, h) {
    this.room = room;
    this.hostId = peerId(room);
    this.h = h;
    this.conn = null;
    this.timer = null;
    this.destroyed = false;
    this.fails = 0; // fehlgeschlagene Verbindungsversuche in Folge (Host da, aber kein Durchkommen)
    this.noHost = false;
    const peer = (this.peer = new Peer(PEER_OPTS));
    // Vermittlungsserver nach 10 s nicht erreicht → eigener Hinweis
    this.signalTimer = setTimeout(() => { if (!peer.open && !this.destroyed) this.h.status('no-signal'); }, 10000);
    peer.on('open', () => { clearTimeout(this.signalTimer); this.connect(); });
    peer.on('disconnected', () => this.retry());
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') { this.noHost = true; this.h.status('no-host'); }
      else if (err.type === 'browser-incompatible') { this.h.status('incompatible'); return; }
      else this.h.status('offline');
      this.retry();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.isOpen()) this.retry(200);
    });
  }

  isOpen() { return !!(this.conn && this.conn.open); }

  connect() {
    if (this.destroyed || this.isOpen()) return;
    if (this.conn) { const old = this.conn; this.conn = null; try { old.close(); } catch { /* egal */ } }
    this.noHost = false;
    this.h.status(this.fails >= 2 ? 'blocked' : 'connecting');
    const c = (this.conn = this.peer.connect(this.hostId, { reliable: true }));
    // Host gefunden, aber die direkte Verbindung kommt nicht zustande → typisch für blockierende Firewalls
    const fail = (delay) => {
      if (this.conn !== c || c.failed) return;
      c.failed = true;
      clearTimeout(guard);
      if (!c.wasOpen && !this.noHost) this.fails++;
      this.h.status(this.noHost ? 'no-host' : this.fails >= 2 ? 'blocked' : 'offline');
      this.retry(delay);
    };
    const guard = setTimeout(() => { if (!c.open) fail(0); }, 8000);
    c.on('open', () => {
      if (this.conn !== c) return;
      clearTimeout(guard);
      c.wasOpen = true;
      this.fails = 0;
      this.h.status('online');
      this.h.open();
    });
    c.on('data', (d) => { if (this.conn === c) this.h.data(d); });
    c.on('close', () => fail());
    c.on('error', () => fail());
  }

  retry(delay = 2500) {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.peer.destroyed) return;
      if (this.peer.disconnected) this.peer.reconnect(); // löst danach 'open' → connect() aus
      else { if (this.conn && !this.conn.open) this.conn = null; this.connect(); }
    }, delay);
  }

  send(msg) {
    if (!this.isOpen()) return false;
    try { this.conn.send(msg); return true; } catch { return false; }
  }

  destroy() { this.destroyed = true; clearTimeout(this.timer); clearTimeout(this.signalTimer); try { this.peer.destroy(); } catch { /* egal */ } }
}
