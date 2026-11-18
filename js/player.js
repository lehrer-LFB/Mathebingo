// Spieler: Spitzname, eigene Karte, markieren, BINGO melden.
import { validateCard, randomFill, markedLines, rulesFor } from './game.js';
import { PlayerNet, peerId } from './net.js';
import { $, el, toast, store, randomId, keepAwake, cleanNick, cleanCode } from './ui.js';

const STORE = 'mb_player_v1';
let R = rulesFor(null); // Regeln der Runde (vom Spielleiter)
const emptyCard = () => Array(R.cells).fill(null);

let P; // gespeichert: playerId, room, nick, round, settings, card, draft, marked, autoJoin
const G = { joined: false, connected: false, phase: 'lobby', balls: [], interval: 30, nextAt: 0, remaining: 0, cardAt: 0, end: null, sending: false };
let net = null;
let lastBingo = 0;

const save = () => store.set(STORE, P);
const resetRound = () => { P.card = null; P.draft = emptyCard(); P.marked = []; };
const playing = () => G.phase === 'running' || G.phase === 'paused';

export function startPlayer(roomFromHash) {
  P = store.get(STORE) || {};
  P.playerId ||= randomId();
  R = rulesFor(P.settings);
  if (roomFromHash && P.room !== roomFromHash) { P.room = roomFromHash; P.round = null; P.autoJoin = false; resetRound(); }
  if (!Array.isArray(P.draft) || P.draft.length !== R.cells) P.draft = emptyCard();
  if (!Array.isArray(P.marked)) P.marked = [];
  save();
  bindUI();
  $('#p-room').value = P.room || '';
  $('#p-nickname').value = P.nick || '';
  render();
  if (P.room && P.nick && P.autoJoin) connect();
  else (P.room ? $('#p-nickname') : $('#p-room')).focus();
  setInterval(tick, 200);
  keepAwake();
}

// ---------- Netzwerk ----------

function connect() {
  setJoinMsg(`Verbinde mit Raum ${P.room} …`);
  $('#p-joinbtn').disabled = true;
  if (net && net.room === P.room) { if (!net.send({ t: 'join', playerId: P.playerId, nick: P.nick })) net.retry(0); return; }
  if (net) net.destroy();
  net = new PlayerNet(peerId(P.room), { status, open: () => net.send({ t: 'join', playerId: P.playerId, nick: P.nick }), data: onMsg });
  net.room = P.room;
}

function status(s) {
  G.connected = s === 'online';
  const map = {
    online: ['online', 'verbunden'], connecting: ['warn', 'verbinde …'], offline: ['bad', 'keine Verbindung – neuer Versuch …'],
    'no-host': ['bad', 'Raum nicht erreichbar'], incompatible: ['bad', 'Browser ohne WebRTC'],
    blocked: ['bad', 'Verbindung blockiert?'], 'no-signal': ['bad', 'Server nicht erreichbar'],
  };
  const [cls, text] = map[s] || ['warn', s];
  const st = $('#p-status');
  st.className = `status ${cls}`;
  st.textContent = text;
  renderNetWarning(s);
  if (!G.joined && (s === 'blocked' || s === 'no-signal')) $('#p-joinbtn').disabled = false;
  if (!G.joined && s === 'no-host') {
    setJoinMsg(`Raum ${P.room} wurde nicht gefunden. Stimmt der Code und ist das Spiel beim Spielleiter geöffnet? Neuer Versuch läuft …`, 'bad');
    $('#p-joinbtn').disabled = false;
  }
  renderEditorState();
}

/** Deutlicher Hinweis, wenn das Netzwerk die Verbindung vermutlich blockiert. */
function renderNetWarning(s) {
  const box = $('#p-netwarn');
  if (s === 'online' || s === 'connecting' || s === 'no-host') { box.hidden = true; return; }
  const texts = {
    blocked: ['Die Verbindung zum Spielleiter kommt nicht zustande.',
      'Der Raum wurde gefunden, aber das Netzwerk (z. B. das Schul-WLAN) blockiert vermutlich die direkte Verbindung zwischen den Geräten.'],
    'no-signal': ['Der Vermittlungsserver ist nicht erreichbar.',
      'Das Netzwerk sperrt vermutlich den Server 0.peerjs.com, oder das Gerät ist offline.'],
  };
  if (!texts[s]) return;
  const [title, body] = texts[s];
  box.replaceChildren(
    el('strong', { text: title }),
    el('p', { text: body }),
    el('p', { text: 'Das kann helfen: mobile Daten oder einen Hotspot nutzen – oder den Verbindungstest öffnen und das Ergebnis der Lehrkraft zeigen. Das Spiel versucht es weiter automatisch.' }),
    el('a', { class: 'btn small', href: '#test', text: 'Verbindungstest öffnen' }),
  );
  box.hidden = false;
}

function onMsg(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'welcome': {
      G.joined = true;
      P.nick = m.nick;
      setRules(m.settings);
      P.autoJoin = true;
      if (P.round !== m.round) { resetRound(); P.round = m.round; }
      if (m.card) P.card = m.card;
      else if (P.card) { // Host kennt die Karte nicht (mehr) → erneut senden
        P.draft = P.card.slice(); P.card = null;
        G.sending = net.send({ t: 'card', card: P.draft });
      }
      Object.assign(G, { phase: m.phase, interval: m.interval, balls: m.balls || [], cardAt: m.cardAt || 0, end: m.end });
      setRemaining(m.remaining);
      setJoinMsg('');
      $('#p-joinbtn').disabled = false;
      break;
    }
    case 'error':
      if (m.code === 'nickTaken' || m.code === 'badNick') {
        G.joined = false; P.autoJoin = false;
        setJoinMsg(m.code === 'nickTaken' ? 'Dieser Spitzname ist schon vergeben – bitte wähle einen anderen.' : 'Bitte gib einen Spitznamen ein.', 'bad');
        $('#p-joinbtn').disabled = false;
        $('#p-nickname').select();
      } else if (m.code === 'badCard') { G.sending = false; toast('Die Karte wurde nicht angenommen. Bitte prüfe deine Zahlen.', 'bad'); }
      break;
    case 'cardOk':
      P.card = m.card; G.cardAt = m.cardAt; G.sending = false;
      break;
    case 'ball':
      G.balls.push({ nr: m.nr, text: m.text });
      if (m.phase) G.phase = m.phase;
      setRemaining(m.remaining);
      try { navigator.vibrate?.(80); } catch { /* egal */ }
      flashTask();
      break;
    case 'state':
      G.phase = m.phase; G.interval = m.interval; setRemaining(m.remaining);
      break;
    case 'bingoResult':
      if (m.valid) toast(`🎉 BINGO! Du bist auf Platz ${m.place} (${m.lines.join(', ')}).`, 'good', 7000);
      else if (m.reason === 'notRunning') toast('Die Runde läuft gerade nicht.', 'warn');
      else if (m.wrong?.length) toast(`Leider kein Bingo: ${m.wrong.join(', ')} ${m.wrong.length === 1 ? 'wurde' : 'wurden'} nicht gezogen. Rechne noch mal nach!`, 'bad', 7000);
      else toast('Leider kein Bingo – keine vollständige Reihe mit gezogenen Zahlen.', 'bad', 6000);
      break;
    case 'announce':
      if (m.nick !== P.nick) toast(`🎉 ${m.nick} hat BINGO! (Platz ${m.place})`, 'info', 5000);
      break;
    case 'end':
      G.phase = 'ended'; G.end = { balls: m.balls, winners: m.winners };
      break;
    case 'settings':
      setRules(m.settings);
      resetRound();
      G.sending = false;
      toast(`Der Spielleiter hat die Aufgaben geändert: ${R.label}. Bitte fülle deine Karte neu aus.`, 'info', 6000, 'settings');
      break;
    case 'newRound':
      P.round = m.round; resetRound();
      Object.assign(G, { phase: 'lobby', balls: [], end: null, cardAt: 0, sending: false });
      toast('Neue Runde! Trag deine Glückszahlen ein.', 'info', 5000);
      break;
    case 'closed':
      G.joined = false; P.autoJoin = false; net?.destroy(); net = null;
      setJoinMsg('Der Spielleiter hat das Spiel beendet. Für ein neues Spiel brauchst du den neuen Raumcode.', 'warn');
      break;
    default:
      return;
  }
  save();
  render();
}

function setRemaining(ms) { G.remaining = Math.max(0, Number(ms) || 0); G.nextAt = Date.now() + G.remaining; }

// ---------- Oberfläche ----------

function setJoinMsg(text, kind = '') { const m = $('#p-joinmsg'); m.textContent = text; m.className = `msg ${kind}`; }

function bindUI() {
  $('#p-room').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
  $('#p-joinform').addEventListener('submit', (e) => {
    e.preventDefault();
    const room = cleanCode($('#p-room').value);
    const nick = cleanNick($('#p-nickname').value);
    if (room.length !== 6) return setJoinMsg('Der Raumcode hat 6 Zeichen.', 'bad');
    if (!nick) return setJoinMsg('Bitte gib einen Spitznamen ein.', 'bad');
    if (room !== P.room) { P.room = room; P.round = null; resetRound(); }
    P.nick = nick;
    save();
    history.replaceState(null, '', `#join?room=${room}`);
    connect();
  });

  buildEditor();
  $('#p-fill').addEventListener('click', () => { P.draft = randomFill(P.draft, R); save(); renderEditor(); });
  $('#p-clear').addEventListener('click', () => { if (confirm('Alle Zahlen löschen?')) { P.draft = emptyCard(); save(); renderEditor(); } });
  $('#p-ready').addEventListener('click', () => {
    if (!validateCard(P.draft, R).ok) return;
    if (!net?.send({ t: 'card', card: P.draft })) return toast('Keine Verbindung zum Spielleiter.', 'bad');
    G.sending = true;
    renderEditorState();
  });
  $('#p-bingo').addEventListener('click', () => {
    if (Date.now() - lastBingo < 2000) return;
    if (!net?.send({ t: 'bingo', marked: P.marked })) return toast('Keine Verbindung zum Spielleiter.', 'bad');
    lastBingo = Date.now();
    toast('BINGO gemeldet – wird geprüft …', 'info', 2000);
  });
}

/** Übernimmt neue Regeln; bei anderer Karte/anderem Zahlenraum wird alles zurückgesetzt. */
function setRules(settings) {
  const next = rulesFor(settings);
  const changed = JSON.stringify(next.settings) !== JSON.stringify(R.settings);
  R = next;
  P.settings = next.settings;
  if (changed || P.draft.length !== R.cells) { resetRound(); buildEditor(); }
  applyLayout();
}

function applyLayout() {
  for (const id of ['#p-editor', '#p-grid', '#p-endgrid']) {
    const g = $(id);
    g.style.setProperty('--size', R.size);
    g.classList.toggle('s3', R.size === 3);
  }
  $('#p-cardhint').textContent = `${R.label}: Trage ${R.need} verschiedene Zahlen von ${R.min} bis ${R.max} ein.`
    + (R.free === null ? '' : ' Die Mitte ist ein Freifeld.');
}

function buildEditor() {
  const ed = $('#p-editor');
  ed.replaceChildren();
  for (let i = 0; i < R.cells; i++) {
    if (i === R.free) { ed.append(el('div', { class: 'cell free', text: 'FREI' })); continue; }
    const inp = el('input', {
      class: 'cell', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3,
      'aria-label': `Feld ${Math.floor(i / R.size) + 1}-${(i % R.size) + 1}`, 'data-i': i, autocomplete: 'off',
    });
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 3);
      P.draft[i] = inp.value === '' ? null : parseInt(inp.value, 10);
      save();
      renderEditorState();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); focusNext(i); }
    });
    ed.append(inp);
  }
  applyLayout();
}

function focusNext(i) {
  for (let j = i + 1; j < R.cells; j++) {
    const n = document.querySelector(`#p-editor input[data-i="${j}"]`);
    if (n) { n.focus(); n.select(); return; }
  }
  $('#p-ready').focus();
}

function show(id) {
  for (const s of ['p-join', 'p-card', 'p-game', 'p-end']) $(`#${s}`).hidden = s !== id;
}

function render() {
  $('#p-who').textContent = G.joined ? `${P.nick} · Raum ${P.room}` : '';
  if (!G.joined) return show('p-join');
  if (G.phase === 'ended' && G.end) { show('p-end'); return renderEnd(); }
  if (!P.card) { show('p-card'); return renderEditor(); }
  show('p-game');
  renderGame();
}

function renderEditor() {
  document.querySelectorAll('#p-editor input').forEach((inp) => {
    const v = P.draft[Number(inp.dataset.i)];
    inp.value = v === null || v === undefined ? '' : String(v);
  });
  renderEditorState();
}

function renderEditorState() {
  if (!P || $('#p-card').hidden) return;
  const { ok, errors, filled } = validateCard(P.draft, R);
  document.querySelectorAll('#p-editor input').forEach((inp) => {
    const e = errors[Number(inp.dataset.i)];
    inp.classList.toggle('err', e === 'dup' || e === 'range');
    inp.disabled = G.sending;
  });
  const dups = errors.some((e) => e === 'dup');
  const range = errors.some((e) => e === 'range');
  const msg = $('#p-cardmsg');
  msg.className = `msg ${dups || range ? 'bad' : ''}`;
  msg.textContent = G.sending ? 'Karte wird gesendet …'
    : range ? `Nur Zahlen von ${R.min} bis ${R.max} sind erlaubt.`
      : dups ? 'Jede Zahl darf nur einmal vorkommen.'
        : ok ? 'Perfekt! Deine Karte ist vollständig.' : `${filled} von ${R.need} Feldern ausgefüllt.`;
  $('#p-ready').disabled = !ok || G.sending || !G.connected;
  $('#p-fill').disabled = G.sending;
  $('#p-clear').disabled = G.sending;
  $('#p-late').hidden = !playing();
}

function cellButton(i, cls, text, onclick) {
  return el('button', { type: 'button', class: `cell ${cls}`, onclick, 'aria-pressed': cls.includes('marked') ? 'true' : 'false', text });
}

function renderGame() {
  const m = new Set(P.marked);
  $('#p-grid').replaceChildren(...P.card.map((v, i) => {
    if (i === R.free) return el('div', { class: 'cell free', text: 'FREI' });
    return cellButton(i, m.has(i) ? 'marked' : '', String(v), () => toggleMark(i));
  }));
  $('#p-grid').classList.toggle('locked', !playing());
  $('#p-bingo').disabled = !playing() || markedLines(P.marked, R).length === 0;

  const last = G.balls[G.balls.length - 1];
  if (G.phase === 'lobby') {
    $('#p-ballnr').textContent = 'Deine Karte ist abgegeben';
    $('#p-task').textContent = 'Warte auf den Start …';
  } else {
    $('#p-ballnr').textContent = last ? `Kugel ${last.nr}${G.phase === 'paused' ? ' · pausiert' : ''}` : '';
    $('#p-task').textContent = last ? last.text : '–';
  }
  $('#p-taskbox').classList.toggle('waiting', G.phase === 'lobby');

  const prev = G.balls.slice(0, -1).reverse();
  $('#p-histcount').textContent = String(prev.length);
  $('#p-history').replaceChildren(...prev.map((b) =>
    el('li', { class: b.nr <= G.cardAt ? 'nocount' : '', value: b.nr, title: b.nr <= G.cardAt ? 'zählt nicht für dich (vor deiner Karte gezogen)' : null }, b.text)));
  tick();
}

function toggleMark(i) {
  if (!playing()) return toast('Warte, bis die Runde startet.', 'info', 2000);
  const m = new Set(P.marked);
  if (m.has(i)) m.delete(i); else m.add(i);
  P.marked = [...m];
  save();
  renderGame();
}

function flashTask() {
  const t = $('#p-task');
  t.classList.remove('flash');
  void t.offsetWidth;
  t.classList.add('flash');
}

function tick() {
  if ($('#p-game').hidden) return;
  const r = G.phase === 'running' ? Math.max(0, G.nextAt - Date.now()) : G.phase === 'paused' ? G.remaining : 0;
  const frac = playing() ? Math.min(1, r / (G.interval * 1000)) : 0;
  $('#p-bar').style.width = `${frac * 100}%`;
  $('#p-count').textContent = G.phase === 'running' ? `nächste Kugel in ${Math.ceil(r / 1000)} s`
    : G.phase === 'paused' ? 'Spiel pausiert' : '';
}

function renderEnd() {
  const { balls, winners } = G.end;
  $('#p-winners').replaceChildren(...winners.map((w) =>
    el('li', { class: w.nick === P.nick ? 'me' : '' }, el('strong', { text: w.nick }), ` – nach Kugel ${w.ballNr}`)));
  if (!winners.length) $('#p-winners').append(el('li', { class: 'empty', text: 'Diesmal kein Bingo.' }));

  const grid = $('#p-endgrid');
  const legend = $('#p-legend');
  if (P.card) {
    const drawn = new Set(balls.filter((b) => b.nr > G.cardAt).map((b) => b.result));
    const m = new Set(P.marked);
    grid.replaceChildren(...P.card.map((v, i) => {
      if (i === R.free) return el('div', { class: 'cell free', text: 'FREI' });
      const cls = m.has(i) ? (drawn.has(v) ? 'right' : 'wrong') : drawn.has(v) ? 'missed' : '';
      return el('div', { class: `cell ${cls}`, text: String(v) });
    }));
    grid.hidden = false; legend.hidden = false;
  } else { grid.hidden = true; legend.hidden = true; }

  $('#p-solutions').replaceChildren(...balls.map((b) =>
    el('li', {}, el('span', { class: 'expr', text: `${b.text} =` }), el('strong', { text: ` ${b.result}` }))));
}
