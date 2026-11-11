import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeBoard, cloneBoard, removeCube, deploy, fire, step, settle, launch, target, isJammed, isWon, canFire, canReach, purgeCleared, isExposed, freeSlot, FLIGHT, tickGame, advance, forecast, forecastKey, fates, busy, revealLone, checkOf, pace, Attempt, FAST } from '../js/logic.js';
import { LEVELS, buildLevel, dealLevel, levelPrint, rng } from '../js/levels.js';
import { plan, greedy, greedyCheck, hastyCheck, hastyGreedy, lineHolds, playLine, onClock, earlyParks, forecastFirst, backtrack, forecastCheck, hastyForecastCheck, backtrackCheck, firingTime, curveMisses, GAPS, LAND, GREEDY_PLAYS, PARK_MIN } from '../tools/players.mjs';

const at = (m, x, y, z) => x + m.sx * (y + m.sy * z);
const solid = (n, color = 1) => ({ sx: n, sy: n, sz: n, cells: new Uint8Array(n * n * n).fill(color), palette: ['#f00', '#0f0', '#00f'] });
// One stack of cubes, listed from the bottom up (0 = a gap).
const stack = (...colors) => ({ sx: 1, sy: colors.length, sz: 1, cells: Uint8Array.from(colors), palette: ['#f00', '#0f0', '#00f'] });
const crew = (id, color, count) => ({ id, color, count, hidden: false, home: 0 });

// A small grid from [x, y, z, colour] (colours from 1), every other cell empty.
const grid = (sx, sy, sz, cubes, palette = ['#f00', '#0f0', '#00f', '#ff0']) => {
  const cells = new Uint8Array(sx * sy * sz);
  for (const [x, y, z, c] of cubes) cells[x + sx * (y + sy * z)] = c;
  return { sx, sy, sz, cells, palette };
};
// A cube of colour `core` standing on the turntable in the middle of a 3 x 2 x 3 grid, with a cube
// of colour `lid` on top of it and one of colour `side` on each of its four sides: it can be hit
// only once one of those five has gone. The lid is the highest, so a crew of its colour takes it first.
const covered = (core, lid, side = lid) => grid(3, 2, 3, [[1, 0, 1, core], [1, 1, 1, lid], [0, 0, 1, side], [2, 0, 1, side], [1, 0, 0, side], [1, 0, 2, side]]);
const CORE = 1 + 3 * (0 + 2 * 1), LID = 1 + 3 * (1 + 2 * 1); // the core's and the lid's cells
// The lines whose front crew member has a cube of its colour to hit right now. Most levels keep
// colours hidden inside, and some open with no ready front at all, so a test that wants cubes to go
// sends one of these (the k-th, round and round), or else parks a front with a ready crew member
// behind it, or else the first front there is.
const canHit = (st, s) => !!s && st.exposed[s.color].size > 0;
const readyLines = st => st.columns.map((c, i) => i).filter(i => canHit(st, st.columns[i][0]));
const readyLine = (st, k = 0) => {
  const open = readyLines(st);
  if (open.length) return open[k % open.length];
  const behind = st.columns.findIndex(c => canHit(st, c[1]));
  return behind >= 0 ? behind : st.columns.findIndex(c => c.length);
};

test('a cube can be hit from any side while one of its faces touches the outside air', () => {
  const m = solid(3);
  const st = makeBoard(m);
  assert.equal(st.exposed[0].size, 25, 'every cube of a 3x3x3 block but the middle one and the one under it');
  assert.equal(isExposed(st, at(m, 1, 1, 1)), false, 'the middle is sealed in');
  assert.equal(isExposed(st, at(m, 1, 0, 1)), false, 'the bottom middle stands on the turntable: nothing is hit from below');
  assert.equal(isExposed(st, at(m, 0, 0, 0)), true, 'a bottom corner can be hit from the side');
  assert.equal(isExposed(st, at(m, 1, 1, 0)), true, 'the middle of a side, with cubes above and below it');
  removeCube(st, at(m, 1, 1, 0));
  assert.equal(st.exposed[0].has(at(m, 1, 1, 1)), true, 'taking a cube from the side opens the one behind it');
  assert.equal(isExposed(st, at(m, 1, 0, 1)), false, 'but not the one under that');
  removeCube(st, at(m, 1, 1, 1));
  assert.equal(st.exposed[0].has(at(m, 1, 0, 1)), true);
  assert.equal(st.exposed[0].size, 25);
});

test('a cube sealed inside cannot be hit, and can be the moment a cube beside it goes', () => {
  for (const [x, z] of [[0, 1], [2, 1], [1, 0], [1, 2]]) {
    const st = makeBoard(covered(2, 1));
    assert.equal(st.exposed[1].size, 0, 'green, sealed in by red, cannot be hit');
    assert.equal(st.exposed[0].size, 5, 'every red can');
    removeCube(st, x + 3 * 2 * z);
    assert.deepEqual([...st.exposed[1]], [CORE], `the side cube at ${x},${z} goes and green opens`);
  }
  const st = makeBoard(covered(2, 1));
  removeCube(st, LID);
  assert.deepEqual([...st.exposed[1]], [CORE], 'so it does when the lid goes');
});

test('air sealed inside a hollow does not open its walls until the hollow is opened', () => {
  // A 5x5x5 red block with an empty cell in the middle, walled in green on its six sides.
  const m = solid(5);
  const walls = [[1, 2, 2], [3, 2, 2], [2, 1, 2], [2, 3, 2], [2, 2, 1], [2, 2, 3]];
  for (const [x, y, z] of walls) m.cells[at(m, x, y, z)] = 2;
  m.cells[at(m, 2, 2, 2)] = 0;
  const st = makeBoard(m);
  assert.equal(st.exposed[1].size, 0, 'the walls touch only the sealed air');
  removeCube(st, at(m, 2, 4, 2));
  assert.deepEqual([...st.exposed[1]], [at(m, 2, 3, 2)], 'the top wall opens from above; the rest still face sealed air');
  removeCube(st, at(m, 2, 3, 2));
  assert.deepEqual([...st.exposed[1]].sort((a, b) => a - b), walls.filter(([, y]) => y !== 3).map(([x, y, z]) => at(m, x, y, z)).sort((a, b) => a - b), 'breaking in lets the air in: every wall left opens at once');
  assert.equal(isExposed(st, at(m, 2, 0, 2)), false, 'and not the cube under the floor');
  removeCube(st, at(m, 2, 1, 2));
  assert.equal(isExposed(st, at(m, 2, 0, 2)), true, 'until the floor goes');
});

test('a shot takes its cube when it leaves, and opens what is behind it only when it lands', () => {
  const st = makeBoard(covered(2, 1)); // green sealed in by five red
  st.slots = [crew(0, 0, 5), crew(1, 1, 1)];
  const first = step(st);
  assert.deepEqual(first.shots.map(s => s.cell), [LID], 'red fires at its highest cube, the lid; green has nothing yet');
  assert.equal(st.cells[LID], 1, 'the lid is still there while the shot flies');
  for (let t = 1; t < FLIGHT; t++) {
    const s = step(st);
    assert.ok(s.shots.every(x => x.slot === 0), `tick ${t + 1}: green waits, the lid is not hit yet`);
    assert.equal(st.exposed[1].size, 0);
    assert.equal(isJammed(st), false, 'a shot in the air is not a jam');
    assert.equal(isWon(st), false);
  }
  assert.equal(st.slots[0], null, 'red has sent all five shots and left');
  const land = step(st);
  assert.deepEqual(land.landed, [LID]);
  assert.deepEqual(land.shots.map(s => s.cell), [CORE], 'green opens when the lid lands, and fires the same tick');
  assert.equal(isWon(st), false, 'not won while the last shot is in the air');
  settle(st);
  assert.equal(isWon(st), true);
});

test('a crew member frees its pad the moment its last shot leaves', () => {
  const st = makeBoard({ sx: 2, sy: 1, sz: 1, cells: Uint8Array.from([1, 1]), palette: ['#f00'] });
  st.slots = [crew(0, 0, 2), null];
  st.columns = [[crew(1, 0, 0)]];
  assert.equal(step(st).shots.length, 1);
  assert.equal(st.slots[0].count, 1);
  const last = step(st).shots[0];
  assert.equal(last.freed, true);
  assert.equal(st.slots[0], null, 'pad free while both shots are still flying');
  assert.equal(st.flying.length, 2);
  assert.equal(deploy(st, 0).slot, 0, 'the next crew member lands on that pad at once');
  settle(st);
  assert.equal(isWon(st), true);
});

test('a crew member landing on its pad waits its ticks, and landing is not out of room', () => {
  const st = makeBoard(stack(1));
  st.slots = [null];
  st.columns = [[crew(0, 0, 1)]];
  deploy(st, 0, 3); // the game sends with a landing pause; the test players send with none
  assert.equal(canFire(st, 0), false, 'still landing');
  assert.equal(canReach(st, 0), true, 'but it has something to hit');
  assert.equal(isJammed(st), false, 'the only pad is full, yet landing is not a jam');
  assert.equal(step(st).shots.length, 0);
  assert.equal(step(st).shots.length, 0);
  assert.equal(step(st).shots.length, 1, 'the first shot leaves on the third tick');
  settle(st);
  assert.equal(isWon(st), true);
});

test('one targeting rule: the highest cube first, then the one farthest out, never the camera', () => {
  const m = solid(3);
  const st = makeBoard(m);
  assert.equal(target(st, 0), at(m, 0, 2, 0), 'a corner of the top layer');
  st.slots = [crew(0, 0, 27)];
  const order = [];
  while (st.slots[0] || st.flying.length) for (const s of step(st).shots) order.push(s.cell);
  const height = i => Math.floor(i / 3) % 3;
  assert.deepEqual(order.slice(0, 9).map(height), Array(9).fill(2), 'the whole top layer goes first');
  assert.deepEqual(order.slice(0, 4).map(i => i % 3 !== 1 && Math.floor(i / 9) !== 1), [true, true, true, true], 'its four corners before its middle');
  assert.equal(order[8], at(m, 1, 2, 1), 'the middle of the top layer last');
  assert.equal(isWon(st), true);
  // The same taps give the same board, and waiting longer before a tap changes nothing.
  const L = buildLevel(8);
  const a = cloneBoard(L.board), b = cloneBoard(L.board);
  for (let k = 0; k < 6; k++) {
    settle(a); settle(b); for (let t = 0; t < 7; t++) step(b);
    const ci = readyLine(a, k);
    deploy(a, ci); deploy(b, ci);
  }
  settle(a); settle(b);
  assert.ok(a.cleared > 0);
  assert.deepEqual([a.h1, a.h2, a.cleared], [b.h1, b.h2, b.cleared]);
  assert.deepEqual(a.cells, b.cells);
});

test('fire() is one shot that lands at once, through the same launch and land', () => {
  const st = makeBoard(covered(2, 1));
  st.slots = [crew(0, 0, 1)];
  assert.equal(fire(st, 0), LID);
  assert.equal(st.flying.length, 0);
  assert.equal(st.exposed[1].size, 1, 'the lid is gone, so green opens at once');
  assert.equal(launch(st, 0), null, 'a spent crew member has left');
});

test('full pads with nothing to hit is a jam', () => {
  const st = makeBoard(covered(2, 1)); // green sealed in by red
  st.columns = [Array.from({ length: 6 }, (_, k) => crew(k, 1, 1)), [crew(9, 0, 5)]];
  for (let k = 0; k < 4; k++) deploy(st, 0);
  settle(st);
  assert.equal(isJammed(st), false, 'one pad is still free');
  deploy(st, 0);
  settle(st);
  assert.equal(isJammed(st), true);
});

test('crew of a vanished colour leave', () => {
  const st = makeBoard(stack(2, 1));
  st.columns = [[crew(0, 1, 1)]];
  st.slots[0] = crew(1, 1, 3);
  removeCube(st, 1);
  removeCube(st, 0); // the only cube of the second colour
  assert.equal(st.remaining[1], 0);
  assert.equal(purgeCleared(st).length, 2);
  assert.equal(st.slots[0], null);
  assert.equal(canFire(st, 0), false);
});

test('a level is dealt once and handed out fresh', () => {
  const a = buildLevel(3), b = buildLevel(3);
  assert.notEqual(a.board, b.board);
  assert.deepEqual(a.board.columns, b.board.columns);
  deploy(a.board, 0); settle(a.board);
  assert.deepEqual(buildLevel(3).board.columns, b.board.columns, 'playing a copy leaves the kept level alone');
  assert.equal(buildLevel(3).board.cleared, 0);
  assert.deepEqual(dealLevel(LEVELS[3]).board.columns, b.board.columns, 'the stored deal is built directly from its settings');
});

test('the planning player treats a "?" as unknown until it reaches the front', () => {
  // Two cubes sealed in, each in the middle of a plus of cubes on the turntable with one more cube
  // on top, and one pad. The only winning order depends on what the two "?" are, so a player who
  // sees just the screen would have to guess: the planning player must refuse this deal, and wins
  // it once it may look.
  const plus = (x, [mid, top, left, right, front, back]) =>
    [[x + 1, 0, 1, mid], [x + 1, 1, 1, top], [x, 0, 1, left], [x + 2, 0, 1, right], [x + 1, 0, 0, front], [x + 1, 0, 2, back]];
  const m = grid(7, 2, 3, [...plus(0, [4, 3, 1, 3, 4, 1]), ...plus(4, [4, 2, 3, 2, 2, 1])]);
  const deal = hidden => {
    const st = makeBoard(m);
    st.slots = [null];
    const line = (col, ...cs) => cs.map(([color, count, h], k) => ({ ...crew(10 * col + k, color, count), hidden: hidden && !!h }));
    st.columns = [line(0, [2, 1], [1, 3, 1]), line(1, [3, 3], [0, 2], [0, 1, 1], [2, 2])];
    return st;
  };
  const seen = plan(deal(false));
  assert.equal(seen.win, true);
  assert.deepEqual(seen.line, [0, 0, 1, 1, 1, 1]);
  assert.equal(plan(deal(true)).win, false);
});

// The front of line ci sent now with the game's landing pause, and nothing sent after it, played
// through the game's own send (Attempt) and tick until nothing moves: what really happens to that
// crew member, and which crew already on a pad end up parked that would have finished without it.
function sendAndWatch(st, ci) {
  const without = cloneBoard(st);
  const onPads = without.slots.filter(Boolean);
  settle(without);
  const finished = new Set(onPads.filter(x => !without.slots.includes(x)).map(x => x.id));
  const a = new Attempt(cloneBoard(st));
  const d = a.send(ci, LAND);
  if (!d) return null;
  const id = d.shooter.id;
  const others = a.board.slots.filter(x => x && x.id !== id);
  let mine = null;
  for (;;) {
    const s = a.board.slots.find(x => x && x.id === id);
    if (!mine && !s) mine = { finishes: true, left: 0 };
    if (!busy(a.board)) { mine = mine || { finishes: false, left: s.count }; break; }
    tickGame(a.board);
  }
  mine.strands = others.filter(x => finished.has(x.id) && a.board.slots.includes(x)).map(x => ({ id: x.id, color: x.color, left: x.count }));
  return mine;
}

test('undo takes back the last send: cubes, lines, pads, shots in the air and the clock', () => {
  const L = buildLevel(7);
  const a = new Attempt(L.board);
  assert.equal(a.canUndo, false, 'nothing to undo at the start');
  const before = [];
  for (let k = 0; k < 5; k++) {
    for (let t = 0; t < 12; t++) tickGame(a.board); // sends overlap: shots are in the air
    before.push(cloneBoard(a.board));
    assert.ok(a.send(readyLine(a.board, k), LAND));
  }
  for (let t = 0; t < 40; t++) tickGame(a.board);
  assert.ok(a.board.flying.length || a.board.cleared, 'the board moved on after the last send');
  for (let k = before.length - 1; k >= 0; k--) {
    assert.equal(a.undo(), true);
    const b = before[k];
    assert.deepEqual([a.board.tick, a.board.cleared, a.board.h1, a.board.h2], [b.tick, b.cleared, b.h1, b.h2]);
    assert.deepEqual(a.board.cells, b.cells);
    assert.deepEqual(a.board.columns, b.columns, 'the crew back at the front of its line');
    assert.deepEqual(a.board.slots, b.slots, 'the pads as they were');
    assert.deepEqual(a.board.flying, b.flying, 'the shots that were in the air');
    assert.deepEqual(a.board.exposed.map(s => [...s].sort()), b.exposed.map(s => [...s].sort()));
    assert.deepEqual(a.board.out, b.out, 'the outside air as it was');
  }
  assert.equal(a.canUndo, false);
  assert.equal(a.undo(), false);
  assert.deepEqual(a.board.columns, buildLevel(7).board.columns, 'back to the start of the level');
});

// The cubes that can be hit, worked out from scratch from the cubes left: every cube with a face on
// the outside air, less those a shot in the air has taken. The board keeps this up to date cube by
// cube as they go (js/logic.js letAirIn); it must always come out the same.
function hittable(b) {
  const fresh = makeBoard({ sx: b.sx, sy: b.sy, sz: b.sz, cells: b.cells, palette: b.palette });
  const taken = new Set(b.flying.map(f => f.cell));
  return fresh.exposed.map(set => [...set].filter(i => !taken.has(i)).sort((x, y) => x - y));
}
const hitList = b => b.exposed.map(set => [...set].sort((x, y) => x - y));

test('Robot: the legs and feet under its body can be hit from the start', () => {
  const n = LEVELS.findIndex(d => d.model === 'robot');
  const L = buildLevel(n);
  const m = L.model, st = L.board;
  const grey = m.names.indexOf('grey'), charcoal = m.names.indexOf('charcoal');
  const y = i => Math.floor(i / m.sx) % m.sy;
  const of = (c, y0, y1) => [...m.cells.keys()].filter(i => m.cells[i] === c + 1 && y(i) >= y0 && y(i) <= y1);
  const legs = of(grey, 2, 5), feet = of(charcoal, 0, 1);
  const legsOpen = legs.filter(i => st.exposed[grey].has(i)), feetOpen = feet.filter(i => st.exposed[charcoal].has(i));
  console.log(`  Robot at the start: ${legsOpen.length} of ${legs.length} leg cubes and ${feetOpen.length} of ${feet.length} foot cubes can be hit`);
  // The middle of each leg and foot is circuits now (js/models.js), so every grey leg cube and
  // every charcoal foot cube left has a face on the air.
  assert.equal(legs.length, 96);
  assert.equal(legsOpen.length, 96, 'every grey leg cube');
  assert.equal(feet.length, 72);
  assert.equal(feetOpen.length, 72, 'every charcoal foot cube');
  const underBody = legsOpen.filter(i => y(i) === 5 && m.cells[i + m.sx] && m.cells[i + m.sx] !== grey + 1);
  assert.ok(underBody.length >= 20, `${underBody.length} leg cubes with the body right on top of them can be hit`);
  // A grey crew member sent first, with as many shots as there are grey cubes, pops all of them, the
  // legs too, and leaves everything else standing: nothing above the legs had to go.
  const b = cloneBoard(st);
  b.columns = [[{ id: 99, color: grey, count: b.remaining[grey], hidden: false, home: 0 }]];
  const f = forecast(b, 0, LAND);
  assert.deepEqual(f, { finishes: true, left: 0, strands: [] }, 'the forecast says it finishes');
  assert.deepEqual(f, sendAndWatch(b, 0), 'and it does');
  const a = new Attempt(b);
  a.send(0, LAND);
  let firstLeg = -1;
  while (busy(a.board)) {
    const r = tickGame(a.board);
    if (firstLeg < 0 && r.landed.some(i => legs.includes(i))) firstLeg = a.board.cleared;
  }
  assert.ok(firstLeg > 0, 'a leg cube was hit');
  assert.equal(a.board.remaining[grey], 0, 'every grey cube, legs included');
  assert.equal(a.board.cleared, st.remaining[grey], 'and not one cube of another colour went');
});

test('undo, a saved attempt and every send give back exactly the cubes that can be hit', () => {
  for (const n of [LEVELS.findIndex(d => d.model === 'robot'), LEVELS.findIndex(d => d.model === 'castle')]) {
    const L = buildLevel(n);
    const a = new Attempt(cloneBoard(L.board));
    assert.deepEqual(hitList(a.board), hittable(a.board), `level ${n + 1} at the start`);
    const rand = rng(n + 40);
    const before = [];
    for (let k = 0; k < 8; k++) {
      for (let t = Math.floor(rand() * 40); t > 0; t--) tickGame(a.board);
      assert.deepEqual(hitList(a.board), hittable(a.board), `level ${n + 1}, tick ${a.board.tick}`);
      const was = hitList(a.board);
      if (a.send(readyLine(a.board, Math.floor(rand() * 5)), LAND)) before.push(was);
    }
    for (let t = 0; t < 300; t++) tickGame(a.board);
    assert.ok(a.board.cleared > 100, `level ${n + 1}: ${a.board.cleared} cubes gone`);
    assert.deepEqual(hitList(a.board), hittable(a.board));
    const now = hitList(a.board);
    const back = Attempt.restore(L.board, JSON.parse(JSON.stringify(a.save())), LAND);
    assert.deepEqual(hitList(back.board), now, 'a saved attempt comes back with the same cubes open');
    assert.deepEqual(back.board.out, a.board.out);
    while (a.canUndo) {
      a.undo();
      assert.deepEqual(hitList(a.board), before.pop(), `level ${n + 1}: undo gives back the cubes open before the send`);
      assert.deepEqual(hitList(a.board), hittable(a.board));
    }
  }
});

test('an attempt comes back from its sends alone, undo stack and all', () => {
  const L = buildLevel(18);
  const a = new Attempt(cloneBoard(L.board));
  const rand = rng(4);
  let after = null; // the board just after the last send
  for (let k = 0; k < 6; k++) {
    const gap = Math.floor(rand() * 30);
    for (let t = 0; t < gap; t++) tickGame(a.board);
    const lines = a.board.columns.map((c, i) => i).filter(i => a.board.columns[i].length);
    if (a.send(lines[Math.floor(rand() * lines.length)], LAND)) after = cloneBoard(a.board);
  }
  assert.ok(a.sends.length >= 3);
  const back = Attempt.replay(L.board, JSON.parse(JSON.stringify(a.sends)), LAND);
  assert.ok(back);
  assert.deepEqual(back.sends, a.sends);
  assert.deepEqual([back.board.tick, back.board.h1, back.board.h2], [after.tick, after.h1, after.h2]);
  assert.deepEqual(back.board.columns, after.columns);
  assert.deepEqual(back.board.slots, after.slots);
  assert.deepEqual(back.board.flying, after.flying);
  assert.equal(back.before.length, a.before.length);
  back.undo(); a.undo();
  assert.deepEqual([back.board.tick, back.board.h1, back.board.columns], [a.board.tick, a.board.h1, a.board.columns]);
  assert.equal(Attempt.replay(L.board, [[0, 5], [1, 2]], LAND), null, 'sends out of order do not fit');
  assert.equal(Attempt.replay(L.board, [['x', 1]], LAND), null, 'nor does a broken save');
  // A quiet board skips the clock ahead in one go and comes out the same as ticking.
  const q = cloneBoard(L.board), r = cloneBoard(L.board);
  advance(q, 500);
  for (let t = 0; t < 500; t++) tickGame(r);
  assert.deepEqual([q.tick, q.h1, q.cleared], [r.tick, r.h1, r.cleared]);
});

test('undos are counted, never lowered by undoing, and a save brings back the board as it was left', () => {
  const L = buildLevel(7);
  const a = new Attempt(cloneBoard(L.board));
  const t = n => { for (let k = 0; k < n; k++) tickGame(a.board); };
  const send = () => a.send(readyLine(a.board), LAND);
  send(); t(12);
  send(); t(7);
  assert.equal(a.undos, 0);
  a.undo();
  assert.equal(a.undos, 1, 'one undo');
  const afterUndo = cloneBoard(a.board);
  const back0 = Attempt.restore(L.board, JSON.parse(JSON.stringify(a.save())), LAND);
  assert.ok(back0, 'a save made just after an undo restores');
  assert.deepEqual(checkOf(back0.board), checkOf(afterUndo), 'to the board the undo gave back, not to just after the last send');
  assert.deepEqual(back0.board.slots, afterUndo.slots);
  assert.deepEqual(back0.board.flying, afterUndo.flying);
  send(); t(5); send(); t(40);
  assert.ok(a.board.cleared > 0 && a.board.tick > a.sends[a.sends.length - 1][1] + 30, 'the board moved well past the last send');
  const left = cloneBoard(a.board);
  const back = Attempt.restore(L.board, JSON.parse(JSON.stringify(a.save())), LAND);
  assert.ok(back);
  assert.equal(back.undos, 1, 'the undo count comes back');
  assert.deepEqual(back.sends, a.sends);
  assert.deepEqual(checkOf(back.board), checkOf(left), 'the board as it was when it was left');
  assert.deepEqual(back.board.cells, left.cells);
  assert.deepEqual(back.board.columns, left.columns);
  assert.deepEqual(back.board.slots, left.slots);
  assert.deepEqual(back.board.flying, left.flying, 'shots in the air too');
  back.undo(); a.undo();
  assert.equal(back.undos, 2, 'undoing after a restore counts on from the saved count');
  assert.deepEqual(checkOf(back.board), checkOf(a.board), 'and takes back the same send');
  // Every undo, back to the start: the count stays and is saved even with no sends left.
  while (back.canUndo) back.undo();
  assert.equal(back.sends.length, 0);
  assert.equal(Attempt.restore(L.board, back.save(), LAND).undos, back.undos);
});

test('a broken or changed save is turned down quickly, never played and never hung on', () => {
  const L = buildLevel(0);
  const a = new Attempt(cloneBoard(L.board));
  a.send(0, LAND);
  for (let k = 0; k < 30; k++) tickGame(a.board);
  a.send(1, LAND);
  for (let k = 0; k < 30; k++) tickGame(a.board);
  const good = JSON.parse(JSON.stringify(a.save()));
  assert.ok(Attempt.restore(L.board, good, LAND));
  const big = 2 ** 53;
  const bad = {
    'nothing': null, 'a number': 7, 'no sends': { ...good, sends: undefined }, 'sends not a list': { ...good, sends: 'x' },
    'checks short': { ...good, checks: good.checks.slice(1) }, 'a changed check': { ...good, checks: [good.checks[0], [1, 2, 3, 4]] },
    'a changed last board': { ...good, end: [good.end[0], good.end[1] + 1, good.end[2], good.end[3]] },
    'ticks near 2^53': { ...good, sends: [[0, big], [1, big + 2]], at: big + 2 },
    'a tick past the bound': { ...good, sends: [[0, 1e7 + 1]] }, 'at past the bound': { ...good, at: 1e9 },
    'at before the last send': { ...good, at: 1 }, 'a fraction': { ...good, sends: [[0, 0.5], good.sends[1]] },
    'a line that is not there': { ...good, sends: [[9, 0], good.sends[1]] }, 'a negative line': { ...good, sends: [[-1, 0], good.sends[1]] },
    'undos below 0': { ...good, undos: -1 }, 'undos a fraction': { ...good, undos: 0.5 }, 'undos a string': { ...good, undos: '0' },
    'a send of three numbers': { ...good, sends: [[0, 0, 1], good.sends[1]] },
  };
  const t0 = Date.now();
  for (const [what, save] of Object.entries(bad)) assert.equal(Attempt.restore(L.board, save, LAND), null, what);
  assert.ok(Date.now() - t0 < 2000, 'turned down at once');
  assert.equal(Attempt.replay(L.board, null), null, 'replay of no list is null, not a throw');
  assert.equal(Attempt.replay(L.board, { length: 2 }), null);
});

test('a level\'s fingerprint is its own and stays the same', () => {
  const prints = LEVELS.map((_, n) => levelPrint(n));
  assert.equal(new Set(prints).size, LEVELS.length, 'every level has its own');
  assert.equal(levelPrint(4), prints[4], 'and the same one each time');
});

test('the shot the screen draws is the rules\' own record of it', () => {
  const st = makeBoard(stack(2, 1));
  st.slots = [crew(0, 0, 1)];
  const [shot] = step(st).shots;
  assert.equal(shot.flight, st.flying[0], 'the same object as in st.flying');
  assert.deepEqual({ ...shot.flight }, { cell: 1, at: st.tick + FLIGHT, from: st.tick, slot: 0, color: 0, id: 0 });
});

test('a "?" stays a "?" only while there is more than one crew it could be', () => {
  const st = makeBoard(stack(2, 1, 1));
  st.slots = [null, null];
  const h = (id, color, count) => ({ ...crew(id, color, count), hidden: true });
  st.columns = [[crew(0, 0, 1), h(1, 0, 1), crew(2, 1, 1)], [crew(3, 1, 1), h(4, 1, 1)]];
  assert.deepEqual(revealLone(st), [], 'two different crew hidden: both stay "?"');
  const d = deploy(st, 0);
  assert.equal(d.revealed.id, 1, 'the "?" now at the front shows itself');
  assert.deepEqual(d.lone.map(s => s.id), [4], 'and the one left hidden is no guess any more');
  assert.equal(st.columns[1][1].hidden, false);
  // Two hidden crew that are the same are shown at once; a dealt level with one "?" has none.
  const same = makeBoard(stack(1, 1));
  same.columns = [[crew(0, 0, 1), h(1, 0, 1)], [crew(2, 0, 1), h(3, 0, 1)]];
  assert.equal(revealLone(same).length, 2);
  for (let n = 0; n < LEVELS.length; n++) {
    if (LEVELS[n].hidden !== 1) continue;
    const L = buildLevel(n);
    assert.equal(L.hidden, 1);
    assert.equal(L.board.columns.flat().filter(s => s.hidden).length, 0, `level ${n + 1}: its one hidden crew member is shown`);
  }
});

test('the forecast says which crew on the pads a send strands, before it is sent', () => {
  // Two red cubes open at two corners and a third sealed in under five green. Red 2 sent with nobody
  // after it finishes; red 1 sent just after it also finishes, but the two then share the open cubes
  // and red 2 is left with one: the forecast for red 1 says so before the send ("finishes; strands
  // red 1"), and red 2's pad shows it once red 1 has gone.
  const st = makeBoard(grid(3, 2, 3, [[1, 0, 1, 1], [1, 1, 1, 2], [0, 0, 1, 2], [2, 0, 1, 2], [1, 0, 0, 2], [1, 0, 2, 2], [0, 0, 0, 1], [2, 0, 2, 1]]));
  st.slots = [null, null, null];
  st.columns = [[crew(0, 0, 2)], [crew(1, 0, 1)], [crew(2, 1, 5)]];
  assert.deepEqual(forecast(st, 0, LAND), { finishes: true, left: 0, strands: [] });
  deploy(st, 0, LAND);
  assert.deepEqual([...fates(st)], [[0, 0]], 'red 2 finishes if no more crew are sent');
  const f = forecast(st, 1, LAND);
  assert.deepEqual(f, { finishes: true, left: 0, strands: [{ id: 0, color: 0, left: 1 }] }, 'red 1 finishes, but strands red 2 with 1');
  assert.deepEqual(f, sendAndWatch(st, 1), 'and that is what happens');
  assert.deepEqual(forecast(st, 1, LAND, fates(st)), f, 'the same with the pads\' fates handed in');
  assert.notEqual(forecastKey(f), 'done', 'a send that strands someone is not shown as a clean tick');
  assert.deepEqual(forecast(st, 2, LAND), { finishes: true, left: 0, strands: [] }, 'green finishes and strands nobody: it opens the third red');
  deploy(st, 1, LAND);
  assert.deepEqual([...fates(st)], [[0, 1], [1, 0]], 'now red 2 parks with 1');
  settle(st);
  assert.equal(st.slots[0].count, 1, 'and so it does');
});

test('the forecast follows the clock while a shot is only flying', () => {
  // Two red cubes sealed in: the first under a green lid, the second under blue, with blue all round
  // both. Green 1 on pad 3 fires at once; its shot opens the first red when it lands, at tick 10. Red 1
  // sleeps on pad 2 waiting for it. Another red 1 sent to pad 1 by tick 5 has landed by then and fires
  // first (pad 1 goes first): it finishes, and the sleeper, which would have taken that cube, is
  // stranded (the other red waits on blue, whose crew waits in a line). Sent from tick 6, it lands too
  // late and parks. Between, no shot leaves or lands and nobody lands: only the clock tells the two
  // forecasts apart.
  const blue = [[0, 0, 1], [2, 0, 1], [1, 0, 0], [1, 0, 2], [0, 0, 3], [2, 0, 3], [1, 0, 4], [1, 1, 3]].map(([x, y, z]) => [x, y, z, 3]);
  const st = makeBoard(grid(3, 2, 5, [[1, 0, 1, 1], [1, 1, 1, 2], [1, 0, 3, 1], ...blue]));
  st.slots = [null, crew(10, 0, 1), crew(11, 1, 1)];
  st.columns = [[crew(0, 0, 1)], [crew(1, 2, 8)]];
  const seen = [];
  for (let t = 0; t <= 9; t++) {
    const f = forecast(st, 0, LAND);
    assert.deepEqual(f, sendAndWatch(st, 0), `tick ${st.tick}`);
    seen.push(f.finishes ? `finishes, strands ${f.strands.map(s => s.id)}` : `parks ${f.left}`);
    const r = tickGame(st);
    if (t >= 1 && t <= 8) assert.equal(r.shots.length + r.landed.length, 0, `tick ${st.tick}: nothing leaves or lands`);
  }
  assert.deepEqual(seen, [...Array(6).fill('finishes, strands 10'), ...Array(4).fill('parks 1')]);
});

test('the hasty greedy player loses what the waiting one wins, but only when it rushes', () => {
  // One red cube open at a corner, and two red cubes side by side sealed in under eight green. Red 2,
  // red 1 and green 8, two pads. The crew sent first lands and fires at the one open red on tick 5.
  // A tap on the other red before that (33 ms later, or 150 ms later, which falls between ticks four
  // and five) sends it while that red still looks open: if red 2 went first, it then sleeps with 1
  // left and red 1 with 1, and green cannot go up when both pads hold a sleeper (if red 1 went first
  // it finishes and frees its pad; if green went first or second, it opens the reds). 200 ms apart,
  // the first shot has already taken the open red, so only green looks ready.
  const green = [[1, 1, 1], [2, 1, 1], [0, 0, 1], [3, 0, 1], [1, 0, 0], [2, 0, 0], [1, 0, 2], [2, 0, 2]].map(([x, y, z]) => [x, y, z, 2]);
  const st = makeBoard(grid(4, 2, 3, [[0, 0, 0, 1], [1, 0, 1, 1], [2, 0, 1, 1], ...green]));
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 2)], [crew(1, 0, 1)], [crew(2, 1, 8)]];
  // Red 2, then red 1 150 ms later: sent on ticks 0 and 4, before red 2's first shot; out of room at tick 14.
  const line = [0, 1, 2], at = [];
  const lost = onClock(st, 150, b => (at.length < line.length ? line[at.push(b.tick) - 1] : -1));
  assert.deepEqual(at, [0, 4], 'the second tap lands between ticks four and five');
  assert.deepEqual([lost.win, lost.ticks], [false, 14]);
  assert.equal(playLine(st, [0, 1, 2], 150), false);
  const rate = (gap, plays = 300) => { const r = rng(5); let w = 0; for (let k = 0; k < plays; k++) w += hastyGreedy(st, r, gap); return (100 * w) / plays; };
  for (const gap of [33, 150]) {
    const r = rate(gap);
    assert.ok(r > 70 && r < 95, `${gap} ms apart it loses about one play in six (red 2, then red 1), not ${100 - r}%`);
  }
  assert.equal(rate(200), 100, '200 ms apart it always wins');
  const g = rng(6);
  for (let k = 0; k < 50; k++) assert.equal(greedy(st, g), true, 'waiting always wins');
});

test('the speed-up: 3x only while nothing can be sent, 1x while a crew member lands or a finger is down', () => {
  const st = makeBoard(stack(1, 1, 1));
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 1), crew(1, 0, 1)], [crew(2, 0, 1)]];
  assert.equal(pace(st), 1, 'a pad free: normal speed however long the player thinks');
  assert.equal(pace(st, true), 1);
  deploy(st, 0, LAND);
  assert.equal(pace(st), 1, 'never faster while a crew member is landing');
  for (let t = 0; t < LAND; t++) tickGame(st);
  assert.equal(pace(st), 1, 'landed, and a pad still free');
  st.slots = [crew(5, 0, 1), crew(6, 0, 1)];
  assert.equal(pace(st), FAST, 'every pad taken: nothing to send');
  assert.equal(pace(st, true), 1, 'but 1x while a finger is down');
  st.slots = [null, null];
  st.columns = [[], []];
  assert.equal(pace(st), FAST, 'every line empty: nothing to send');
  assert.equal(pace(st, true), 1, 'but 1x while a finger is down');
  assert.match(readFileSync(new URL('../js/main.js', import.meta.url), 'utf8'), /speed = R\.pace\(st, pressed\.size > 0\);/, 'the game asks the same function, with its fingers down');
});

test('the timed test players keep the game\'s clock', () => {
  // Sixty red cubes in one stack, three red crew of 20 in one line, three pads, a tap every 600 ms.
  // The first goes at tick 0. With a pad free and crew in the line the board runs at 1x however
  // long the player waits, so the next tap's 600 ms are 18 ticks; once the line is empty, 3x.
  const st = makeBoard({ sx: 1, sy: 60, sz: 1, cells: new Uint8Array(60).fill(1), palette: ['#f00'] });
  st.slots = [null, null, null];
  st.columns = [[crew(0, 0, 20), crew(1, 0, 20), crew(2, 0, 20)]];
  const at = [];
  const r = onClock(st, 600, b => { if (!b.columns[0].length) return -1; at.push(b.tick); return 0; });
  assert.equal(r.win, true);
  assert.deepEqual(at, [0, 18, 36]);
  assert.ok(r.seconds < r.ticks / 30 && r.seconds > r.ticks / 90, `${r.ticks} ticks in ${r.seconds} s: some at 3x, not all`);
  assert.equal(firingTime(st, [0, 0, 0]), onClock(st, 0, b => (b.columns[0].length ? 0 : -1)).seconds, 'firingTime is the same clock');
  // 150 ms apart (the hasty players) is 4.5 ticks. A tap lands at its real time, between ticks when
  // that is when it falls: the second send goes between ticks four and five, while the first crew
  // member is still landing. The tick under way keeps the half already run, so the third send comes
  // just after tick nine (27 ninetieths of a second), not after tick ten.
  const sends = [];
  const four = cloneBoard(st);
  four.slots = [null, null, null, null];
  onClock(four, 150, b => { if (!b.columns[0].length) return -1; sends.push(b.tick); return 0; });
  assert.deepEqual(sends, [0, 4, 9]);
});

// One top-level function or one-line const of js/main.js, as written there (the file as a whole
// needs a page and three.js to run).
const mainSrc = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
function mainPart(name) {
  const at = mainSrc.search(new RegExp(`^(function ${name}\\(|const ${name} = )`, 'm'));
  assert.ok(at >= 0, `js/main.js has ${name}`);
  return mainSrc.startsWith('const', at) ? mainSrc.slice(at, mainSrc.indexOf('\n', at)) : mainSrc.slice(at, mainSrc.indexOf('\n}\n', at) + 2);
}

test('the hold lesson is learned only from a forecast really shown', () => {
  // inspect() and realPreview() from js/main.js, run on a stand-in for the page. A touch held on a
  // front (hold) or a mouse or keyboard on it for 300 ms (the timer) teaches the hold only with the
  // page in view, a level being played and a free pad: a preview that said "no free pad" does not.
  const page = ({ state = 'play', free = true }) => new Function('env', `
    const state = ${JSON.stringify(state)}, HOLD = 8, HOLD_MS = 300, st = {};
    let taught = 0, inspecting = -1, seenTimer = 0;
    const document = { get visibilityState() { return env.hidden ? 'hidden' : 'visible'; } };
    const forecastFor = () => (${free} ? { finishes: true, left: 0, strands: [] } : null);
    const learnHold = () => { env.learned++; taught |= HOLD; };
    const showReach = () => {};
    const timers = [];
    const setTimeout = fn => timers.push(fn);
    const clearTimeout = k => { if (k) timers[k - 1] = null; };
    ${mainPart('realPreview')}
    ${mainPart('inspect')}
    env.later = () => timers.splice(0).forEach(fn => fn && fn());
    return inspect;
  `);
  const learned = (setup, act) => { const env = { learned: 0, hidden: false }; act(page(setup)(env), env); return env.learned; };
  assert.equal(learned({}, inspect => inspect(0, true)), 1, 'a hold with a free pad teaches it');
  assert.equal(learned({ free: false }, inspect => inspect(0, true)), 0, 'a hold that showed "no free pad" does not');
  assert.equal(learned({ state: 'jam', free: false }, inspect => inspect(0, true)), 0, 'nor one while out of room');
  assert.equal(learned({}, (inspect, env) => { env.hidden = true; inspect(0, true); }), 0, 'nor one on a hidden page');
  assert.equal(learned({}, (inspect, env) => { inspect(0); env.later(); }), 1, 'a hover kept 300 ms with a free pad teaches it');
  assert.equal(learned({ free: false }, (inspect, env) => { inspect(0); env.later(); }), 0, 'a hover that showed "no free pad" does not');
  assert.equal(learned({}, (inspect, env) => { inspect(0); env.hidden = true; env.later(); }), 0, 'nor one whose 300 ms ran out on a hidden page');
  assert.equal(learned({}, (inspect, env) => { inspect(0); inspect(-1); env.later(); }), 0, 'nor one left before 300 ms');
});

test('the forecast in words wraps to fit a phone, under a short condition', () => {
  // A send can strand several crew ("parks 19; strands white 1; strands white 12; ..."): the tip
  // wraps and is never wider than the window less 6 px a side, so the script that keeps it inside
  // the window (showReach in js/main.js) always can.
  const css = readFileSync(new URL('../css/game.css', import.meta.url), 'utf8');
  const rule = sel => css.match(new RegExp(`^${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`, 'm'))[1];
  assert.match(rule('.tip'), /width: max-content;/);
  assert.match(rule('.tip'), /max-width: calc\(100vw - 12px\);/);
  assert.match(rule('.tip'), /white-space: normal;/);
  for (const sel of ['.tip', '.tip b', '.tip small']) assert.doesNotMatch(rule(sel), /nowrap/, `${sel} may wrap`);
  assert.match(mainSrc, /tip\.style\.marginLeft = `\$\{Math\.max\(0, 6 - r\.left\) - Math\.max\(0, r\.right - \(innerWidth - 6\)\)\}px`/, 'and is moved inside the window');
  assert.equal(mainPart('IF_NONE'), "const IF_NONE = 'with no more sends';");
});

test('the deal picker\'s list mode ends with what it listed, not with "no deal"', () => {
  const r = spawnSync(process.execPath, ['tools/pick-deals.mjs', '1', '--list', '--tries=1'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^L1 Toadstool: deal \d+ /m, 'it lists deals');
  assert.match(r.stdout.trim(), /^L1 Toadstool: \d+ deals? listed above/);
  assert.doesNotMatch(r.stdout, /no deal/);
});

test('the forecast follower wins less without undo than with it, and its undos are counted', () => {
  const n = LEVELS.findIndex((_, k) => k >= 8 && forecastCheck(buildLevel(k).board).rate < 60);
  assert.ok(n >= 0, 'some late level beats the mark follower more often than not');
  const L = buildLevel(n);
  const r = rng(9);
  let lost = 0, rescued = 0;
  for (let k = 0; k < 30; k++) {
    const seed = Math.floor(r() * 1e9);
    if (forecastFirst(L.board, rng(seed)).win) continue;
    lost++;
    const b = backtrack(L.board, rng(seed));
    if (b.win) { rescued++; assert.ok(b.undos > 0 && b.undos <= 50, `${b.undos} undos`); }
  }
  assert.ok(lost > 0 && rescued > 0, `level ${n + 1}: ${lost} lost without undo, ${rescued} of them won with it`);
  assert.equal(backtrack(L.board, rng(1), 0).undos, 0, 'with no undos allowed it never takes one');
});

test('the finishes-or-parks forecast says what really happens when that crew member is sent', () => {
  let checked = 0, parks = 0, strands = 0;
  for (const n of [3, 7, 12, 14, 17, 18, 19]) {
    const L = buildLevel(n);
    const st = cloneBoard(L.board);
    const rand = rng(n);
    for (let t = 0; t < 4000 && !isWon(st) && !isJammed(st); t++) {
      if (t % 7 === 0) {
        st.columns.forEach((c, ci) => {
          if (!c.length) return;
          const f = forecast(st, ci, LAND);
          assert.deepEqual(f, sendAndWatch(st, ci), `level ${n + 1}, tick ${st.tick}, line ${ci + 1}`);
          if (f) { checked++; parks += !f.finishes; strands += f.strands.length > 0; }
        });
      }
      if (t % 5 === 0) {
        const open = st.columns.map((c, i) => i).filter(i => st.columns[i].length && st.exposed[st.columns[i][0].color].size);
        if (open.length) deploy(st, open[Math.floor(rand() * open.length)], LAND);
      }
      tickGame(st);
    }
  }
  assert.ok(checked > 200 && parks > 20, `${checked} forecasts checked, ${parks} of them parks, ${strands} strand someone`);
});

test('level 19: crew the forecast says will park fill its three pads, and undo gets out of the jam', () => {
  const L = buildLevel(18);
  assert.equal(L.board.slots.length, 3);
  const a = new Attempt(L.board);
  // Send, 150 ms apart, a front the forecast says parks (when none does, one that finishes), until
  // the pads are full and nothing can fire.
  let before = null, parked = 0;
  for (let k = 0; k < 40 && !isJammed(a.board) && !isWon(a.board); k++) {
    if (freeSlot(a.board) >= 0) {
      const lines = a.board.columns.map((c, i) => i).filter(i => a.board.columns[i].length);
      const f = lines.map(i => [i, forecast(a.board, i, LAND)]);
      const park = f.find(([, x]) => !x.finishes);
      if (park) parked++;
      before = cloneBoard(a.board);
      a.send((park || f[0])[0], LAND);
    }
    for (let t = 0; t < 5; t++) tickGame(a.board);
  }
  for (let t = 0; t < 2000 && !isJammed(a.board) && !isWon(a.board); t++) tickGame(a.board);
  assert.ok(parked >= 3, `${parked} sends the forecast said would park`);
  assert.equal(isJammed(a.board), true, 'three parked crew on three pads: out of room');
  const sends = a.sends.length;
  a.undo();
  assert.equal(a.sends.length, sends - 1);
  assert.equal(isJammed(a.board), false, 'undo frees a pad');
  assert.deepEqual([a.board.tick, a.board.h1, a.board.h2, a.board.columns, a.board.slots], [before.tick, before.h1, before.h2, before.columns, before.slots]);
});

test('playLine sends a line with the sends overlapping in time, and says when it loses', () => {
  // A green cube sealed in under five red. Red first wins whatever the gap between sends; green
  // first on a board with one pad parks green on it, and that is out of room.
  const st = makeBoard(covered(2, 1));
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 3), crew(1, 0, 2)], [crew(2, 1, 1)]];
  for (const gap of GAPS) assert.equal(playLine(st, [0, 0, 1], gap), true, `gap ${gap}`);
  st.slots = [null];
  assert.equal(playLine(st, [1, 0, 0], 0), false);
});

const measured = []; // per level: the forecast follower's rate and the backtracking player's median undos
for (let n = 0; n < LEVELS.length; n++) {
  const def = LEVELS[n];
  test(`level ${n + 1} (${def.name}) is dealt as stored and the planning player wins it`, () => {
    const L = buildLevel(n);
    const counts = new Array(L.model.palette.length).fill(0);
    for (const col of L.board.columns) for (const s of col) counts[s.color] += s.count;
    assert.deepEqual([...counts], [...L.board.remaining], 'crew shots match cubes per colour');
    assert.equal(L.board.slots.length, def.pads, 'pads as the level asks');
    assert.ok(L.shooters <= 30, `${L.shooters} sends; at most 30`);
    let hidden = 0;
    for (const col of L.board.columns) {
      assert.equal(col[0]?.hidden, false, 'the front of a line is never hidden');
      col.forEach((s, k) => { if (s.hidden) { hidden++; assert.equal(col[k - 1].hidden, false, 'never two "?" in a row'); } });
    }
    assert.equal(L.hidden, def.hidden || 0, 'hidden crew as the level asks');
    assert.ok(hidden === L.hidden || hidden === 0, 'all "?" on screen, or none when they are all the same crew');
    if (hidden) assert.ok(new Set(L.board.columns.flat().filter(s => s.hidden).map(s => `${s.color}:${s.count}`)).size > 1, 'a "?" is a guess between at least two crew');
    const park = def.opening === 'park';
    if (park) assert.ok(L.shooters >= 8 && L.shooters <= 12, `a parking opening is short: ${L.shooters} crew, 8 to 12`);
    if (park) { const e = earlyParks(L.board); assert.ok(e >= PARK_MIN, `a parking opening: only ${e}% of greedy plays park someone in their first three sends`); }
    const p = plan(L.board, { holds: line => lineHolds(L.board, line) });
    assert.equal(p.win, true, `the planning player ${p.win === null ? 'gave up' : 'lost'} after ${p.boards} boards`);
    // Its line, played with the game's own ticks, wins: waiting for the pads to stop before each
    // send, and with the sends 0, 150, 300 and 600 ms apart while shots are still in the air.
    const st = cloneBoard(L.board);
    for (const ci of p.line) { settle(st); assert.ok(deploy(st, ci), 'the line sends into a free pad'); }
    settle(st);
    assert.equal(isWon(st), true);
    for (const gap of GAPS) assert.equal(playLine(L.board, p.line, gap), true, `the winning line loses with sends ${Math.round(gap * 1000 / 30)} ms apart`);
    assert.equal(p.holds, true);
    const fire = firingTime(L.board, p.line);
    assert.ok(fire <= 30, `the winning line takes ${fire.toFixed(1)} s to fire, more than 30`);
    const rate = greedyCheck(L.board);
    const hasty = hastyCheck(L.board);
    const fc = forecastCheck(L.board), fch = hastyForecastCheck(L.board), back = backtrackCheck(L.board);
    measured[n] = { fc: fc.rate, undos: back.undos };
    const [lo, hi] = def.greedy;
    console.log(`  L${n + 1} ${def.name}: ${L.board.total} cubes, ${L.shooters} crew, ${def.pads} pads, ${hidden} "?", plan wins in ${p.boards} boards, fires in ${fire.toFixed(1)} s; of ${GREEDY_PLAYS}: greedy ${rate}% (band ${lo}-${hi}%) hasty ${hasty}%; forecast follower ${fc.rate}% (band ${def.follow.join('-')}%, ${fc.sends} sends), hasty ${fch.rate}%; with undo ${back.rate}%, median ${back.undos ?? '-'} undos (at most ${def.undos}), ${back.sends} sends`);
    assert.ok(rate >= lo && rate <= hi, `greedy wins ${rate}%, outside ${lo}-${hi}%`);
    if (n >= 3) assert.ok(rate < 100, 'after level 3 a greedy player must lose sometimes');
    // Rushing never wins much more often than waiting, and from level 2 on it loses sometimes.
    assert.ok(hasty <= rate + 10, `the hasty greedy player wins ${hasty}%, far above waiting's ${rate}%`);
    if (n >= 1) assert.ok(hasty < 100, 'from level 2 on, rushing must lose sometimes');
    // The curve: the forecast follower inside the level's band, and the undos a backtracking player
    // needs at most the level's own (the steps between levels are the next test).
    const own = curveMisses(LEVELS, measured).filter(x => x.n === n && x.k === n).map(x => x.text);
    assert.deepEqual(own, [], own.join('; '));
    assert.ok(back.rate >= fc.rate, 'undo never makes the forecast follower worse');
  });
}

test('the curve: no level much easier than the one before it, and undos that move by small steps', () => {
  assert.equal(measured.filter(Boolean).length, LEVELS.length, 'every level was measured (see the level tests above)');
  const steps = curveMisses(LEVELS, measured).filter(x => x.k !== x.n).map(x => x.text);
  assert.deepEqual(steps, [], steps.join('; '));
  assert.ok(LEVELS.every(d => d.undos <= 6) && LEVELS.slice(0, 12).every(d => d.undos <= 3), 'at most 3 undos up to level 12, at most 6 after');
  const breathers = LEVELS.map((_, n) => n).filter(n => n > 0 && LEVELS[n].follow[0] > LEVELS[n - 1].follow[1]);
  assert.deepEqual(breathers.map(n => LEVELS[n].name), ['Melon'], 'one breather, the melon');
});
