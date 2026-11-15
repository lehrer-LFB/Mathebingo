// Reine Spiellogik – ohne DOM, damit sie auch mit Node getestet werden kann.

export const SIZE = 5;
export const CELLS = SIZE * SIZE;
export const FREE = 12; // Mitte der 5×5-Karte
export const MIN = 1;
export const MAX = 100;

// Alle 12 Gewinnlinien: 5 Zeilen, 5 Spalten, 2 Diagonalen
export const LINES = (() => {
  const lines = [];
  for (let r = 0; r < SIZE; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * SIZE + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

export function lineLabel(i) {
  if (i < 5) return `Zeile ${i + 1}`;
  if (i < 10) return `Spalte ${i - 4}`;
  return 'Diagonale';
}

const rnd = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function makeTask(a, b, op, e, result) {
  return { a, b, op, e, result, text: `${a} × ${b} ${op === '-' ? '−' : '+'} ${e}` };
}

/**
 * Erzeugt eine neue „Kugel“ nach dem Algorithmus aus mathe_bingo_gui.py:
 * a ∈ 1..10, b ∈ 1..100, z = a·b.
 *   z < 100  → a × b + e  mit 1 ≤ e ≤ 100 − z
 *   z ≥ 100  → a × b − e  mit z − 100 ≤ e ≤ z − 1
 * Damit nie eine Sackgasse entsteht, wird zuerst ein noch freies Ergebnis gewählt
 * und dann passende a, b, e gesucht.
 * @param {Set<number>} used bereits gezogene Ergebnisse
 * @returns {null | {a,b,op,e,result,text}}
 */
export function generateTask(used) {
  const free = [];
  for (let n = MIN; n <= MAX; n++) if (!used.has(n)) free.push(n);
  if (!free.length) return null;
  const target = free[rnd(0, free.length - 1)];

  for (let i = 0; i < 10000; i++) {
    const a = rnd(1, 10);
    const b = rnd(1, 100);
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

/**
 * Prüft die Karte auf Gültigkeit.
 * @param {(number|null)[]} card 25 Felder, Index 12 wird ignoriert
 * @returns {{ok:boolean, errors:(null|'empty'|'range'|'dup')[], filled:number}}
 */
export function validateCard(card) {
  const errors = Array(CELLS).fill(null);
  if (!Array.isArray(card) || card.length !== CELLS) {
    return { ok: false, errors: errors.map((_, i) => (i === FREE ? null : 'empty')), filled: 0 };
  }
  const seen = new Map();
  let filled = 0;
  card.forEach((v, i) => {
    if (i === FREE) return;
    if (v === null || v === undefined || v === '') { errors[i] = 'empty'; return; }
    if (!Number.isInteger(v) || v < MIN || v > MAX) { errors[i] = 'range'; return; }
    filled++;
    if (seen.has(v)) { errors[i] = 'dup'; errors[seen.get(v)] = 'dup'; } else seen.set(v, i);
  });
  return { ok: errors.every((e) => e === null), errors, filled };
}

/** Füllt leere oder fehlerhafte Felder mit zufälligen, noch nicht benutzten Zahlen. */
export function randomFill(card) {
  const out = card.slice();
  const { errors } = validateCard(out);
  const keep = new Set();
  out.forEach((v, i) => { if (i !== FREE && errors[i] === null) keep.add(v); });
  // Bei Duplikaten bleibt das erste Vorkommen stehen
  const seen = new Set();
  out.forEach((v, i) => {
    if (i === FREE) return;
    if (errors[i] === 'dup' && !seen.has(v)) { seen.add(v); keep.add(v); errors[i] = null; }
  });
  const pool = [];
  for (let n = MIN; n <= MAX; n++) if (!keep.has(n)) pool.push(n);
  for (let i = 0; i < CELLS; i++) {
    if (i === FREE) { out[i] = null; continue; }
    if (errors[i] !== null) out[i] = pool.splice(rnd(0, pool.length - 1), 1)[0];
  }
  return out;
}

/** Linien, die vollständig markiert sind (ohne Prüfung, ob gezogen) – für den BINGO-Knopf. */
export function markedLines(marked) {
  const m = new Set(marked);
  return LINES.map((l, i) => (l.every((c) => c === FREE || m.has(c)) ? i : -1)).filter((i) => i >= 0);
}

/**
 * Prüft ein Bingo.
 * @param {(number|null)[]} card
 * @param {number[]} marked markierte Feld-Indizes
 * @param {Set<number>} drawn gezogene Ergebnisse, die für diesen Spieler zählen
 * @returns {{valid:boolean, lines:number[], wrong:number[]}}
 */
export function checkBingo(card, marked, drawn) {
  const m = new Set(marked.filter((i) => i !== FREE));
  const wrong = [...m].filter((i) => !drawn.has(card[i])).map((i) => card[i]).sort((a, b) => a - b);
  const lines = LINES.map((l, i) => (l.every((c) => c === FREE || (m.has(c) && drawn.has(card[c]))) ? i : -1))
    .filter((i) => i >= 0);
  return { valid: lines.length > 0, lines, wrong };
}
