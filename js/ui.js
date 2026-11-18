// Kleine DOM- und Browser-Helfer

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Element bauen; Nutzertext nur über `text` bzw. String-Kinder (nie innerHTML). */
export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export function toast(msg, kind = 'info', ms = 3500, key = null) {
  const box = $('#toasts');
  // Gleichartige Hinweise ersetzen sich, statt sich zu stapeln
  if (key) box.querySelectorAll(`[data-key="${key}"]`).forEach((o) => o.remove());
  const t = el('div', { class: `toast ${kind}`, role: 'status', text: msg, 'data-key': key });
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
}

// Nur sessionStorage: Der Spielstand überlebt ein Neuladen im selben Tab,
// bleibt aber nicht dauerhaft auf (fremden) Geräten liegen.
export const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* privat */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* privat */ } },
};
// Reste älterer Versionen (localStorage) entfernen
try { ['mb_host_v1', 'mb_player_v1'].forEach((k) => localStorage.removeItem(k)); } catch { /* egal */ }

export function randomId() {
  try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

let actx = null;
export function beep(freq = 880, dur = 0.18, delay = 0) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch { /* kein Ton */ }
}
export function fanfare() { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, i * 0.13)); }

/** Bildschirm während des Spiels wach halten (wo unterstützt). */
export function keepAwake() {
  const req = async () => {
    try { if (document.visibilityState === 'visible' && navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { /* egal */ }
  };
  req();
  document.addEventListener('visibilitychange', req);
}

/** Spitzname: Steuer- und Richtungszeichen raus, Leerraum zusammenfassen, 1–20 Zeichen. */
export const cleanNick = (n) => [...String(n ?? '')
  .replace(/[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, ' ')
  .replace(/\s+/g, ' ').trim()].slice(0, 20).join('').trim();
export const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
