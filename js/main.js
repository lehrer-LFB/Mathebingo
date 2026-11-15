import { startHost } from './host.js';
import { startPlayer } from './player.js';
import { cleanCode } from './ui.js';

function route() {
  const [path, qs] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const views = { host: 'view-host', join: 'view-player' };
  const id = views[path] || 'view-home';
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== id; });

  if (id !== 'view-home' && typeof Peer !== 'function') {
    document.getElementById('libfail').hidden = false;
    return;
  }
  if (path === 'host') startHost();
  else if (path === 'join') startPlayer(cleanCode(params.get('room')));
}

// Ein Wechsel zwischen Leiter- und Spieleransicht lädt sauber neu
window.addEventListener('hashchange', () => location.reload());
route();
