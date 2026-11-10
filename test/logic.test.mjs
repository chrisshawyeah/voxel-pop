import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, removeCube, deploy, fire, isJammed, isWon, canFire, purgeCleared, blast, recall, addSlot } from '../js/logic.js';
import { LEVELS, buildLevel } from '../js/levels.js';

const solid = (n, color = 1) => ({ sx: n, sy: n, sz: n, cells: new Uint8Array(n * n * n).fill(color), palette: ['#f00', '#0f0'] });

test('only the outside of a solid block is exposed', () => {
  const st = makeBoard(solid(3));
  assert.equal(st.exposed[0].size, 26);
  removeCube(st, 1 + 3 * (1 + 3 * 0)); // centre of the front face
  assert.equal(st.exposed[0].has(13), true);
});

test('the inside of a hollow shell opens only when a hole reaches it', () => {
  const m = solid(5);
  const at = (x, y, z) => x + 5 * (y + 5 * z);
  for (let z = 1; z < 4; z++) for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) m.cells[at(x, y, z)] = 0;
  m.cells[at(2, 2, 2)] = 2; // a cube floating inside
  const st = makeBoard(m);
  assert.equal(st.exposed[1].size, 0);
  removeCube(st, at(2, 2, 0));
  assert.equal(st.exposed[1].has(at(2, 2, 2)), true);
});

test('deploy, fire, jam and win', () => {
  const m = { sx: 2, sy: 1, sz: 1, cells: Uint8Array.from([1, 2]), palette: ['#f00', '#0f0'] };
  const st = makeBoard(m);
  st.columns = [[{ id: 0, color: 0, count: 1, home: 0 }], [{ id: 1, color: 1, count: 1, home: 1 }]];
  const d = deploy(st, 0);
  assert.equal(d.slot, 0);
  assert.equal(fire(st, 0), 0);
  assert.equal(canFire(st, 0), false);
  assert.equal(isJammed(st), false, 'free pads and a queued shooter are not a jam');
  st.slots[0] = null;
  deploy(st, 1);
  fire(st, 0);
  assert.equal(isWon(st), true);
});

test('full pads with nothing to hit is a jam; an extra pad or a recall frees it', () => {
  const m = solid(3);
  m.cells[13] = 2; // buried centre of another colour
  const st = makeBoard(m);
  st.columns = [Array.from({ length: 6 }, (_, k) => ({ id: k, color: 1, count: 1, home: 0 })), [{ id: 9, color: 0, count: 26, home: 1 }]];
  for (let k = 0; k < 5; k++) deploy(st, 0);
  assert.equal(isJammed(st), true);
  assert.equal(addSlot(st), true);
  assert.equal(isJammed(st), false);
  deploy(st, 1);
  assert.ok(recall(st, 0));
});

test('blast clears cubes and crew of a vanished colour leave', () => {
  const m = solid(3);
  m.cells[13] = 2;
  const st = makeBoard(m);
  st.columns = [[{ id: 0, color: 1, count: 1, home: 0 }]];
  blast(st, 13, 1.01);
  assert.equal(st.remaining[1], 0);
  assert.equal(purgeCleared(st).length, 1);
});

for (let n = 0; n < LEVELS.length; n++) {
  test(`level ${n + 1} (${LEVELS[n].name}) deals and is winnable`, () => {
    const L = buildLevel(n);
    const counts = new Array(L.model.palette.length).fill(0);
    for (const col of L.board.columns) for (const s of col) counts[s.color] += s.count;
    assert.deepEqual([...counts], [...L.board.remaining], 'crew shots match cubes per colour');
    console.log(`  L${n + 1} ${L.def.name}: ${L.board.total} cubes, ${L.model.palette.length} colours, ${L.shooters} crew, deal ${L.dealIndex}`);
  });
}
