// Reine Spiellogik – ohne DOM, damit sie auch mit Node getestet werden kann.

export const DEFAULT_SETTINGS = Object.freeze({ mode: 'mul', level: 'mid', range: 100, sub: false });

const LEVELS = {
  easy: { aMax: 10, bMax: 10, label: 'Kleines Einmaleins' },
  mid: { aMax: 10, bMax: 100, label: 'Mittel' },
  hard: { aMax: 100, bMax: 100, label: 'Schwer' },
};

function makeLines(size) {
  const idx = [...Array(size).keys()];
  const lines = [];
  for (const r of idx) lines.push(idx.map((c) => r * size + c));
  for (const c of idx) lines.push(idx.map((r) => r * size + c));
  lines.push(idx.map((i) => i * size + i));
  lines.push(idx.map((i) => i * size + (size - 1 - i)));
  return lines;
}

/** Bereinigt beliebige (z. B. über das Netz empfangene) Einstellungen. */
export function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    mode: o.mode === 'add' ? 'add' : 'mul',
    level: LEVELS[o.level] ? o.level : 'mid',
    range: Number(o.range) === 20 ? 20 : 100,
    sub: !!o.sub,
  };
}

/**
 * Leitet aus den Einstellungen alle Regeln einer Runde ab.
 * @returns {{settings, mode, aMax, bMax, sub, min, max, total, size, cells, free, lines, need, label, example}}
 */
export function rulesFor(settings) {
  const s = normalizeSettings(settings);
  let r;
  if (s.mode === 'mul') {
    const L = LEVELS[s.level];
    r = { mode: 'mul', aMax: L.aMax, bMax: L.bMax, sub: false, min: 1, max: 100, size: 5,
      label: `Mal-Aufgaben · ${L.label}`,
      example: { easy: '7 × 8 + 12', mid: '7 × 45 − 280', hard: '23 × 58 − 1297' }[s.level] };
  } else {
    r = { mode: 'add', sub: s.sub, min: s.sub ? 1 : 2, max: s.range, size: s.range === 20 ? 3 : 5,
      label: `${s.sub ? 'Plus/Minus' : 'Plus'} bis ${s.range}`,
      example: s.range === 20 ? (s.sub ? '13 − 5' : '9 + 6') : (s.sub ? '72 − 38' : '47 + 25') };
  }
  r.settings = s;
  r.total = r.max - r.min + 1;
  r.cells = r.size * r.size;
  r.free = r.size === 5 ? 12 : null; // 3×3-Karte ohne Freifeld
  r.need = r.cells - (r.free === null ? 0 : 1);
  r.lines = makeLines(r.size);
  return r;
}

export const DEFAULT_RULES = rulesFor(DEFAULT_SETTINGS);

export function lineLabel(i, rules = DEFAULT_RULES) {
  const n = rules.size;
  if (i < n) return `Zeile ${i + 1}`;
  if (i < 2 * n) return `Spalte ${i - n + 1}`;
  return 'Diagonale';
}

const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function makeTask(a, b, op, e, result) {
  const sign = (o) => (o === '-' ? '−' : o === '×' ? '×' : '+');
  const text = e === null ? `${a} ${sign(op)} ${b}` : `${a} × ${b} ${sign(op)} ${e}`;
  return { a, b, op, e, result, text };
}

/** Rechnet eine Aufgabe aus (für Tests und Kontrollen). */
export function evaluateTask(t) {
  if (t.e === null) return t.op === '-' ? t.a - t.b : t.a + t.b;
  return t.op === '-' ? t.a * t.b - t.e : t.a * t.b + t.e;
}

function mulTask(target, aMax, bMax) {
  // Algorithmus aus mathe_bingo_gui.py, aber mit vorab gewählter Zielzahl:
  //   z < 100  → a × b + e  mit 1 ≤ e ≤ 100 − z
  //   z ≥ 100  → a × b − e  mit z − 100 ≤ e ≤ z − 1 (und e ≥ 1)
  for (let i = 0; i < 10000; i++) {
    const a = rnd(1, aMax);
    const b = rnd(1, bMax);
    const z = a * b;
    if (z < 100) {
      const e = target - z;
      if (e >= 1 && e <= 100 - z) return makeTask(a, b, '+', e, target);
    } else {
      const e = z - target;
      if (e >= 1 && e >= z - 100 && e <= z - 1) return makeTask(a, b, '-', e, target);
    }
  }
  // Praktisch unerreichbar – deterministischer Rückfall
  return target === 100 ? makeTask(1, 1, '+', 99, 100) : makeTask(10, 10, '-', 100 - target, target);
}

function addTask(target, max, sub) {
  const canAdd = target >= 2; // a, b ≥ 1
  const canSub = sub && target < max; // a ≤ max, b ≥ 1
  const useSub = canSub && (!canAdd || Math.random() < 0.5);
  if (useSub) {
    const a = rnd(target + 1, max);
    return makeTask(a, a - target, '-', null, target);
  }
  const a = rnd(1, target - 1);
  return makeTask(a, target - a, '+', null, target);
}

/**
 * Erzeugt eine neue „Kugel“. Zuerst wird eine noch freie Zielzahl gewählt,
 * dann eine passende Rechnung gesucht.
 * @param {Set<number>} used bereits gezogene Ergebnisse
 * @returns {null | {a,b,op,e,result,text}}
 */
export function generateTask(used, rules = DEFAULT_RULES) {
  const free = [];
  for (let n = rules.min; n <= rules.max; n++) if (!used.has(n)) free.push(n);
  if (!free.length) return null;
  const target = free[rnd(0, free.length - 1)];
  return rules.mode === 'add' ? addTask(target, rules.max, rules.sub) : mulTask(target, rules.aMax, rules.bMax);
}

/**
 * Prüft die Karte auf Gültigkeit.
 * @param {(number|null)[]} card Felder der Karte, das Freifeld wird ignoriert
 * @returns {{ok:boolean, errors:(null|'empty'|'range'|'dup')[], filled:number}}
 */
export function validateCard(card, rules = DEFAULT_RULES) {
  const errors = Array(rules.cells).fill(null);
  if (!Array.isArray(card) || card.length !== rules.cells) {
    return { ok: false, errors: errors.map((_, i) => (i === rules.free ? null : 'empty')), filled: 0 };
  }
  const seen = new Map();
  let filled = 0;
  card.forEach((v, i) => {
    if (i === rules.free) return;
    if (v === null || v === undefined || v === '') { errors[i] = 'empty'; return; }
    if (!Number.isInteger(v) || v < rules.min || v > rules.max) { errors[i] = 'range'; return; }
    filled++;
    if (seen.has(v)) { errors[i] = 'dup'; errors[seen.get(v)] = 'dup'; } else seen.set(v, i);
  });
  return { ok: errors.every((e) => e === null), errors, filled };
}

/** Füllt leere oder fehlerhafte Felder mit zufälligen, noch nicht benutzten Zahlen. */
export function randomFill(card, rules = DEFAULT_RULES) {
  const out = Array.isArray(card) && card.length === rules.cells ? card.slice() : Array(rules.cells).fill(null);
  const { errors } = validateCard(out, rules);
  const keep = new Set();
  out.forEach((v, i) => { if (i !== rules.free && errors[i] === null) keep.add(v); });
  // Bei Duplikaten bleibt das erste Vorkommen stehen
  const seen = new Set();
  out.forEach((v, i) => {
    if (i === rules.free) return;
    if (errors[i] === 'dup' && !seen.has(v)) { seen.add(v); keep.add(v); errors[i] = null; }
  });
  const pool = [];
  for (let n = rules.min; n <= rules.max; n++) if (!keep.has(n)) pool.push(n);
  for (let i = 0; i < rules.cells; i++) {
    if (i === rules.free) { out[i] = null; continue; }
    if (errors[i] !== null) out[i] = pool.splice(rnd(0, pool.length - 1), 1)[0];
  }
  return out;
}

/** Linien, die vollständig markiert sind (ohne Prüfung, ob gezogen) – für den BINGO-Knopf. */
export function markedLines(marked, rules = DEFAULT_RULES) {
  const m = new Set(marked);
  return rules.lines.map((l, i) => (l.every((c) => c === rules.free || m.has(c)) ? i : -1)).filter((i) => i >= 0);
}

/**
 * Prüft ein Bingo.
 * @param {(number|null)[]} card
 * @param {number[]} marked markierte Feld-Indizes
 * @param {Set<number>} drawn gezogene Ergebnisse, die für diesen Spieler zählen
 * @returns {{valid:boolean, lines:number[], wrong:number[]}}
 */
export function checkBingo(card, marked, drawn, rules = DEFAULT_RULES) {
  const m = new Set(marked.filter((i) => i !== rules.free && i >= 0 && i < rules.cells));
  const wrong = [...m].filter((i) => !drawn.has(card[i])).map((i) => card[i]).sort((a, b) => a - b);
  const lines = rules.lines
    .map((l, i) => (l.every((c) => c === rules.free || (m.has(c) && drawn.has(card[c]))) ? i : -1))
    .filter((i) => i >= 0);
  return { valid: lines.length > 0, lines, wrong };
}
