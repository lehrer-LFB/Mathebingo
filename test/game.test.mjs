import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTask, checkBingo, validateCard, randomFill, markedLines, FREE } from '../js/game.js';

const evalTask = (t) => (t.op === '+' ? t.a * t.b + t.e : t.a * t.b - t.e);

test('generateTask zieht alle 100 Ergebnisse genau einmal, Rechnungen stimmen', () => {
  for (let run = 0; run < 20; run++) {
    const used = new Set();
    for (let i = 0; i < 100; i++) {
      const t = generateTask(used);
      assert.ok(t, `Kugel ${i + 1} fehlt`);
      assert.ok(!used.has(t.result), 'Ergebnis doppelt');
      assert.equal(evalTask(t), t.result);
      assert.ok(t.a >= 1 && t.a <= 10 && t.b >= 1 && t.b <= 100 && t.e >= 1);
      const z = t.a * t.b;
      if (z < 100) assert.equal(t.op, '+'); else assert.equal(t.op, '-');
      used.add(t.result);
    }
    assert.equal(generateTask(used), null);
  }
});

const card = Array.from({ length: 25 }, (_, i) => (i === FREE ? null : i + 1));

test('validateCard', () => {
  assert.ok(validateCard(card).ok);
  const dup = card.slice(); dup[3] = 1;
  const r = validateCard(dup);
  assert.equal(r.ok, false); assert.equal(r.errors[0], 'dup'); assert.equal(r.errors[3], 'dup');
  const range = card.slice(); range[5] = 101;
  assert.equal(validateCard(range).errors[5], 'range');
  const empty = card.slice(); empty[7] = null;
  assert.equal(validateCard(empty).errors[7], 'empty');
  assert.equal(validateCard([1, 2]).ok, false);
});

test('randomFill ergibt gültige Karte und behält gültige Zahlen', () => {
  const part = Array(25).fill(null); part[0] = 42; part[1] = 42; part[2] = 500;
  const full = randomFill(part);
  assert.ok(validateCard(full).ok);
  assert.equal(full[0], 42);
  assert.equal(full[FREE], null);
});

test('checkBingo: Zeile, Spalte, Diagonale mit Freifeld', () => {
  const all = new Set(card.filter((v) => v !== null));
  assert.deepEqual(checkBingo(card, [0, 1, 2, 3, 4], all).lines, [0]);
  assert.deepEqual(checkBingo(card, [10, 11, 13, 14], all).lines, [2]); // mittlere Zeile mit Freifeld
  assert.deepEqual(checkBingo(card, [2, 7, 17, 22], all).lines, [7]); // mittlere Spalte
  assert.deepEqual(checkBingo(card, [0, 6, 18, 24], all).lines, [10]);
  assert.deepEqual(checkBingo(card, [4, 8, 16, 20], all).lines, [11]);
  assert.equal(checkBingo(card, [0, 1, 2, 3], all).valid, false);
});

test('checkBingo: markierte, aber nicht gezogene Zahl macht ungültig', () => {
  const drawn = new Set([1, 2, 3, 4]); // 5 fehlt
  const r = checkBingo(card, [0, 1, 2, 3, 4], drawn);
  assert.equal(r.valid, false);
  assert.deepEqual(r.wrong, [5]);
});

test('markedLines', () => {
  assert.deepEqual(markedLines([10, 11, 13, 14]), [2]);
  assert.deepEqual(markedLines([0, 1]), []);
});
