import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, cloneBoard, removeCube, deploy, fire, step, settle, launch, target, isJammed, isWon, canFire, canReach, purgeCleared, isExposed, freeSlot, FLIGHT, tickGame, advance, forecast, forecastKey, fates, busy, revealLone, checkOf, pace, Attempt, FAST, IDLE_MS } from '../js/logic.js';
import { LEVELS, buildLevel, dealLevel, levelPrint, rng } from '../js/levels.js';
import { plan, greedy, greedyCheck, hastyCheck, hastyGreedy, lineHolds, playLine, onClock, earlyParks, forecastFirst, backtrack, forecastCheck, hastyForecastCheck, backtrackCheck, firingTime, curveMisses, GAPS, LAND, GREEDY_PLAYS, PARK_MIN } from '../tools/players.mjs';

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

test('undos are counted, never lowered by undoing, and a save brings back the board as it was left', () => {
  const L = buildLevel(7);
  const a = new Attempt(cloneBoard(L.board));
  const t = n => { for (let k = 0; k < n; k++) tickGame(a.board); };
  a.send(0, LAND); t(12);
  a.send(1, LAND); t(7);
  assert.equal(a.undos, 0);
  a.undo();
  assert.equal(a.undos, 1, 'one undo');
  const afterUndo = cloneBoard(a.board);
  const back0 = Attempt.restore(L.board, JSON.parse(JSON.stringify(a.save())), LAND);
  assert.ok(back0, 'a save made just after an undo restores');
  assert.deepEqual(checkOf(back0.board), checkOf(afterUndo), 'to the board the undo gave back, not to just after the last send');
  assert.deepEqual(back0.board.slots, afterUndo.slots);
  assert.deepEqual(back0.board.flying, afterUndo.flying);
  a.send(2, LAND); t(5); a.send(3, LAND); t(40);
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
  // Two red cubes open and a third under green. Red 2 sent with nobody after it finishes; red 1
  // sent just after it also finishes, but the two then share the open cubes and red 2 is left with
  // one: the forecast for red 1 says so before the send ("finishes; strands red 1"), and red 2's pad
  // shows it once red 1 has gone.
  const st = makeBoard({ sx: 3, sy: 2, sz: 1, cells: Uint8Array.from([0, 0, 1, 1, 1, 2]), palette: ['#f00', '#0f0'] });
  st.slots = [null, null, null];
  st.columns = [[crew(0, 0, 2)], [crew(1, 0, 1)], [crew(2, 1, 1)]];
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
  // Two stacks: red under green, and red under blue. Green 1 on pad 3 fires at once; its shot opens
  // the first red when it lands, at tick 10. Red 1 sleeps on pad 2 waiting for it. Another red 1 sent
  // to pad 1 by tick 5 has landed by then and fires first (pad 1 goes first): it finishes, and the
  // sleeper, which would have taken that cube, is stranded (the other red is under blue, whose crew
  // waits in a line). Sent from tick 6, it lands too late and parks. Between, no shot leaves or
  // lands and nobody lands: only the clock tells the two forecasts apart.
  const st = makeBoard({ sx: 2, sy: 2, sz: 1, cells: Uint8Array.from([1, 1, 2, 3]), palette: ['#f00', '#0f0', '#00f'] });
  st.slots = [null, crew(10, 0, 1), crew(11, 1, 1)];
  st.columns = [[crew(0, 0, 1)], [crew(1, 2, 1)]];
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
  // One stack, from the bottom: red, red, green, red. Red 2, red 1 and green 1, two pads. Sent
  // 33 ms apart, red 2 and red 1 both land before the one open red is hit: one of them takes it,
  // red 2 then sleeps with 1 left and red 1 with 1 (or red 1 finishes and frees its pad), and green
  // cannot go up when both pads hold a sleeper. 150 ms apart, the first shot has already taken
  // the open red, so nothing else looks ready until green opens.
  const st = makeBoard(stack(1, 1, 2, 1));
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 2)], [crew(1, 0, 1)], [crew(2, 1, 1)]];
  const rate = (gap, plays = 200) => { const r = rng(5); let w = 0; for (let k = 0; k < plays; k++) w += hastyGreedy(st, r, gap); return (100 * w) / plays; };
  const r1 = rate(33);
  assert.ok(r1 > 20 && r1 < 80, `33 ms apart it wins about half the time, not ${r1}%`);
  assert.equal(rate(150), 100, '150 ms apart it always wins');
  const g = rng(6);
  for (let k = 0; k < 50; k++) assert.equal(greedy(st, g), true, 'waiting always wins');
});

test('the speed-up: 3x while the player only waits, 1x while a crew member lands or a finger is down', () => {
  const st = makeBoard(stack(1, 1, 1));
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 1), crew(1, 0, 1)], [crew(2, 0, 1)]];
  assert.equal(pace(st, 0), 1, 'a pad free and the player has just tapped (or is pressing: 0)');
  assert.equal(pace(st, IDLE_MS - 1), 1);
  assert.equal(pace(st, IDLE_MS), FAST, 'half a second with no input, though a pad is free');
  deploy(st, 0, LAND);
  assert.equal(pace(st, 1e9), 1, 'never faster while a crew member is landing');
  for (let t = 0; t < LAND; t++) tickGame(st);
  assert.equal(pace(st, 0), 1, 'landed, and the player has just tapped');
  st.slots = [crew(5, 0, 1), crew(6, 0, 1)];
  assert.equal(pace(st, 0), FAST, 'every pad taken: nothing to send');
  st.slots = [null, null];
  st.columns = [[], []];
  assert.equal(pace(st, 0), FAST, 'every line empty: nothing to send');
});

test('the timed test players keep the game\'s clock', () => {
  // Sixty red cubes in one stack, three red crew of 20 in one line, three pads, a tap every 600 ms.
  // The first goes at tick 0. It lands (5 ticks at 1x), the board runs at 1x until nobody has
  // tapped for 500 ms (tick 15), then at 3x: the next tap's 600 ms are up at tick 24, not 18.
  const st = makeBoard({ sx: 1, sy: 60, sz: 1, cells: new Uint8Array(60).fill(1), palette: ['#f00'] });
  st.slots = [null, null, null];
  st.columns = [[crew(0, 0, 20), crew(1, 0, 20), crew(2, 0, 20)]];
  const at = [];
  const r = onClock(st, 600, b => { if (!b.columns[0].length) return -1; at.push(b.tick); return 0; });
  assert.equal(r.win, true);
  assert.deepEqual(at, [0, 24, 48]);
  assert.ok(r.seconds < r.ticks / 30 && r.seconds > r.ticks / 90, `${r.ticks} ticks in ${r.seconds} s: some at 3x, not all`);
  assert.equal(firingTime(st, [0, 0, 0]), onClock(st, 0, b => (b.columns[0].length ? 0 : -1)).seconds, 'firingTime is the same clock');
  // 150 ms apart (the hasty players), every send lands before the next.
  const sends = [];
  const four = cloneBoard(st);
  four.slots = [null, null, null, null];
  onClock(four, 150, b => { if (!b.columns[0].length) return -1; sends.push(b.tick); return 0; });
  assert.deepEqual(sends, [0, 5, 10]);
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
  // A red cube on each of two green ones. Red first wins whatever the gap between sends; green
  // first on a board with one pad parks green on it, and that is out of room.
  const st = makeBoard({ sx: 2, sy: 2, sz: 1, cells: Uint8Array.from([2, 2, 1, 1]), palette: ['#f00', '#0f0'] });
  st.slots = [null, null];
  st.columns = [[crew(0, 0, 1), crew(1, 0, 1)], [crew(2, 1, 2)]];
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
