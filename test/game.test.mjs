import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTask, evaluateTask, checkBingo, validateCard, randomFill, markedLines, rulesFor, normalizeSettings, lineLabel,
} from '../js/game.js';

const MODES = [
  [{ mode: 'mul', level: 'easy' }, { min: 1, max: 100, size: 5 }],
  [{ mode: 'mul', level: 'mid' }, { min: 1, max: 100, size: 5 }],
  [{ mode: 'mul', level: 'hard' }, { min: 1, max: 100, size: 5 }],
  [{ mode: 'add', range: 20, sub: false }, { min: 2, max: 20, size: 3 }],
  [{ mode: 'add', range: 20, sub: true }, { min: 1, max: 20, size: 3 }],
  [{ mode: 'add', range: 100, sub: false }, { min: 2, max: 100, size: 5 }],
  [{ mode: 'add', range: 100, sub: true }, { min: 1, max: 100, size: 5 }],
];

for (const [settings, expect] of MODES) {
  const rules = rulesFor(settings);
  test(`${rules.label}: Regeln und alle Kugeln genau einmal`, () => {
    assert.equal(rules.min, expect.min);
    assert.equal(rules.max, expect.max);
    assert.equal(rules.size, expect.size);
    assert.equal(rules.need, expect.size === 5 ? 24 : 9);
    let sawSub = false;
    let sawAdd = false;
    for (let run = 0; run < 15; run++) {
      const used = new Set();
      for (let i = 0; i < rules.total; i++) {
        const t = generateTask(used, rules);
        assert.ok(t, `Kugel ${i + 1} fehlt`);
        assert.ok(!used.has(t.result), 'Ergebnis doppelt');
        assert.ok(t.result >= rules.min && t.result <= rules.max);
        assert.equal(evaluateTask(t), t.result, t.text);
        assert.ok(t.a >= 1 && t.b >= 1, t.text);
        if (rules.mode === 'mul') {
          assert.ok(t.a <= rules.aMax && t.b <= rules.bMax, t.text);
          assert.ok(t.e >= 1, t.text);
          assert.equal(t.op, t.a * t.b < 100 ? '+' : '-', t.text);
        } else {
          assert.equal(t.e, null);
          assert.ok(t.a <= rules.max && t.b <= rules.max, t.text);
          if (t.op === '-') { sawSub = true; assert.ok(rules.sub, 'Minus obwohl nicht erlaubt'); } else sawAdd = true;
        }
        used.add(t.result);
      }
      assert.equal(generateTask(used, rules), null);
    }
    if (rules.mode === 'add') { assert.ok(sawAdd); assert.equal(sawSub, rules.sub); }
  });
}

test('normalizeSettings fängt Unsinn ab', () => {
  assert.deepEqual(normalizeSettings({ mode: 'x', level: 'y', range: 7, sub: 'ja' }), { mode: 'mul', level: 'mid', range: 100, sub: true });
  assert.deepEqual(normalizeSettings(null), { mode: 'mul', level: 'mid', range: 100, sub: false });
});

// ---------- 5×5 mit Freifeld ----------
const R5 = rulesFor({ mode: 'mul', level: 'mid' });
const card5 = Array.from({ length: 25 }, (_, i) => (i === 12 ? null : i + 1));

test('5×5: validateCard', () => {
  assert.ok(validateCard(card5, R5).ok);
  const dup = card5.slice(); dup[3] = 1;
  const r = validateCard(dup, R5);
  assert.equal(r.ok, false); assert.equal(r.errors[0], 'dup'); assert.equal(r.errors[3], 'dup');
  const range = card5.slice(); range[5] = 101;
  assert.equal(validateCard(range, R5).errors[5], 'range');
  const empty = card5.slice(); empty[7] = null;
  assert.equal(validateCard(empty, R5).errors[7], 'empty');
  assert.equal(validateCard([1, 2], R5).ok, false);
});

test('5×5: randomFill', () => {
  const part = Array(25).fill(null); part[0] = 42; part[1] = 42; part[2] = 500;
  const full = randomFill(part, R5);
  assert.ok(validateCard(full, R5).ok);
  assert.equal(full[0], 42);
  assert.equal(full[12], null);
});

test('5×5: checkBingo mit Freifeld', () => {
  const all = new Set(card5.filter((v) => v !== null));
  assert.deepEqual(checkBingo(card5, [0, 1, 2, 3, 4], all, R5).lines, [0]);
  assert.deepEqual(checkBingo(card5, [10, 11, 13, 14], all, R5).lines, [2]);
  assert.deepEqual(checkBingo(card5, [2, 7, 17, 22], all, R5).lines, [7]);
  assert.deepEqual(checkBingo(card5, [0, 6, 18, 24], all, R5).lines, [10]);
  assert.deepEqual(checkBingo(card5, [4, 8, 16, 20], all, R5).lines, [11]);
  assert.equal(checkBingo(card5, [0, 1, 2, 3], all, R5).valid, false);
  const r = checkBingo(card5, [0, 1, 2, 3, 4], new Set([1, 2, 3, 4]), R5);
  assert.equal(r.valid, false); assert.deepEqual(r.wrong, [5]);
  assert.deepEqual(markedLines([10, 11, 13, 14], R5), [2]);
});

// ---------- 3×3 ohne Freifeld ----------
const R3 = rulesFor({ mode: 'add', range: 20 });
const card3 = [2, 3, 4, 5, 6, 7, 8, 9, 10];

test('3×3: Linien und Beschriftung', () => {
  assert.equal(R3.lines.length, 8);
  assert.equal(R3.free, null);
  assert.deepEqual(R3.lines[6], [0, 4, 8]);
  assert.deepEqual(R3.lines[7], [2, 4, 6]);
  assert.equal(lineLabel(4, R3), 'Spalte 2');
});

test('3×3: validateCard und randomFill', () => {
  assert.ok(validateCard(card3, R3).ok);
  const bad = card3.slice(); bad[0] = 1; // 1 ist ohne Minus nicht möglich
  assert.equal(validateCard(bad, R3).errors[0], 'range');
  const bad2 = card3.slice(); bad2[1] = 21;
  assert.equal(validateCard(bad2, R3).errors[1], 'range');
  for (let i = 0; i < 50; i++) {
    const full = randomFill(Array(9).fill(null), R3);
    assert.ok(validateCard(full, R3).ok);
  }
});

test('3×3: checkBingo ohne Freifeld', () => {
  const all = new Set(card3);
  assert.deepEqual(checkBingo(card3, [0, 1, 2], all, R3).lines, [0]);
  assert.deepEqual(checkBingo(card3, [1, 4, 7], all, R3).lines, [4]);
  assert.deepEqual(checkBingo(card3, [2, 4, 6], all, R3).lines, [7]);
  assert.equal(checkBingo(card3, [0, 1], all, R3).valid, false);
  assert.equal(checkBingo(card3, [3, 5], all, R3).valid, false); // Mitte nicht frei
  assert.deepEqual(markedLines([0, 4, 8], R3), [6]);
  assert.deepEqual(markedLines([3, 5], R3), []);
});
