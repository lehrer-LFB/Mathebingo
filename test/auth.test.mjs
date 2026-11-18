import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '@auth/core/jwt';
import { sessionFromCookie, parseCookies } from '../server/auth.mjs';

const SECRET = 'test-secret-nur-fuer-tests-0123456789abcdef';
const SECURE = '__Secure-authjs.session-token';
const PLAIN = 'authjs.session-token';

const tokenFor = (roles, { salt = SECURE, secret = SECRET, maxAge = 3600 } = {}) =>
  encode({ token: { name: 'Frau Test', email: 'test@example.org', roles }, secret, salt, maxAge });

test('Lehrkraft mit gültigem Cookie (HTTPS-Name) wird angenommen', async () => {
  const t = await tokenFor(['Lehrkraft']);
  assert.deepEqual(await sessionFromCookie(`foo=1; ${SECURE}=${t}`, SECRET), { name: 'Frau Test', isTeacher: true });
});

test('Lehrkraft mit lokalem Cookie-Namen (http) wird angenommen', async () => {
  const t = await tokenFor(['Lehrkraft'], { salt: PLAIN });
  assert.equal((await sessionFromCookie(`${PLAIN}=${t}`, SECRET))?.isTeacher, true);
});

test('falsche Rolle ist keine Lehrkraft', async () => {
  const t = await tokenFor(['Schueler']);
  assert.deepEqual(await sessionFromCookie(`${SECURE}=${t}`, SECRET), { name: 'Frau Test', isTeacher: false });
  const none = await tokenFor(undefined);
  assert.equal((await sessionFromCookie(`${SECURE}=${none}`, SECRET))?.isTeacher, false);
});

test('abgelaufenes Token wird abgelehnt', async () => {
  const t = await tokenFor(['Lehrkraft'], { maxAge: 60 });
  assert.equal(await sessionFromCookie(`${SECURE}=${t}`, SECRET, Date.now() + 120_000), null);
  const past = await tokenFor(['Lehrkraft'], { maxAge: -3600 });
  assert.equal(await sessionFromCookie(`${SECURE}=${past}`, SECRET), null);
});

test('falsches Secret, falsches Salt und Müll werden abgelehnt', async () => {
  const other = await tokenFor(['Lehrkraft'], { secret: 'ein-ganz-anderes-secret-0123456789abcdef' });
  assert.equal(await sessionFromCookie(`${SECURE}=${other}`, SECRET), null);
  const wrongSalt = await tokenFor(['Lehrkraft'], { salt: PLAIN });
  assert.equal(await sessionFromCookie(`${SECURE}=${wrongSalt}`, SECRET), null);
  assert.equal(await sessionFromCookie(`${SECURE}=kaputt`, SECRET), null);
});

test('ohne Cookie, ohne Secret oder mit gestückeltem Cookie: nicht angemeldet', async () => {
  const t = await tokenFor(['Lehrkraft']);
  assert.equal(await sessionFromCookie('', SECRET), null);
  assert.equal(await sessionFromCookie(`${SECURE}=${t}`, ''), null);
  assert.equal(await sessionFromCookie(`${SECURE}.0=${t.slice(0, 40)}; ${SECURE}.1=${t.slice(40)}`, SECRET), null);
});

test('parseCookies liest Name=Wert-Paare', () => {
  const c = parseCookies('a=1; b = zwei ; c=x%20y; kaputt');
  assert.equal(c.get('a'), '1');
  assert.equal(c.get('b'), 'zwei');
  assert.equal(c.get('c'), 'x y');
  assert.equal(c.has('kaputt'), false);
});
