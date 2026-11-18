import { startHost } from './host.js';
import { startPlayer } from './player.js';
import { cleanCode } from './ui.js';
import { startNetTest } from './nettest.js';
import { detectMode, loadPeerJs } from './net.js';

function show(id) {
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== id; });
}

async function route() {
  const [path, qs] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const views = { host: 'view-host', join: 'view-player', test: 'view-test' };
  const id = views[path] || 'view-home';

  const { mode, me } = await detectMode();
  document.documentElement.dataset.mode = mode;
  if (mode === 'relay') {
    // Weblehrerzimmer: Portal-Leiste für Lehrkräfte, gelber Hinweis im Testsystem
    document.getElementById('portal-link').hidden = path === 'join' || path === 'test';
    document.getElementById('test-banner').hidden = !me.testSystem;
    document.querySelectorAll('.only-peer').forEach((e) => { e.hidden = true; });
  } else {
    document.querySelectorAll('.only-relay').forEach((e) => { e.hidden = true; });
  }

  if (path === 'test') { show(id); return startNetTest(mode); } // prüft die Bibliotheken selbst

  if (mode === 'relay' && path === 'host' && !me.isTeacher) return show('view-login');
  show(id);
  if (id === 'view-home') return;

  if (mode === 'peer' && !(await loadPeerJs())) {
    document.getElementById('libfail').hidden = false;
    return;
  }
  if (path === 'host') startHost();
  else if (path === 'join') startPlayer(cleanCode(params.get('room')));
}

// Ein Wechsel zwischen Leiter- und Spieleransicht lädt sauber neu
window.addEventListener('hashchange', () => location.reload());
route();
