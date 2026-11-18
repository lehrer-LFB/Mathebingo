// Dünner Wrapper um PeerJS (global `Peer` aus dem CDN-Skript).
// Der Spielleiter belegt eine feste Peer-ID, die Spieler verbinden sich direkt per WebRTC.

const PEER_OPTS = { debug: 1 };
export const peerId = (code) => `mathebingo-${code}`;

export class HostNet {
  /** @param {string} id  @param {{status:Function, data:Function, close:Function}} h */
  constructor(id, h) {
    this.id = id;
    this.h = h;
    this.tries = 0;
    this.start();
  }

  start() {
    const peer = (this.peer = new Peer(this.id, PEER_OPTS));
    peer.on('open', () => { this.tries = 0; this.h.status('online'); });
    peer.on('connection', (conn) => {
      conn.on('data', (d) => this.h.data(conn, d));
      conn.on('close', () => this.h.close(conn));
      conn.on('error', () => this.h.close(conn));
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

  destroy() { try { this.peer.destroy(); } catch { /* egal */ } }
}

export class PlayerNet {
  /** @param {string} hostId  @param {{status:Function, open:Function, data:Function}} h */
  constructor(hostId, h) {
    this.hostId = hostId;
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
