// The fair-count rule of level making (Work item 14nov, tools/traps.mjs): a crew member that looks
// ready and parks must look short, with no more than three quarters of what it carries showing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, settle } from '../js/logic.js';
import { readLines } from '../js/levels.js';
import { FAIR, inSight, unfairFronts, unfairMoments } from '../tools/traps.mjs';

// A 5 x 5 x 5 block: red on its eight corners and on the cubes of the middle that `inner` picks
// (x, y and z each 1 to 3), grey everywhere else. The corners show; the middle shows only once the
// grey around it is gone.
function block(inner) {
  const n = 5, cells = [];
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const corner = [x, y, z].every(v => v === 0 || v === n - 1);
    const middle = [x, y, z].every(v => v >= 1 && v <= n - 2);
    cells.push(corner || (middle && inner(x, y, z)) ? 1 : 2);
  }
  return { sx: n, sy: n, sz: n, cells, names: ['red', 'grey'], palette: [0xd23c3c, 0x9a9a9a] };
}
function boardOf(model, lines) {
  const st = makeBoard(model);
  st.slots = [null, null, null];
  st.columns = readLines({ name: 'Block', model: 'block', lines }, model, st.remaining);
  return settle(st);
}

test('a crew member that looks ready and parks with only a few cubes hidden is unfair; one that looks short is fair', () => {
  // Red on the corners and the one cube in the very middle: red 9 shows 8 and parks with 1.
  const one = block((x, y, z) => x === 2 && y === 2 && z === 2);
  const st = boardOf(one, ['red 9', 'grey 116']);
  assert.equal(inSight(st, 0), 8);
  assert.deepEqual(unfairFronts(st), [{ j: 0, color: 0, count: 9, shows: 8, left: 1 }]);
  // The grey carries 116 and shows the 90 of the outside, but the middle opens as the outside goes:
  // it finishes, so it is never unfair, however much of it shows.
  assert.ok(unfairFronts(st).every(u => u.j !== 1));

  // Red on the corners and the whole middle, 27 cubes: red 35 shows the same 8 and parks with 27.
  const many = block(() => true);
  const fair = boardOf(many, ['red 35', 'grey 90']);
  assert.equal(inSight(fair, 0), 8);
  assert.ok(8 <= FAIR * 35);
  assert.deepEqual(unfairFronts(fair), []);
});

test('unfair moments are counted along a winning order of sends, the right send included', () => {
  // Grey first opens the middle, so red finishes: no unfair moment once grey has gone. Before it,
  // red 9 is a front that looks ready and parks with 1, an unfair moment at the start.
  const one = block((x, y, z) => x === 2 && y === 2 && z === 2);
  const lines = ['red 9', 'grey 116'];
  assert.deepEqual(unfairMoments(boardOf(one, lines), [1, 0]).map(u => [u.k, u.j, u.left]), [[0, 0, 1]]);
  // Sent first, red 9 is the line's own send and parks the same: counted too.
  assert.deepEqual(unfairMoments(boardOf(one, lines), [0, 1]).map(u => [u.k, u.j, u.left]), [[0, 0, 1]]);
  // With the whole middle red, nothing is unfair along either order.
  const many = block(() => true);
  for (const line of [[1, 0], [0, 1]]) assert.deepEqual(unfairMoments(boardOf(many, ['red 35', 'grey 90']), line), []);
});
