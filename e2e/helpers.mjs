import { encode } from '@auth/core/jwt';

export const PORT = 3005;
// Nur für die lokalen Tests – kein echtes Secret.
export const E2E_SECRET = 'e2e-secret-nur-fuer-tests-0123456789abcdef';
export const COOKIE_NAME = 'authjs.session-token'; // lokal über http ohne __Secure-

/** Session-Cookie wie vom Portal (Auth.js), erzeugt mit encode() aus @auth/core/jwt. */
export async function teacherCookie(roles = ['Lehrkraft']) {
  const value = await encode({ token: { name: 'Frau Testlehrkraft', email: 'test@example.org', roles }, secret: E2E_SECRET, salt: COOKIE_NAME, maxAge: 3600 });
  return { name: COOKIE_NAME, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' };
}

/** Neuer Browser-Kontext mit dem Geräteprofil des aktuellen Projekts. */
export async function device(browser, testInfo, { teacher = false } = {}) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL } = testInfo.project.use;
  const ctx = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, baseURL });
  if (teacher) await ctx.addCookies([await teacherCookie()]);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}

/** Ergebnis einer angezeigten Aufgabe („7 × 45 − 280“, „13 + 5“ …) */
export function solve(text) {
  const expr = text.replace(/×/g, '*').replace(/−/g, '-').replace(/[^0-9+\-* ]/g, '');
  const t = expr.match(/\d+|[+\-*]/g);
  let acc = Number(t[0]);
  let i = 1;
  // a × b ± e: Punkt vor Strich
  if (t[1] === '*') { acc *= Number(t[2]); i = 3; }
  for (; i < t.length; i += 2) acc = t[i] === '+' ? acc + Number(t[i + 1]) : acc - Number(t[i + 1]);
  return acc;
}
