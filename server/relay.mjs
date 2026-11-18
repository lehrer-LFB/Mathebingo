// WebSocket-Relay für Mathebingo.
// Der Relay kennt keine Spielinhalte: Er verwaltet Räume und Mitglieder und leitet Nachrichten weiter.
// Spieler:innen dürfen nur an den Host schreiben, der Host an einzelne oder alle Spieler:innen.
// Alles liegt nur im RAM. Logs enthalten nur Zähler, keine Spitznamen, Inhalte oder IP-Adressen.
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const LIMITS = Object.freeze({
  maxRooms: 50, // offene Räume auf dem Server
  maxPlayers: 40, // Spieler:innen pro Raum
  playerMsgBytes: 4096, // max. Größe einer Spieler-Nachricht
  hostMsgBytes: 65536, // Host: Endstand mit allen Lösungen kann größer sein
  playerMsgsPerSec: 20,
  hostMsgsPerSec: 200, // Host verschickt beim Wiederverbinden viele Begrüßungen auf einmal
  joinFailsPerConn: 5, // falsche Raumcodes pro WebSocket-Verbindung, danach wird getrennt
  // Pro IP nur großzügig: Im Schul-WLAN teilen sich alle iPads dieselbe öffentliche IP (NAT)
  joinFails: 120, // Fehlversuche mit Raumcode pro IP …
  joinFailWindowMs: 60_000, // … pro Minute
  joinBlockMs: 60_000, // danach Sperre für diese IP
  awayMs: 10 * 60_000, // Platz bleibt nach Trennung frei gehalten (Spieler:innen und Lehrkraft)
  idleMs: 3 * 3600_000, // Raum ohne Aktivität
  maxAgeMs: 8 * 3600_000, // Raum spätestens nach dem Eröffnen
  helloMs: 15_000, // Zeit bis zur ersten open/join-Nachricht
  pingMs: 25_000, // Ping/Pong hält Verbindungen lebendig und erkennt tote
  sweepMs: 30_000,
});

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const newToken = () => randomBytes(18).toString('base64url');
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class Relay {
  constructor(limits = {}, log = () => {}) {
    this.L = { ...LIMITS, ...limits };
    this.log = log;
    this.rooms = new Map(); // code -> room
    this.fails = new Map(); // ip -> { n, since, until } (nur flüchtig für das Rate-Limit)
    this.clients = new Set();
    this.sweeper = setInterval(() => this.sweep(), this.L.sweepMs);
    this.pinger = setInterval(() => this.pingAll(), this.L.pingMs);
    this.sweeper.unref?.();
    this.pinger.unref?.();
  }

  // ---------- Verbindungen ----------

  attach(ws, { role, ip }) {
    const c = { ws, role, ip, alive: true, room: null, pid: null, win: Date.now(), count: 0, fails: 0 };
    this.clients.add(c);
    c.hello = setTimeout(() => { if (!c.room) this.closeClient(c, 4408, 'timeout'); }, this.L.helloMs);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw, isBinary) => this.onMessage(c, raw, isBinary));
    ws.on('close', () => this.onClose(c));
    ws.on('error', () => { /* close folgt */ });
    return c;
  }

  send(c, msg) {
    if (!c || c.ws.readyState !== 1) return;
    try { c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* egal */ }
  }

  closeClient(c, code = 1000, reason = '') {
    try { c.ws.close(code, reason); } catch { /* egal */ }
  }

  onMessage(c, raw, isBinary) {
    const isHost = c.role === 'host';
    const maxBytes = isHost ? this.L.hostMsgBytes : this.L.playerMsgBytes;
    if (isBinary || raw.length > maxBytes) return this.closeClient(c, 1009, 'too big');
    const now = Date.now();
    if (now - c.win >= 1000) { c.win = now; c.count = 0; }
    if (++c.count > (isHost ? this.L.hostMsgsPerSec : this.L.playerMsgsPerSec)) return this.closeClient(c, 4429, 'too many');

    let m;
    try { m = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.op !== 'string') return;
    if (m.op === 'ping') return this.send(c, { op: 'pong' });

    if (isHost) {
      if (m.op === 'open') return this.open(c, m);
      if (!c.room) return;
      if (m.op === 'msg') return this.hostMsg(c, m);
      if (m.op === 'kick') return this.removeMember(c.room, m.pid, 'kicked');
      if (m.op === 'drop') return this.removeMember(c.room, m.pid, 'replaced');
      if (m.op === 'lock') { c.room.locked = m.locked === true; return this.send(c, { op: 'locked', locked: c.room.locked }); }
      if (m.op === 'close') return this.closeRoom(c.room, 'hostClosed');
    } else {
      if (m.op === 'join') return this.join(c, m, now);
      if (m.op === 'msg' && c.room) return this.playerMsg(c, m);
    }
  }

  onClose(c) {
    clearTimeout(c.hello);
    this.clients.delete(c);
    const room = c.room;
    if (!room) return;
    c.room = null;
    if (c.role === 'host') {
      if (room.host !== c) return;
      room.host = null;
      room.hostAway = Date.now();
      this.toPlayers(room, { op: 'host', online: false });
    } else {
      const mem = room.members.get(c.pid);
      if (!mem || mem.c !== c) return;
      mem.c = null;
      mem.away = Date.now();
      this.send(room.host, { op: 'peer', pid: c.pid, online: false });
    }
  }

  // ---------- Host ----------

  open(c, m) {
    if (c.room) return;
    let room;
    let resumed = false;
    const wanted = typeof m.room === 'string' && CODE_RE.test(m.room) ? m.room : null;
    const existing = wanted && this.rooms.get(wanted);
    if (existing) {
      // Wiederverbinden nur mit dem Host-Token dieses Raums
      if (!sameToken(m.token, existing.hostToken)) return this.send(c, { op: 'error', code: 'roomTaken' });
      room = existing;
      resumed = true;
    } else {
      if (this.rooms.size >= this.L.maxRooms) return this.send(c, { op: 'error', code: 'tooManyRooms' });
      // Nach einem Server-Neustart darf der Host seinen alten Code wieder belegen
      room = this.createRoom(wanted || this.freeCode());
    }
    if (room.host && room.host !== c) { // zweiter Tab der Lehrkraft übernimmt
      const old = room.host;
      old.room = null;
      this.send(old, { op: 'replaced' });
      this.closeClient(old, 4409, 'replaced');
    }
    room.host = c;
    room.hostAway = 0;
    room.active = Date.now();
    c.room = room;
    clearTimeout(c.hello);
    if (typeof m.locked === 'boolean') room.locked = m.locked;
    this.send(c, {
      op: 'opened', room: room.code, token: room.hostToken, resumed, locked: room.locked,
      members: [...room.members].map(([pid, x]) => ({ pid, online: !!x.c })),
    });
    if (resumed) this.toPlayers(room, { op: 'host', online: true });
    else this.log(`Raum eröffnet (${this.rooms.size} offen)`);
  }

  hostMsg(c, m) {
    const room = c.room;
    room.active = Date.now();
    const out = JSON.stringify({ op: 'msg', data: m.data ?? null });
    if (m.to === undefined || m.to === null) return this.toPlayers(room, out);
    const mem = room.members.get(String(m.to));
    if (mem) this.send(mem.c, out);
  }

  toPlayers(room, msg) {
    const out = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const mem of room.members.values()) this.send(mem.c, out);
  }

  removeMember(room, pid, why) {
    const mem = room.members.get(String(pid));
    if (!mem) return;
    room.members.delete(String(pid));
    if (mem.c) {
      const pc = mem.c;
      pc.room = null;
      this.send(pc, { op: why });
      this.closeClient(pc, 4403, why);
    }
  }

  createRoom(code) {
    const now = Date.now();
    const room = { code, hostToken: newToken(), locked: false, host: null, hostAway: now, created: now, active: now, members: new Map(), nextPid: 1 };
    this.rooms.set(code, room);
    return room;
  }

  freeCode() {
    for (;;) {
      const code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  closeRoom(room, reason) {
    if (this.rooms.get(room.code) !== room) return;
    this.rooms.delete(room.code);
    const players = room.members.size;
    for (const mem of room.members.values()) {
      if (!mem.c) continue;
      mem.c.room = null;
      this.send(mem.c, { op: 'closed', reason });
      this.closeClient(mem.c, 1000, 'closed');
    }
    if (room.host) {
      room.host.room = null;
      this.send(room.host, { op: 'closed', reason });
      this.closeClient(room.host, 1000, 'closed');
    }
    this.log(`Raum geschlossen (${reason}), ${players} Spieler:innen, ${this.rooms.size} offen`);
  }

  // ---------- Spieler:innen ----------

  join(c, m, now) {
    if (c.room) return;
    const f = this.fails.get(c.ip);
    if (f && f.until > now) return this.send(c, { op: 'error', code: 'rate', retryIn: f.until - now });
    const room = typeof m.room === 'string' ? this.rooms.get(m.room) : null;
    if (!room) {
      this.fail(c.ip, now);
      this.send(c, { op: 'error', code: 'noRoom' });
      if (++c.fails >= this.L.joinFailsPerConn) this.closeClient(c, 4429, 'too many wrong codes');
      return;
    }
    let pid = null;
    let mem = null;
    if (typeof m.token === 'string') {
      for (const [id, x] of room.members) if (sameToken(m.token, x.token)) { pid = id; mem = x; break; }
    }
    const resumed = !!mem;
    if (mem) {
      if (mem.c && mem.c !== c) { // derselbe Platz in einem zweiten Tab
        const old = mem.c;
        old.room = null;
        this.send(old, { op: 'replaced' });
        this.closeClient(old, 4409, 'replaced');
      }
    } else {
      if (room.locked) return this.send(c, { op: 'error', code: 'locked' });
      if (room.members.size >= this.L.maxPlayers) return this.send(c, { op: 'error', code: 'full' });
      pid = `p${room.nextPid++}`;
      mem = { token: newToken(), c: null, away: 0 };
      room.members.set(pid, mem);
    }
    mem.c = c;
    mem.away = 0;
    c.room = room;
    c.pid = pid;
    clearTimeout(c.hello);
    room.active = now;
    this.send(c, { op: 'joined', pid, token: mem.token, resumed, host: !!room.host });
    this.send(room.host, { op: 'peer', pid, online: true });
  }

  playerMsg(c, m) {
    const room = c.room;
    room.active = Date.now();
    if (!room.host) return this.send(c, { op: 'host', online: false });
    // Absender setzt immer der Relay – Spieler:innen können sich nicht als andere ausgeben
    this.send(room.host, { op: 'msg', from: c.pid, data: m.data ?? null });
  }

  fail(ip, now) {
    let f = this.fails.get(ip);
    if (!f || now - f.since > this.L.joinFailWindowMs) f = { n: 0, since: now, until: 0 };
    f.n++;
    if (f.n >= this.L.joinFails) { f.until = now + this.L.joinBlockMs; f.n = 0; f.since = now; }
    this.fails.set(ip, f);
  }

  // ---------- Aufräumen ----------

  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      if (now - room.created > this.L.maxAgeMs) { this.closeRoom(room, 'maxAge'); continue; }
      if (now - room.active > this.L.idleMs) { this.closeRoom(room, 'idle'); continue; }
      if (!room.host && now - room.hostAway > this.L.awayMs) { this.closeRoom(room, 'hostGone'); continue; }
      for (const [pid, mem] of [...room.members]) {
        if (!mem.c && now - mem.away > this.L.awayMs) {
          room.members.delete(pid);
          this.send(room.host, { op: 'peer', pid, gone: true });
        }
      }
    }
    for (const [ip, f] of this.fails) {
      if (f.until <= now && now - f.since > this.L.joinFailWindowMs) this.fails.delete(ip);
    }
  }

  pingAll() {
    for (const c of this.clients) {
      if (!c.alive) { try { c.ws.terminate(); } catch { /* egal */ } continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* egal */ }
    }
  }

  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.members.size;
    return { rooms: this.rooms.size, players, connections: this.clients.size };
  }

  /** Beim Neustart (Deploy): alle informieren, damit die Clients eine verständliche Meldung zeigen. */
  shutdown() {
    clearInterval(this.sweeper);
    clearInterval(this.pinger);
    for (const c of this.clients) {
      this.send(c, { op: 'shutdown' });
      this.closeClient(c, 1012, 'restart');
    }
  }
}
