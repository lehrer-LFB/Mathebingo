// Startpunkt: node server/index.mjs (Konfiguration nur über Umgebungsvariablen, siehe .env.example).
import { createApp, readConfig } from './app.mjs';

const cfg = readConfig();
const log = (msg) => console.log(`[mathebingo] ${msg}`);
if (!cfg.secret) log('Warnung: AUTH_SECRET fehlt – niemand kann einen Raum eröffnen.');
if (!cfg.allowedOrigins.length) log('Warnung: ALLOWED_ORIGINS fehlt – alle WebSocket-Verbindungen werden abgelehnt.');

const app = createApp(cfg, { log });
app.server.listen(cfg.port, () => {
  log(`läuft auf Port ${cfg.port} unter ${cfg.basePath || '/'} (Testsystem: ${cfg.testSystem ? 'ja' : 'nein'})`);
});

// Kurzer Lagebericht ohne Personenbezug
setInterval(() => {
  const s = app.relay.stats();
  if (s.rooms) log(`${s.rooms} Räume, ${s.players} Spieler:innen, ${s.connections} Verbindungen`);
}, 15 * 60_000).unref();

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    log('wird beendet – alle Räume werden geschlossen');
    setTimeout(() => process.exit(0), 3000).unref();
    await app.close();
    process.exit(0);
  });
}
