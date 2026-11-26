import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, step, settle, setView, isExposed, SEEK, START_PITCH, TURN } from '../js/logic.js';

// The few helpers these tests need, as test/logic.test.mjs has them.
const at = (m, x, y, z) => x + m.sx * (y + m.sy * z);
const crew = (id, color, count) => ({ id, color, count, hidden: false, home: 0 });
// A small grid from [x, y, z, colour] (colours from 1), every other cell empty.
const grid = (sx, sy, sz, cubes, palette = ['#f00', '#0f0', '#00f', '#ff0']) => {
  const cells = new Uint8Array(sx * sy * sz);
  for (const [x, y, z, c] of cubes) cells[x + sx * (y + sy * z)] = c;
  return { sx, sy, sz, cells, palette };
};
// test/logic.test.mjs's deep pit: a red block with an L-shaped pit eight deep around one column at
// corner (gx, gz) of the middle, and a green cube at the pit's bottom under that column. It shows
// only from high above.
const pit = (gx = 1, gz = 1) => {
  const cubes = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 9; y++) for (let z = 0; z < 5; z++) {
    if (y > 0 && x > 0 && x < 4 && z > 0 && z < 4 && !(x === gx && z === gz)) continue;
    cubes.push([x, y, z, x === gx && y === 1 && z === gz ? 2 : 1]);
  }
  return grid(5, 9, 5, cubes);
};

test('the camera that swings for crew who wait looks all round, ahead of the turn as well as behind it', () => {
  // The column, and the side of the pit the green cube opens onto, at each corner in turn.
  for (const [gx, gz] of [[1, 1], [3, 1], [1, 3], [3, 3]]) {
    const m = pit(gx, gz);
    const st = makeBoard(m);
    st.slots = [crew(0, 1, 1)];
    let shot = null;
    while (!shot && st.tick < 4 * SEEK) shot = step(st).shots[0];
    assert.ok(shot && shot.cell === at(m, gx, 1, gz) && st.tick === SEEK + 1, `corner (${gx}, ${gz}): green fired once the camera swung over the pit (${shot ? `tick ${st.tick}` : 'never'})`);
  }
});

test('crew who wait while the player holds the sculpture still get their swing once it turns again', () => {
  // Held from before SEEK ticks of waiting to after them, then let go.
  const m = pit(), green = at(m, 1, 1, 1);
  const st = makeBoard(m);
  st.slots = [crew(0, 1, 1)];
  let shot = null;
  while (!shot && st.tick < 4 * SEEK) {
    if (st.tick === SEEK - 20) setView(st, st.yaw, st.pitch, 0);
    if (st.tick === SEEK + 10) setView(st, st.yaw, st.pitch, TURN);
    shot = step(st).shots[0];
  }
  assert.ok(shot && shot.cell === green && st.tick === SEEK + 11, `green fired the moment the sculpture turned again (${shot ? `tick ${st.tick}` : 'never'})`);
  // A board left held still past SEEK, played out as a player who waits sees it (settle()).
  const b = makeBoard(m);
  b.slots = [crew(0, 1, 1)];
  setView(b, b.yaw, b.pitch, 0);
  while (b.tick < SEEK + 10) step(b);
  settle(b);
  assert.equal(b.slots[0], null, 'settled, green has fired its shot and left the pad');
});

test('a swing that finds nothing is not searched for again while the board and the crew waiting stay the same', () => {
  // A red block with a green cube whose top opens onto a crooked tunnel, two cells sideways and
  // then straight up and out: the green cube touches the open air, but no line from it gets out.
  const air = new Set(['2,2,2', '3,2,2', '4,2,2', '4,3,2', '4,4,2', '4,5,2']);
  const cubes = [];
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 5; z++) {
    if (!air.has(`${x},${y},${z}`)) cubes.push([x, y, z, x === 2 && y === 1 && z === 2 ? 2 : 1]);
  }
  const m = grid(6, 6, 5, cubes);
  const st = makeBoard(m);
  assert.equal(isExposed(st, at(m, 2, 1, 2)), true, 'the green cube touches the open air');
  st.slots = [crew(0, 1, 1)];
  // Every view the camera is placed at is counted: each one reads how far back it stands (st.camD).
  let looks = 0;
  const camD = st.camD;
  st.camD = new Proxy(camD, { get: (t, k) => { if (typeof k === 'string' && /^\d+$/.test(k)) looks++; return t[k]; }, set: (t, k, v) => { t[k] = v; return true; } });
  let shots = 0;
  while (st.tick < SEEK + 1) shots += step(st).shots.length;
  const searched = looks;
  assert.ok(searched > 1000, `the camera looked from ${searched} views for the green cube`);
  while (st.tick < SEEK + 200) shots += step(st).shots.length;
  assert.equal(shots, 0, 'green never fires at a cube no view shows');
  assert.ok(looks - searched < 100, `nothing changed, yet the camera looked from ${looks - searched} more views over the next 199 ticks`);
});

test('a view the player sets keeps its height: the height an earlier swing went to does not pull the camera back', () => {
  const m = pit();
  const st = makeBoard(m);
  st.slots = [crew(0, 1, 1), null];
  while (!step(st).shots.length);
  assert.ok(st.pitch > START_PITCH + 10, `the camera swung up over the pit (pitch ${st.pitch})`);
  // The player tilts the camera down and holds it there for a moment, then lets go; a red crew
  // member keeps firing meanwhile, so the camera has shots flying all along.
  const low = START_PITCH - 18;
  setView(st, st.yaw, low, 0);
  st.slots[1] = crew(1, 0, 200);
  for (let k = 0; k < 27; k++) step(st);
  setView(st, st.yaw, low, TURN);
  for (let k = 0; k < 60; k++) step(st);
  assert.ok(st.slots[1] && st.slots[1].count < 200, 'red kept firing');
  assert.equal(st.pitch, low, 'the camera stays at the height the player left it at');
});
