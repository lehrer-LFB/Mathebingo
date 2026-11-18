// Prüft das gemeinsame Session-Cookie des Weblehrerzimmers (Auth.js v5, JWT-Session).
// Vorgabe des Supervisors: @auth/core/jwt decode(), Salt = Cookie-Name, Rolle aus token.roles.
import { decode } from '@auth/core/jwt';

/** Über HTTPS setzt Auth.js das Präfix __Secure-, lokal über http nicht. */
export const COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'];
export const TEACHER_ROLE = 'Lehrkraft';

export function parseCookies(header = '') {
  const out = new Map();
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    let value = part.slice(i + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* unverändert lassen */ }
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

/**
 * Liefert { name, isTeacher } für eine gültige Sitzung, sonst null.
 * Gestückelte Cookies (.0, .1 …) werden bewusst nicht unterstützt – unsere Tokens sind klein.
 * Das Secret wird nie geloggt.
 */
export async function sessionFromCookie(cookieHeader, secret, now = Date.now()) {
  if (!secret || !cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  for (const name of COOKIE_NAMES) {
    const value = cookies.get(name);
    if (!value) continue;
    try {
      const token = await decode({ token: value, secret, salt: name });
      if (!token || typeof token !== 'object') return null;
      if (typeof token.exp !== 'number' || token.exp * 1000 <= now) return null;
      const roles = Array.isArray(token.roles) ? token.roles : [];
      return { name: typeof token.name === 'string' ? token.name : '', isTeacher: roles.includes(TEACHER_ROLE) };
    } catch {
      return null; // falsches Secret, manipuliert, abgelaufen …
    }
  }
  return null;
}
