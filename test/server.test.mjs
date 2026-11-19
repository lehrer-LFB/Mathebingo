import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { encode } from '@auth/core/jwt';
import { createApp } from '../server/app.mjs';

const SECRET = 'test-secret-nur-fuer-tests-0123456789abcdef';
const COOKIE = 'authjs.session-token';
let app;
let base;
let origin;
const logs = [];

const LIMITS = { maxRooms: 3, maxPlayers: 3, joinFails: 8, joinBlockMs: 400, joinFailWindowMs: 60_000, playerMsgsPerSec: 20, awayMs: 300, sweepMs: 50, helloMs: 2000 };

before(async () => {
  app = createApp({ port: 0, basePath: '/mathebingo', secret: SECRET, allowedOrigins: [], testSystem: true },
    { limits: LIMITS, log: (m) => logs.push(m) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const { port } = app.server.address();
  base = `http://127.0.0.1:${port}/mathebingo`;
  origin = `http://127.0.0.1:${port}`;
  app.config.allowedOrigins = [origin];
});
after(async () => { await app.close(); });

const teacherCookie = async (roles = ['Lehrkraft']) =>
  `${COOKIE}=${await encode({ token: { name: 'Herr Test', roles }, secret: SECRET, salt: COOKIE, maxAge: 3600 })}`;

/** WebSocket-Client mit Nachrichten-Warteschlange */
function client(role, { cookie, ip, org = origin } = {}) {
  const headers = { Origin: org };
  if (cookie) headers.Cookie = cookie;
  if (ip) headers['X-Forwarded-For'] = `1.2.3.4, ${ip}`;
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws${role === 'host' ? '?role=host' : ''}`, { headers });
  const queue = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else queue.push(m);
  });
  const c = {
    ws,
    opened: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', (_q, r) => rej(new Error(String(r.statusCode)))); }),
    closed: new Promise((res) => ws.once('close', (code) => res(code))),
    send: (m) => ws.send(JSON.stringify(m)),
    next(pred = () => true, ms = 2000) {
      const i = queue.findIndex(pred);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); reject(new Error('Zeitüberschreitung')); } }, ms);
      });
    },
    op: (name, ms) => c.next((m) => m.op === name, ms),
  };
  return c;
}

async function openRoom(extra = {}) {
  const h = client('host', { cookie: await teacherCookie() });
  await h.opened;
  h.send({ op: 'open', ...extra });
  const o = await h.op('opened');
  return { h, room: o.room, token: o.token, opened: o };
}

async function joinRoom(room, opts = {}, token) {
  const p = client('player', opts);
  await p.opened;
  p.send({ op: 'join', room, token });
  return { p, joined: await p.next((m) => m.op === 'joined' || m.op === 'error') };
}

// ---------- HTTP ----------

test('HTTP: Weiterleitung, Startseite, Healthcheck, api/me', async () => {
  const r = await fetch(base, { redirect: 'manual' });
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), '/mathebingo/');
  const idx = await fetch(`${base}/`);
  assert.equal(idx.status, 200);
  assert.match(await idx.text(), /Mathebingo/);
  assert.match(idx.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(await (await fetch(`${base}/health`)).text(), 'ok');
  assert.equal((await fetch(`${base}/js/game.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/qrcode-generator/qrcode-1.4.4.js`)).status, 200);

  const anon = await (await fetch(`${base}/api/me`)).json();
  assert.deepEqual(anon, { relay: true, name: null, isTeacher: false, testSystem: true });
  const me = await (await fetch(`${base}/api/me`, { headers: { Cookie: await teacherCookie() } })).json();
  assert.deepEqual(me, { relay: true, name: 'Herr Test', isTeacher: true, testSystem: true });
  const pupil = await (await fetch(`${base}/api/me`, { headers: { Cookie: await teacherCookie(['Schueler']) } })).json();
  assert.equal(pupil.isTeacher, false);
});

test('HTTP: nur freigegebene Dateien, kein Ausbruch aus dem Ordner', async () => {
  for (const p of ['/server/auth.mjs', '/package.json', '/.env', '/js/../server/app.mjs', '/js/%2e%2e/server/app.mjs', '/vendor/../LICENSE', '/node_modules/ws/package.json']) {
    assert.equal((await fetch(`${base}${p}`)).status, 404, p);
  }
  assert.equal((await fetch(`${origin}/index.html`)).status, 404, 'außerhalb des Präfix');
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});

// ---------- WebSocket: Zugang ----------

test('WS: fremde Origin und Host ohne Lehrkraft-Login werden abgelehnt', async () => {
  await assert.rejects(client('player', { org: 'https://lehrer-lfb.github.io' }).opened, /403/);
  await assert.rejects(client('player', { org: '' }).opened, /403/);
  await assert.rejects(client('host').opened, /401/);
  await assert.rejects(client('host', { cookie: await teacherCookie(['Schueler']) }).opened, /401/);
});

// ---------- WebSocket: Spielablauf ----------

test('WS: Raum, Beitritt, Weiterleitung nur zum Host, Broadcast, Rauswurf', async () => {
  const { h, room } = await openRoom();
  assert.match(room, /^[A-Z2-9]{6}$/);
  const a = await joinRoom(room);
  const b = await joinRoom(room);
  assert.equal(a.joined.op, 'joined');
  assert.equal(a.joined.host, true);
  assert.deepEqual(await h.op('peer'), { op: 'peer', pid: a.joined.pid, online: true });
  await h.op('peer');

  // Spieler:in → nur Host, Absender setzt der Relay
  a.p.send({ op: 'msg', to: b.joined.pid, from: 'gefälscht', data: { t: 'join', nick: 'A' } });
  assert.deepEqual(await h.op('msg'), { op: 'msg', from: a.joined.pid, data: { t: 'join', nick: 'A' } });
  await assert.rejects(b.p.op('msg', 300));
  // Spieler:innen dürfen keine Host-Befehle
  a.p.send({ op: 'kick', pid: b.joined.pid });
  a.p.send({ op: 'close' });

  h.send({ op: 'msg', to: b.joined.pid, data: { t: 'welcome' } });
  assert.deepEqual(await b.p.op('msg'), { op: 'msg', data: { t: 'welcome' } });
  h.send({ op: 'msg', data: { t: 'ball', nr: 1 } });
  assert.equal((await a.p.op('msg')).data.t, 'ball');
  assert.equal((await b.p.op('msg')).data.t, 'ball');

  h.send({ op: 'kick', pid: b.joined.pid });
  assert.equal((await b.p.op('kicked')).op, 'kicked');
  assert.equal(await b.p.closed, 4403);
  h.send({ op: 'close' });
  assert.equal((await a.p.op('closed')).reason, 'hostClosed');
  assert.ok(logs.length && logs.every((l) => !/127\.0\.0\.1|welcome|nick|"A"/.test(l)), 'keine Inhalte/IPs im Log');
});

test('WS: Wiederverbinden mit Token (Spieler:in und Lehrkraft)', async () => {
  const { h, room, token } = await openRoom();
  const a = await joinRoom(room);
  await h.op('peer');
  a.p.ws.close();
  assert.deepEqual(await h.op('peer'), { op: 'peer', pid: a.joined.pid, online: false });

  const again = await joinRoom(room, {}, a.joined.token);
  assert.equal(again.joined.pid, a.joined.pid);
  assert.equal(again.joined.resumed, true);
  await h.op('peer');

  // Lehrkraft trennt sich → Spieler:innen sehen das, Raum bleibt
  h.ws.close();
  assert.deepEqual(await again.p.op('host'), { op: 'host', online: false });
  again.p.send({ op: 'msg', data: { t: 'bingo' } });
  assert.deepEqual(await again.p.op('host'), { op: 'host', online: false });

  // falsches Host-Token darf den Raum nicht übernehmen
  const thief = client('host', { cookie: await teacherCookie() });
  await thief.opened;
  thief.send({ op: 'open', room, token: 'falsch' });
  assert.equal((await thief.op('error')).code, 'roomTaken');
  thief.ws.close();

  const back = await openRoom({ room, token });
  assert.equal(back.opened.resumed, true);
  assert.deepEqual(back.opened.members, [{ pid: a.joined.pid, online: true }]);
  assert.deepEqual(await again.p.op('host'), { op: 'host', online: true });
  back.h.send({ op: 'close' });
});

test('WS: Raumgrenzen – Spielerzahl und Zahl der Räume', async () => {
  const { h, room } = await openRoom();
  const ps = [];
  for (let i = 0; i < LIMITS.maxPlayers; i++) ps.push(await joinRoom(room));
  const extra = await joinRoom(room);
  assert.deepEqual(extra.joined, { op: 'error', code: 'full' });

  const more = [];
  while (app.relay.rooms.size < LIMITS.maxRooms) more.push(await openRoom());
  const over = client('host', { cookie: await teacherCookie() });
  await over.opened;
  over.send({ op: 'open' });
  assert.equal((await over.op('error')).code, 'tooManyRooms');
  over.ws.close();
  for (const r of [{ h }, ...more]) r.h.send({ op: 'close' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(app.relay.rooms.size, 0);
});

test('WS: Rate-Limit bei falschen Raumcodes pro IP', async () => {
  const ip = '10.9.8.7';
  for (let i = 0; i < LIMITS.joinFails; i++) {
    assert.equal((await joinRoom('ZZZZZZ', { ip })).joined.code, 'noRoom');
  }
  const blocked = (await joinRoom('ZZZZZZ', { ip })).joined;
  assert.equal(blocked.code, 'rate');
  assert.ok(blocked.retryIn > 0);
  // andere IP ist nicht betroffen
  assert.equal((await joinRoom('ZZZZZZ', { ip: '10.9.8.6' })).joined.code, 'noRoom');
  await new Promise((r) => setTimeout(r, LIMITS.joinBlockMs + 50));
  assert.equal((await joinRoom('ZZZZZZ', { ip })).joined.code, 'noRoom');
});

test('WS: höchstens 5 falsche Raumcodes pro Verbindung, dann Trennung', async () => {
  const p = client('player', { ip: '10.1.1.1' });
  await p.opened;
  for (let i = 0; i < 5; i++) {
    p.send({ op: 'join', room: 'YYYYYY' });
    assert.equal((await p.op('error')).code, 'noRoom');
  }
  assert.equal(await p.closed, 4429);
});

test('WS: gesperrter Raum lässt nur Bekannte wieder hinein', async () => {
  const { h, room, token } = await openRoom();
  const a = await joinRoom(room);
  h.send({ op: 'lock', locked: true });
  assert.deepEqual(await h.op('locked'), { op: 'locked', locked: true });
  assert.deepEqual((await joinRoom(room)).joined, { op: 'error', code: 'locked' });
  a.p.ws.close();
  assert.equal((await joinRoom(room, {}, a.joined.token)).joined.resumed, true, 'Wiederverbinden geht trotz Sperre');
  // Sperre bleibt beim Wiederverbinden der Lehrkraft erhalten
  h.ws.close();
  await new Promise((r) => setTimeout(r, 50));
  const back = await openRoom({ room, token });
  assert.equal(back.opened.locked, true);
  back.h.send({ op: 'lock', locked: false });
  await back.h.op('locked');
  assert.equal((await joinRoom(room)).joined.op, 'joined');
  back.h.send({ op: 'close' });
});

test('WS: zu große und zu viele Nachrichten trennen die Verbindung', async () => {
  const { h, room } = await openRoom();
  const big = await joinRoom(room);
  big.p.send({ op: 'msg', data: 'x'.repeat(5000) });
  assert.equal(await big.p.closed, 1009);

  const spam = await joinRoom(room);
  for (let i = 0; i < 30; i++) spam.p.send({ op: 'ping' });
  assert.equal(await spam.p.closed, 4429);

  // Host darf größere Nachrichten (Endstand mit allen Lösungen)
  const ok = await joinRoom(room);
  h.send({ op: 'msg', to: ok.joined.pid, data: 'y'.repeat(20_000) });
  assert.equal((await ok.p.op('msg')).data.length, 20_000);
  h.send({ op: 'close' });
});

test('WS: Aufräumen – getrennte Plätze und verlassene Räume verfallen', async () => {
  const { h, room, token } = await openRoom();
  const a = await joinRoom(room);
  await h.op('peer');
  a.p.ws.close();
  await h.op('peer');
  assert.deepEqual(await h.op('peer', 2000), { op: 'peer', pid: a.joined.pid, gone: true });
  const late = await joinRoom(room, {}, a.joined.token);
  assert.notEqual(late.joined.pid, a.joined.pid, 'altes Token verfallen → neuer Platz');

  h.ws.close();
  assert.equal((await late.p.op('closed', 2000)).reason, 'hostGone');
  assert.equal(app.relay.rooms.has(room), false);
  void token;
});

test('WS: Neustart – alle Clients bekommen shutdown', async () => {
  const solo = createApp({ basePath: '/mathebingo', secret: SECRET, allowedOrigins: [], testSystem: false }, { log: () => {} });
  await new Promise((r) => solo.server.listen(0, '127.0.0.1', r));
  const o = `http://127.0.0.1:${solo.server.address().port}`;
  solo.config.allowedOrigins = [o];
  const ws = new WebSocket(`${o.replace('http', 'ws')}/mathebingo/ws`, { headers: { Origin: o } });
  await new Promise((r) => ws.once('open', r));
  const got = new Promise((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))));
  const code = new Promise((r) => ws.once('close', r));
  await solo.close();
  assert.deepEqual(await got, { op: 'shutdown' });
  assert.equal(await code, 1012);
});

test('WS: Obergrenze für offene Verbindungen – insgesamt und pro IP (503)', async () => {
  const lim = createApp({ basePath: '/mathebingo', secret: SECRET, allowedOrigins: [], testSystem: false },
    { limits: { maxConnections: 4, maxConnectionsPerIp: 2 }, log: () => {} });
  await new Promise((r) => lim.server.listen(0, '127.0.0.1', r));
  const o = `http://127.0.0.1:${lim.server.address().port}`;
  lim.config.allowedOrigins = [o];
  const connect = (ip) => new Promise((resolve) => {
    const ws = new WebSocket(`${o.replace('http', 'ws')}/mathebingo/ws`, { headers: { Origin: o, 'X-Forwarded-For': ip } });
    ws.once('open', () => resolve({ ws, status: 101 }));
    ws.once('unexpected-response', (_q, r) => resolve({ ws, status: r.statusCode }));
    ws.once('error', () => {});
  });
  const a1 = await connect('10.0.0.1');
  const a2 = await connect('10.0.0.1');
  assert.equal((await connect('10.0.0.1')).status, 503, 'dritte Verbindung derselben IP');
  const b1 = await connect('10.0.0.2');
  const c1 = await connect('10.0.0.3');
  assert.deepEqual([a1, a2, b1, c1].map((x) => x.status), [101, 101, 101, 101]);
  assert.equal(lim.relay.clients.size, 4);
  assert.equal((await connect('10.0.0.4')).status, 503, 'Gesamtgrenze erreicht');
  // nach dem Schließen ist wieder Platz, auch für die erste IP
  const gone = new Promise((r) => a1.ws.once('close', r));
  a1.ws.close();
  await gone;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lim.relay.ipConns.get('10.0.0.1'), 1);
  const again = await connect('10.0.0.1');
  assert.equal(again.status, 101);
  await lim.close();
});
