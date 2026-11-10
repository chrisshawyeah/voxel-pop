import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, cloneBoard, removeCube, deploy, fire, step, settle, launch, target, isJammed, isWon, canFire, canReach, purgeCleared, isExposed, FLIGHT, tickGame, advance, forecast, busy, Attempt } from '../js/logic.js';
import { LEVELS, buildLevel, dealLevel, rng } from '../js/levels.js';
import { plan, greedyCheck, hastyCheck, lineHolds, playLine, GAPS, LAND, GREEDY_PLAYS } from '../tools/players.mjs';

const at = (m, x, y, z) => x + m.sx * (y + m.sy * z);
const solid = (n, color = 1) => ({ sx: n, sy: n, sz: n, cells: new Uint8Array(n * n * n).fill(color), palette: ['#f00', '#0f0', '#00f'] });
// One stack of cubes, listed from the bottom up (0 = a gap).
const stack = (...colors) => ({ sx: 1, sy: colors.length, sz: 1, cells: Uint8Array.from(colors), palette: ['#f00', '#0f0', '#00f'] });
const crew = (id, color, count) => ({ id, color, count, hidden: false, home: 0 });

test('only the top cube of each stack can be hit', () => {
  const m = solid(3);
  const st = makeBoard(m);
  assert.equal(st.exposed[0].size, 9, 'the top layer of a 3x3x3 block');
  assert.equal(isExposed(st, at(m, 1, 1, 1)), false);
  removeCube(st, at(m, 1, 2, 1));
  assert.equal(st.exposed[0].has(at(m, 1, 1, 1)), true, 'taking a top cube opens the one under it');
  assert.equal(st.exposed[0].size, 9);
});

test('a cube under an overhang opens only when what is above it goes, gap or not', () => {
  const m = stack(2, 0, 1); // green at the bottom, a gap, red on top
  const st = makeBoard(m);
  assert.equal(st.exposed[1].size, 0);
  removeCube(st, 2);
  assert.deepEqual([...st.exposed[1]], [0]);
});

test('a shot takes its cube when it leaves, and opens what is under it only when it lands', () => {
  const st = makeBoard(stack(2, 1)); // green under red
  st.slots = [crew(0, 0, 1), crew(1, 1, 1)];
  const first = step(st);
  assert.deepEqual(first.shots.map(s => s.cell), [1], 'red fires at the top cube; green has nothing yet');
  assert.equal(st.cells[1], 1, 'the red cube is still there while the shot flies');
  assert.equal(st.exposed[0].size, 0, 'no second shot can aim at the taken cube');
  for (let t = 1; t < FLIGHT; t++) {
    const s = step(st);
    assert.equal(s.shots.length, 0, `tick ${t + 1}: green waits, the red cube is not hit yet`);
    assert.equal(st.exposed[1].size, 0);
    assert.equal(isJammed(st), false, 'a shot in the air is not a jam');
    assert.equal(isWon(st), false);
  }
  const land = step(st);
  assert.deepEqual(land.landed, [1]);
  assert.deepEqual(land.shots.map(s => s.cell), [0], 'the green cube opens when the red shot lands, and green fires the same tick');
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
    const ci = k % a.columns.length;
    settle(a); deploy(a, ci);
    settle(b); for (let t = 0; t < 7; t++) step(b); deploy(b, ci);
  }
  settle(a); settle(b);
  assert.ok(a.cleared > 0);
  assert.deepEqual([a.h1, a.h2, a.cleared], [b.h1, b.h2, b.cleared]);
  assert.deepEqual(a.cells, b.cells);
});

test('fire() is one shot that lands at once, through the same launch and land', () => {
  const st = makeBoard(stack(2, 1));
  st.slots = [crew(0, 0, 1)];
  assert.equal(fire(st, 0), 1);
  assert.equal(st.flying.length, 0);
  assert.equal(st.exposed[1].size, 1);
  assert.equal(launch(st, 0), null, 'a spent crew member has left');
});

test('full pads with nothing to hit is a jam', () => {
  const st = makeBoard(stack(2, 1)); // green under red
  st.columns = [Array.from({ length: 6 }, (_, k) => crew(k, 1, 1)), [crew(9, 0, 1)]];
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
  // A 3 x 3 wall, one pad. Stacks from the top down: left c2 c3 c0, middle c2 c0 c1, right c1 c3 c3.
  // The only winning order depends on what the two "?" are, so a player who sees just the screen
  // would have to guess: the planning player must refuse this deal, and wins it once it may look.
  const m = { sx: 3, sy: 3, sz: 1, cells: Uint8Array.from([1, 2, 4, 4, 1, 4, 3, 3, 2]), palette: ['#a', '#b', '#c', '#d'] };
  const deal = hidden => {
    const st = makeBoard(m);
    st.slots = [null];
    const line = (col, ...cs) => cs.map(([color, count, h], k) => ({ ...crew(10 * col + k, color, count), hidden: hidden && !!h }));
    st.columns = [line(0, [2, 1], [0, 1], [1, 2], [3, 2, 1]), line(1, [3, 1], [0, 1], [2, 1, 1])];
    return st;
  };
  const seen = plan(deal(false));
  assert.equal(seen.win, true);
  assert.deepEqual(seen.line, [0, 1, 1, 1, 0, 0, 0]);
  assert.equal(plan(deal(true)).win, false);
});

// The front of line ci sent now with the game's landing pause, and nothing sent after it, played
// through the game's own send (Attempt) and tick: what really happens to that crew member.
function sendAndWatch(st, ci) {
  const a = new Attempt(cloneBoard(st));
  const d = a.send(ci, LAND);
  if (!d) return null;
  const id = d.shooter.id;
  for (;;) {
    const s = a.board.slots.find(x => x && x.id === id);
    if (!s) return { finishes: true, left: 0 };
    if (!busy(a.board)) return { finishes: false, left: s.count };
    tickGame(a.board);
  }
}

test('undo takes back the last send: cubes, lines, pads, shots in the air and the clock', () => {
  const L = buildLevel(7);
  const a = new Attempt(L.board);
  assert.equal(a.canUndo, false, 'nothing to undo at the start');
  const before = [];
  for (const ci of [0, 1, 2, 3, 0]) {
    for (let t = 0; t < 12; t++) tickGame(a.board); // sends overlap: shots are in the air
    before.push(cloneBoard(a.board));
    assert.ok(a.send(ci, LAND));
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
  }
  assert.equal(a.canUndo, false);
  assert.equal(a.undo(), false);
  assert.deepEqual(a.board.columns, buildLevel(7).board.columns, 'back to the start of the level');
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

test('the finishes-or-parks forecast says what really happens when that crew member is sent', () => {
  let checked = 0, parks = 0;
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
          if (f) { checked++; parks += !f.finishes; }
        });
      }
      if (t % 5 === 0) {
        const open = st.columns.map((c, i) => i).filter(i => st.columns[i].length && st.exposed[st.columns[i][0].color].size);
        if (open.length) deploy(st, open[Math.floor(rand() * open.length)], LAND);
      }
      tickGame(st);
    }
  }
  assert.ok(checked > 200 && parks > 20, `${checked} forecasts checked, ${parks} of them parks`);
});

test('level 19: the forecast warns that blue crew sent together park, and undo gets out of the jam', () => {
  const L = buildLevel(18);
  const blue = L.model.names.indexOf('blue');
  const lines = L.board.columns.map((c, i) => i).filter(i => L.board.columns[i][0]?.color === blue);
  assert.equal(lines.length, 3, 'blue at the front of three lines, all ready');
  assert.equal(L.board.slots.length, 3);
  const a = new Attempt(L.board);
  const count = a.board.columns[lines[0]][0].count;
  assert.deepEqual(forecast(a.board, lines[0], LAND), { finishes: false, left: count - 27 }, 'the first blue fires its 27 open cubes and parks');
  a.send(lines[0], LAND);
  for (let t = 0; t < 5; t++) tickGame(a.board); // 150 ms later
  assert.equal(forecast(a.board, lines[1], LAND).finishes, false, 'a second blue now parks too');
  a.send(lines[1], LAND);
  for (let t = 0; t < 5; t++) tickGame(a.board);
  const third = cloneBoard(a.board);
  a.send(lines[2], LAND);
  for (let t = 0; t < 400 && !isJammed(a.board); t++) tickGame(a.board);
  assert.equal(isJammed(a.board), true, 'three blue on three pads: out of room');
  assert.equal(a.board.cleared, 27);
  a.undo();
  assert.equal(isJammed(a.board), false, 'undo frees the third pad');
  assert.deepEqual([a.board.tick, a.board.h1, a.board.columns], [third.tick, third.h1, third.columns]);
});

test('playLine sends a line with the sends overlapping in time, and says when it loses', () => {
  // A red cube on each of two green ones. Red first wins whatever the gap between sends; green
  // first on a board with one pad parks green on it, and that is out of room.
  const st = makeBoard({ sx: 2, sy: 2, sz: 1, cells: Uint8Array.from([2, 2, 1, 1]), palette: ['#f00', '#0f0'] });
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 1), crew(1, 0, 1)], [crew(2, 1, 2)]];
  for (const gap of GAPS) assert.equal(playLine(st, [0, 0, 1], gap), true, `gap ${gap}`);
  st.slots = [null];
  assert.equal(playLine(st, [1, 0, 0], 0), false);
});

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
    assert.equal(hidden, def.hidden || 0);
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
    const rate = greedyCheck(L.board);
    const hasty = hastyCheck(L.board);
    const [lo, hi] = def.greedy;
    console.log(`  L${n + 1} ${def.name}: ${L.board.total} cubes, ${L.shooters} crew, ${def.pads} pads, ${hidden} hidden, plan wins in ${p.boards} boards, greedy ${rate}% hasty ${hasty}% of ${GREEDY_PLAYS} (band ${lo}-${hi}%)`);
    assert.ok(rate >= lo && rate <= hi, `greedy wins ${rate}%, outside ${lo}-${hi}%`);
    if (n >= 3) assert.ok(rate < 100, 'after level 3 a greedy player must lose sometimes');
  });
}
