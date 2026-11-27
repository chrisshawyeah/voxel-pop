// The person test player (Work item 14nov, tools/players.mjs person): counts guessed about 15 percent
// off, and the order of the try before remembered, changed only at its mistake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard } from '../js/logic.js';
import { readLines, rng, buildLevel } from '../js/levels.js';
import { guessShows, person, COUNT_ERROR, TRY_CAP } from '../tools/players.mjs';

// The block of test/fair.test.mjs: 5 x 5 x 5, red on its eight corners and on the cubes of the middle
// that `inner` picks, grey everywhere else.
function block(inner) {
  const n = 5, cells = [];
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const corner = [x, y, z].every(v => v === 0 || v === n - 1);
    const middle = [x, y, z].every(v => v >= 1 && v <= n - 2);
    cells.push(corner || (middle && inner(x, y, z)) ? 1 : 2);
  }
  return { sx: n, sy: n, sz: n, cells, names: ['red', 'grey'], palette: [0xd23c3c, 0x9a9a9a] };
}
function boardOf(model, lines, pads) {
  const st = makeBoard(model);
  st.slots = Array(pads).fill(null);
  st.columns = readLines({ name: 'Block', model: 'block', lines }, model, st.remaining);
  return st;
}

test('a person guesses a count about 15 percent off, as often over as under', () => {
  const rand = rng(1);
  const g = Array.from({ length: 20000 }, () => guessShows(100, rand));
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  const sd = Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length);
  assert.ok(Math.abs(mean - 100) < 1, `mean ${mean}`);
  assert.ok(Math.abs(sd - 100 * COUNT_ERROR) < 1, `spread ${sd}`);
  assert.ok(g.filter(x => x > 100).length > 9500 && g.filter(x => x < 100).length > 9500);
  // A quarter short is seen as short almost always: 75 showing is guessed at 100 or more about 13 times
  // in 1000 (the guess must come out 2.2 spreads high).
  const fooled = Array.from({ length: 20000 }, () => guessShows(75, rand)).filter(x => x >= 100).length;
  assert.ok(fooled > 20000 * 0.005 && fooled < 20000 * 0.02, `fooled ${fooled} times`);
});

test('a person sends a crew member it guesses will finish before one that shows far too few', () => {
  // Red 35 shows only its 8 corners; grey 90 shows 90 and finishes. Every play sends grey first.
  const st = boardOf(block(() => true), ['red 35', 'grey 90'], 3);
  for (let s = 1; s <= 30; s++) {
    const r = person(st, rng(s));
    assert.equal(r.win, true);
    assert.equal(r.tries, 1);
    assert.equal(r.orders[0][0], 1, `seed ${s}`);
  }
});

test('a person who runs out of room tries again, keeps its order up to its mistake and changes only that', () => {
  // One pad. Red 9 shows 8 of its 9 (the ninth is the middle cube), grey 116 shows 90 of its 116: red
  // looks closer to finishing, so a person sends it first; it parks with 1 on the only pad, and that is
  // the mistake. The next try sends grey first, which opens the middle, then red finishes.
  const st = boardOf(block((x, y, z) => x === 2 && y === 2 && z === 2), ['red 9', 'grey 116'], 1);
  let twice = 0;
  for (let s = 1; s <= 30; s++) {
    const r = person(st, rng(s));
    assert.equal(r.win, true, `seed ${s}`);
    assert.ok(r.tries <= 2, `seed ${s}: ${r.tries} tries`);
    if (r.tries === 2) {
      twice++;
      assert.deepEqual(r.orders, [[0], [1, 0]], `seed ${s}`);
    } else assert.deepEqual(r.orders, [[1, 0]], `seed ${s}`);
  }
  assert.ok(twice >= 20, `${twice} of 30 plays sent red first`);
});

test('a person with no way to win plays its ten tries and counts as not winning', () => {
  // One pad and one line: red 9 must go first and parks with 1 on the only pad, so grey can never go.
  // A try sends red and runs out of room; the next has nothing else to send first, so the person
  // forgets what it blamed and the try after plays afresh, red again, until ten tries are spent.
  const st = boardOf(block((x, y, z) => x === 2 && y === 2 && z === 2), ['red 9, grey 116'], 1);
  const r = person(st, rng(1));
  assert.equal(r.win, false);
  assert.equal(r.tries, TRY_CAP);
  assert.deepEqual(r.orders, [[0], [], [0], [], [0], [], [0], [], [0], []]);
});

test('on the doughnut, which teaches, a person wins at the first try', () => {
  const st = buildLevel(0).board;
  for (let s = 1; s <= 5; s++) assert.equal(person(st, rng(s)).tries, 1);
});
