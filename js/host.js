// Spielleiter: hält den kompletten Spielzustand und ist maßgeblich.
import { generateTask, checkBingo, validateCard, lineLabel, rulesFor, normalizeSettings, DEFAULT_SETTINGS } from './game.js';
import { HostNet, peerId } from './net.js';
import { $, $$, el, toast, store, beep, fanfare, keepAwake, cleanNick } from './ui.js';

const STORE = 'mb_host_v1';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RING = 2 * Math.PI * 54;

let S; // Spielzustand (wird gespeichert)
let R; // Regeln der aktuellen Runde (aus S.settings abgeleitet)
let net;
const conns = new Map(); // playerId -> DataConnection
let bannerTimer;

const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const fresh = (code = newCode()) => ({
  code, round: 1, phase: 'lobby', interval: 30, balls: [], nextAt: 0, remaining: 0,
  players: {}, winners: [], claims: [], sound: true, settings: { ...DEFAULT_SETTINGS },
});

function save() { store.set(STORE, { ...S, savedAt: Date.now() }); }
function load() {
  const s = store.get(STORE);
  return s && s.code && Date.now() - (s.savedAt || 0) < 6 * 3600e3 ? s : null;
}

const joinUrl = () => `${location.origin}${location.pathname}#join?room=${S.code}`;
const rem = () => (S.phase === 'running' ? Math.max(0, S.nextAt - Date.now()) : S.phase === 'paused' ? S.remaining : 0);
const playerList = () => Object.entries(S.players).sort((a, b) => a[1].joinedAt - b[1].joinedAt);

export function startHost() {
  S = load() || fresh();
  S.settings = normalizeSettings(S.settings);
  R = rulesFor(S.settings);
  if (S.phase === 'running') { S.remaining = Math.max(0, S.nextAt - Date.now()); S.phase = 'paused'; }
  for (const p of Object.values(S.players)) p.connected = false;
  save();
  bindUI();
  renderAll();
  net = new HostNet(peerId(S.code), { status: renderStatus, data: onData, close: onClose });
  setInterval(tick, 200);
  keepAwake();
}

// ---------- Netzwerk ----------

function send(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch { /* egal */ } }
function broadcast(msg) { for (const c of conns.values()) send(c, msg); }

function onClose(conn) {
  const pid = conn.playerId;
  if (!pid || conns.get(pid) !== conn) return;
  conns.delete(pid);
  if (S.players[pid]) S.players[pid].connected = false;
  renderPlayers();
}

function onData(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'join') return handleJoin(conn, msg);
  const p = S.players[conn.playerId];
  if (!p) return;
  if (msg.t === 'card') handleCard(conn, p, msg);
  else if (msg.t === 'bingo') handleBingo(conn, p, msg);
}

function handleJoin(conn, msg) {
  const pid = String(msg.playerId || '').slice(0, 64);
  const nick = cleanNick(msg.nick);
  if (!pid || !nick) return send(conn, { t: 'error', code: 'badNick' });
  const taken = Object.entries(S.players).some(([id, p]) => id !== pid && p.nick.toLowerCase() === nick.toLowerCase());
  if (taken) return send(conn, { t: 'error', code: 'nickTaken' });

  let p = S.players[pid];
  if (!p) p = S.players[pid] = { nick, card: null, cardAt: 0, won: false, joinedAt: Date.now() };
  p.nick = nick;
  p.connected = true;
  const old = conns.get(pid);
  conn.playerId = pid;
  conns.set(pid, conn);
  if (old && old !== conn) try { old.close(); } catch { /* egal */ }
  send(conn, welcome(pid));
  save();
  renderPlayers();
}

function welcome(pid) {
  const p = S.players[pid];
  return {
    t: 'welcome', nick: p.nick, round: S.round, settings: S.settings, phase: S.phase, interval: S.interval, remaining: rem(),
    balls: S.balls.map((b, i) => ({ nr: i + 1, text: b.text })),
    card: p.card, cardAt: p.cardAt, won: p.won,
    end: S.phase === 'ended' ? endPayload() : null,
  };
}

function handleCard(conn, p, msg) {
  if (p.card) return send(conn, { t: 'cardOk', card: p.card, cardAt: p.cardAt });
  if (!Array.isArray(msg.card) || msg.card.length !== R.cells) return;
  const card = msg.card.map((v, i) => (i === R.free ? null : Number(v)));
  if (!validateCard(card, R).ok) return send(conn, { t: 'error', code: 'badCard' });
  p.card = card;
  p.cardAt = S.balls.length; // nur Kugeln ab jetzt zählen (wichtig für Nachzügler)
  send(conn, { t: 'cardOk', card, cardAt: p.cardAt });
  save();
  renderPlayers();
}

function handleBingo(conn, p, msg) {
  if (!p.card) return;
  if (S.phase !== 'running' && S.phase !== 'paused') return send(conn, { t: 'bingoResult', valid: false, reason: 'notRunning' });
  const now = Date.now();
  if (p.lastBingo && now - p.lastBingo < 2000) return;
  p.lastBingo = now;

  const marked = Array.isArray(msg.marked) ? msg.marked.filter((i) => Number.isInteger(i) && i >= 0 && i < R.cells) : [];
  const drawn = new Set(S.balls.slice(p.cardAt).map((b) => b.result));
  const r = checkBingo(p.card, marked, drawn, R);
  const ballNr = S.balls.length;
  const pid = conn.playerId;
  let place = null;
  let first = false;
  if (r.valid) {
    if (!p.won) { p.won = true; S.winners.push({ pid, nick: p.nick, ballNr }); first = true; }
    place = S.winners.findIndex((w) => w.pid === pid) + 1;
  }
  const lines = r.lines.map((i) => lineLabel(i, R));
  S.claims.unshift({ nick: p.nick, ballNr, valid: r.valid, lines, wrong: r.wrong, place });
  send(conn, { t: 'bingoResult', valid: r.valid, lines, wrong: r.wrong, place });
  if (first) {
    broadcast({ t: 'announce', nick: p.nick, place });
    showBanner(`BINGO! ${p.nick}`, `Platz ${place} · ${lines.join(', ')} · nach Kugel ${ballNr}`);
    if (S.sound) fanfare();
  } else if (!r.valid && S.sound) beep(220, 0.3);
  save();
  renderClaims();
  renderPlayers();
}

// ---------- Spielablauf ----------

function drawBall() {
  const t = generateTask(new Set(S.balls.map((b) => b.result)), R);
  if (!t) {
    if (S.phase === 'running') { S.phase = 'paused'; S.remaining = 0; broadcastState(); }
    toast(`Alle ${R.total} Kugeln wurden gezogen.`, 'warn');
    renderGame();
    return;
  }
  S.balls.push(t);
  const ms = S.interval * 1000;
  if (S.phase === 'running') S.nextAt = Date.now() + ms; else S.remaining = ms;
  broadcast({ t: 'ball', nr: S.balls.length, text: t.text, remaining: rem(), phase: S.phase });
  if (S.sound) beep(880, 0.15);
  save();
  renderGame();
}

function broadcastState() { broadcast({ t: 'state', phase: S.phase, remaining: rem(), interval: S.interval }); }

function tick() {
  if (S.phase === 'running' && Date.now() >= S.nextAt) drawBall();
  if (S.phase !== 'running' && S.phase !== 'paused') return;
  const r = rem();
  $('#h-count').textContent = S.phase === 'paused' ? '⏸' : String(Math.ceil(r / 1000));
  $('#h-ring').style.strokeDashoffset = String(RING * (1 - Math.min(1, r / (S.interval * 1000))));
}

function startRound() {
  const ready = Object.values(S.players).filter((p) => p.card).length;
  if (!ready && !confirm('Noch hat niemand eine fertige Karte abgegeben. Trotzdem starten?')) return;
  S.phase = 'running';
  S.nextAt = Date.now();
  drawBall(); // erste Kugel sofort
  broadcastState();
  renderAll();
}

function togglePause() {
  if (S.phase === 'running') { S.remaining = rem(); S.phase = 'paused'; }
  else if (S.phase === 'paused') {
    if (S.balls.length >= R.total) return toast('Alle Kugeln sind gezogen.', 'warn');
    S.phase = 'running'; S.nextAt = Date.now() + S.remaining;
  }
  broadcastState();
  save();
  renderGame();
}

function endPayload() {
  return {
    balls: S.balls.map((b, i) => ({ nr: i + 1, text: b.text, result: b.result })),
    winners: S.winners.map((w) => ({ nick: w.nick, ballNr: w.ballNr })),
  };
}

function endRound() {
  if (!confirm('Runde wirklich beenden? Danach werden alle Lösungen angezeigt.')) return;
  S.phase = 'ended';
  broadcast({ t: 'end', ...endPayload() });
  save();
  renderAll();
}

function newRound() {
  S.round++;
  S.phase = 'lobby';
  S.balls = []; S.winners = []; S.claims = [];
  for (const [pid, p] of Object.entries(S.players)) {
    if (!p.connected) { delete S.players[pid]; continue; }
    Object.assign(p, { card: null, cardAt: 0, won: false });
  }
  broadcast({ t: 'newRound', round: S.round });
  save();
  renderAll();
}

function setInterval_(v) {
  S.interval = Math.min(120, Math.max(10, Number(v) || 30));
  $$('.h-interval').forEach((i) => { i.value = S.interval; });
  $$('.h-interval-val').forEach((s) => { s.textContent = `${S.interval} s`; });
  broadcastState();
  save();
}

function showBanner(title, sub) {
  const b = $('#h-banner');
  b.replaceChildren(el('div', { class: 'banner-title', text: `🎉 ${title}` }), el('div', { class: 'banner-sub', text: sub }));
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, 6000);
}

// ---------- Oberfläche ----------

function bindUI() {
  $('#h-start').addEventListener('click', startRound);
  $('#h-pause').addEventListener('click', togglePause);
  $('#h-next').addEventListener('click', () => { if (S.phase === 'running' || S.phase === 'paused') drawBall(); });
  $('#h-endbtn').addEventListener('click', endRound);
  $('#h-newround').addEventListener('click', newRound);
  $('#h-banner').addEventListener('click', () => { $('#h-banner').hidden = true; });
  $('#h-newgame').addEventListener('click', () => {
    if (!confirm('Neues Spiel mit neuem Raumcode starten? Alle Spieler müssen neu beitreten.')) return;
    broadcast({ t: 'closed' });
    store.del(STORE);
    net.destroy();
    location.reload();
  });
  $('#h-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(joinUrl()); toast('Link kopiert'); } catch { toast(joinUrl()); }
  });
  $('#h-sound').checked = S.sound;
  $('#h-sound').addEventListener('change', (e) => { S.sound = e.target.checked; save(); });
  $$('.h-interval').forEach((i) => i.addEventListener('input', (e) => setInterval_(e.target.value)));
  setInterval_(S.interval);

  $('#h-tasks').addEventListener('change', () => applySettings(readSettings()));
}

// ---------- Aufgaben-Einstellungen ----------

function readSettings() {
  const val = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;
  return { mode: val('h-mode'), level: val('h-level'), range: Number(val('h-range')), sub: $('#h-sub').checked };
}

function applySettings(next) {
  const s = normalizeSettings(next);
  if (S.phase !== 'lobby' || JSON.stringify(s) === JSON.stringify(S.settings)) return renderSettings();
  const ready = Object.values(S.players).filter((p) => p.card).length;
  if (ready && !confirm(`${ready} ${ready === 1 ? 'Karte ist' : 'Karten sind'} schon abgegeben. Bei geänderten Aufgaben müssen alle ihre Karte neu ausfüllen. Fortfahren?`)) {
    return renderSettings();
  }
  S.settings = s;
  R = rulesFor(s);
  for (const p of Object.values(S.players)) Object.assign(p, { card: null, cardAt: 0 });
  broadcast({ t: 'settings', settings: s });
  save();
  renderSettings();
  renderBoard();
  renderPlayers();
}

function renderSettings() {
  const s = S.settings;
  const check = (name, value) => { const i = document.querySelector(`input[name="${name}"][value="${value}"]`); if (i) i.checked = true; };
  check('h-mode', s.mode); check('h-level', s.level); check('h-range', s.range);
  $('#h-sub').checked = s.sub;
  $('#h-mul-opts').hidden = s.mode !== 'mul';
  $('#h-add-opts').hidden = s.mode !== 'add';
  const factors = R.mode === 'mul' ? ` · a von 1 bis ${R.aMax}, b von 1 bis ${R.bMax}` : '';
  $('#h-rules-info').textContent = `Beispiel: ${R.example}${factors} · Karte ${R.size}×${R.size}`
    + `${R.free === null ? '' : ' mit Freifeld'}, Zahlen ${R.min}–${R.max} · ${R.total} Kugeln`;
}

function renderBoard() {
  $('#h-board').replaceChildren(...Array.from({ length: R.total }, (_, i) => el('span', { 'data-n': R.min + i, text: R.min + i })));
}

function renderAll() {
  renderSettings();
  renderBoard();
  $('#h-lobby').hidden = S.phase !== 'lobby';
  $('#h-game').hidden = S.phase !== 'running' && S.phase !== 'paused';
  $('#h-end').hidden = S.phase !== 'ended';
  renderCode();
  renderPlayers();
  renderGame();
  renderClaims();
  if (S.phase === 'ended') renderEnd();
}

function renderCode() {
  $('#h-code').textContent = S.code;
  $('#h-code-small').textContent = S.code;
  $('#h-url').textContent = joinUrl().replace(/^https?:\/\//, '');
  const box = $('#h-qr');
  box.replaceChildren();
  if (typeof qrcode === 'function') {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl());
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); // nur von uns erzeugtes SVG
  }
}

function renderStatus(s, tries) {
  const map = {
    online: ['online', 'Raum offen'],
    reconnecting: ['warn', 'Verbindung zum Vermittlungsserver wird wiederhergestellt …'],
    busy: ['warn', `Raumcode wird noch freigegeben … (Versuch ${tries})`],
    incompatible: ['bad', 'Dieser Browser unterstützt kein WebRTC'],
  };
  const [cls, text] = map[s] || ['warn', s];
  const st = $('#h-status');
  st.className = `status ${cls}`;
  st.textContent = text;
  if (s === 'busy' && tries === 8) toast('Der Raumcode ist noch belegt. Falls das so bleibt: „Neues Spiel“ wählen.', 'warn', 8000);
}

function playerItem(pid, p, inGame) {
  let badge;
  if (!p.connected) badge = el('span', { class: 'badge off', text: 'offline' });
  else if (p.won) badge = el('span', { class: 'badge win', text: `🏆 Platz ${S.winners.findIndex((w) => w.pid === pid) + 1}` });
  else if (p.card) badge = el('span', { class: 'badge ok', text: inGame && p.cardAt > 0 ? `Karte ✓ (ab Kugel ${p.cardAt + 1})` : 'Karte ✓' });
  else badge = el('span', { class: 'badge wait', text: 'füllt aus …' });
  return el('li', { class: p.connected ? '' : 'offline' }, el('span', { class: 'nick', text: p.nick }), badge);
}

function renderPlayers() {
  const list = playerList();
  const ready = list.filter(([, p]) => p.card).length;
  for (const [id, inGame] of [['#h-players-lobby', false], ['#h-players-game', true]]) {
    const ul = $(id);
    ul.replaceChildren(...list.map(([pid, p]) => playerItem(pid, p, inGame)));
    if (!list.length) ul.append(el('li', { class: 'empty', text: 'Noch niemand da – QR-Code scannen lassen.' }));
  }
  const count = `${ready}/${list.length}`;
  $('#h-pcount').textContent = count;
  $('#h-pcount2').textContent = count;
  $('#h-lobby-hint').textContent = list.length
    ? `${ready} von ${list.length} Karten sind fertig.`
    : '';
}

function renderGame() {
  if (S.phase !== 'running' && S.phase !== 'paused') return;
  const last = S.balls[S.balls.length - 1];
  $('#h-ballnr').textContent = `Kugel ${S.balls.length} von ${R.total} · ${R.label}`;
  $('#h-task').textContent = last ? last.text : '–';
  $('#h-pause').textContent = S.phase === 'paused' ? '▶ Weiter' : '⏸ Pause';
  $('#h-game').classList.toggle('paused', S.phase === 'paused');
  const drawn = new Set(S.balls.map((b) => b.result));
  $$('#h-board span').forEach((s) => s.classList.toggle('drawn', drawn.has(Number(s.dataset.n))));
  tick();
}

function renderClaims() {
  const ul = $('#h-claims');
  ul.replaceChildren(...S.claims.map((c) => el('li', { class: c.valid ? 'ok' : 'bad' },
    el('strong', { text: `${c.valid ? '✔' : '✘'} ${c.nick}` }),
    el('span', {
      text: c.valid
        ? ` – gültig (${c.lines.join(', ')}), Platz ${c.place}, Kugel ${c.ballNr}`
        : c.wrong.length
          ? ` – ungültig: ${c.wrong.join(', ')} ${c.wrong.length === 1 ? 'wurde' : 'wurden'} nicht gezogen`
          : ' – ungültig: keine vollständige Reihe',
    }))));
  if (!S.claims.length) ul.append(el('li', { class: 'empty', text: 'Noch keine Meldungen.' }));
}

function renderEnd() {
  const w = $('#h-winners');
  w.replaceChildren(...S.winners.map((x) => el('li', {}, el('strong', { text: x.nick }), ` – nach Kugel ${x.ballNr}`)));
  if (!S.winners.length) w.append(el('li', { class: 'empty', text: 'Diesmal kein Bingo.' }));
  $('#h-solutions').replaceChildren(...S.balls.map((b) =>
    el('li', {}, el('span', { class: 'expr', text: `${b.text} =` }), el('strong', { text: ` ${b.result}` }))));
}
