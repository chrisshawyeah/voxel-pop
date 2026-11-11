// The rules of the game, with no DOM and no three.js, so the tests run them in Node.
// A board is a voxel grid of colour indices (0 = empty, c+1 = colour c), y pointing up.
// A cube can be hit only while nothing sits on top of it: the crew eat the sculpture from the
// top down, and taking the top cube of a stack opens the one under it.
//
// Time runs in ticks. In one tick every pad that can fire sends one shot. A shot picks its cube
// when it leaves (that cube is then taken: no second shot aims at it) and the cube is removed,
// opening the one under it, only when the shot lands, FLIGHT ticks later. The game runs one
// tick every FIRE_GAP seconds (js/main.js); the test players run the same ticks back to back,
// so a player who waits for the pads to stop sees exactly the board the checks saw, and the
// checks also play each winning line with the sends overlapping in time (tools/players.mjs).

export const START_SLOTS = 5; // launch pads, unless the level says otherwise (pads: in levels.js)
export const FLIGHT = 9;      // ticks from a shot leaving its pad to landing (9 x 1/30 s = 0.3 s)
// Which version of these rules a saved attempt was played under (js/main.js keeps it with the
// save). Add one whenever a change here makes the same sends end on a different board, so a level
// left half-played under the old rules starts again instead of coming back wrong.
export const RULES = 3;
// The latest tick a saved attempt may name (about 90 hours of play at 30 ticks a second). Ticks
// stay whole numbers far below this, so tick + FLIGHT is always exact and every replay ends.
export const MAX_TICK = 1e7;
export const MAX_UNDOS = 1e6;

export const coords = (st, i) => [i % st.sx, Math.floor(i / st.sx) % st.sy, Math.floor(i / (st.sx * st.sy))];
export const index = (st, x, y, z) => x + st.sx * (y + st.sy * z);

// The stack a cell sits in (one per x, z) and the highest filled height in it below `from`.
const stackOf = (st, i) => (i % st.sx) + st.sx * Math.floor(i / (st.sx * st.sy));
function below(st, stack, from) {
  const x = stack % st.sx, z = Math.floor(stack / st.sx);
  for (let y = from; y >= 0; y--) if (st.cells[index(st, x, y, z)]) return y;
  return -1;
}

// The one targeting rule, used by the game, the checks and the test players alike: of the cubes
// a crew member can hit, it takes the highest one first, and on the same layer the one farthest
// from the middle (it peels the sculpture from the top and the outside in). It never depends on
// the camera, so the same taps give the same board every time. order[i] is cell i's place in
// that rule (lower goes first); it depends only on the grid's size, so boards share it.
const orderCache = new Map();
function targetOrder(sx, sy, sz) {
  const key = `${sx}x${sy}x${sz}`;
  if (orderCache.has(key)) return orderCache.get(key);
  const n = sx * sy * sz, cx = (sx - 1) / 2, cz = (sz - 1) / 2;
  const keyOf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    keyOf[i] = -y * 1e6 - ((x - cx) ** 2 + (z - cz) ** 2) * 100 + i / n; // top, then outside, then grid order
  }
  const byKey = Array.from({ length: n }, (_, i) => i).sort((a, b) => keyOf[a] - keyOf[b]);
  const order = new Int32Array(n);
  byKey.forEach((cell, k) => { order[cell] = k; });
  orderCache.set(key, order);
  return order;
}

// Two random 32-bit numbers per cell; a board's hash is the XOR of those of its removed cubes,
// so the planning test player can tell two boards apart cheaply (tools/players.mjs).
const zobristCache = new Map();
function zobrist(n) {
  if (zobristCache.has(n)) return zobristCache.get(n);
  let a = 0x9e3779b9;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) | 0; };
  const z = [Int32Array.from({ length: n }, next), Int32Array.from({ length: n }, next)];
  zobristCache.set(n, z);
  return z;
}

export function makeBoard(model) {
  const { sx, sy, sz, palette } = model;
  const cells = Uint8Array.from(model.cells);
  const n = palette.length;
  const st = {
    sx, sy, sz, cells, palette,
    order: targetOrder(sx, sy, sz), zob: zobrist(cells.length), h1: 0, h2: 0,
    top: new Int16Array(sx * sz).fill(-1), // height of the top cube of each stack, -1 when empty
    remaining: new Int32Array(n),
    exposed: Array.from({ length: n }, () => new Set()),
    total: 0, cleared: 0,
    tick: 0, flying: [],
    columns: [], slots: Array(START_SLOTS).fill(null),
  };
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) { st.remaining[cells[i] - 1]++; st.total++; }
  }
  for (let stack = 0; stack < sx * sz; stack++) {
    const y = below(st, stack, sy - 1);
    st.top[stack] = y;
    if (y >= 0) { const i = index(st, stack % sx, y, Math.floor(stack / sx)); st.exposed[cells[i] - 1].add(i); }
  }
  return st;
}

export function cloneBoard(st) {
  return {
    ...st,
    cells: Uint8Array.from(st.cells),
    top: Int16Array.from(st.top),
    remaining: Int32Array.from(st.remaining),
    exposed: st.exposed.map(s => new Set(s)),
    flying: st.flying.slice(),
    columns: st.columns.map(col => col.map(s => ({ ...s }))),
    slots: st.slots.map(s => (s ? { ...s } : null)),
  };
}

// True while nothing sits on top of cube i (a cube a shot has already taken counts too).
export const isExposed = (st, i) => st.cells[i] > 0 && st.top[stackOf(st, i)] === Math.floor(i / st.sx) % st.sy;

// Removes one cube and opens the one under it. Returns its colour.
export function removeCube(st, i) {
  const c = st.cells[i] - 1;
  if (c < 0) return -1;
  st.exposed[c].delete(i);
  st.cells[i] = 0;
  st.remaining[c]--;
  st.cleared++;
  st.h1 ^= st.zob[0][i]; st.h2 ^= st.zob[1][i];
  const stack = stackOf(st, i), y = Math.floor(i / st.sx) % st.sy;
  if (st.top[stack] === y) {
    const next = below(st, stack, y - 1);
    st.top[stack] = next;
    if (next >= 0) { const j = index(st, stack % st.sx, next, Math.floor(stack / st.sx)); st.exposed[st.cells[j] - 1].add(j); }
  }
  return c;
}

// Won when the last cube has been hit (a shot still in the air does not count).
export const isWon = st => st.cleared >= st.total;

export function freeSlot(st) {
  return st.slots.findIndex(s => s === null);
}

// Moves the front shooter of a column into the first free slot. `land` is how many ticks it
// takes to land there before its first shot (the game gives the flight to the pad time to
// finish; the tests and test players send with 0, which changes nothing for a player who waits
// for the pads to stop: a crew member sent alone fires the same shots a few ticks later).
// Returns { slot, shooter, revealed, lone } or null when the column is empty or no slot is free;
// revealed is the "?" that has just become the front of its line, lone the crew revealLone() showed.
export function deploy(st, col, land = 0) {
  const column = st.columns[col];
  if (!column || !column.length) return null;
  const slot = freeSlot(st);
  if (slot < 0) return null;
  const shooter = column.shift();
  shooter.hidden = false;
  shooter.land = land;
  st.slots[slot] = shooter;
  let revealed = null;
  if (column.length && column[0].hidden) { column[0].hidden = false; revealed = column[0]; }
  return { slot, shooter, revealed, lone: revealLone(st) };
}

// A "?" is a guess between the crew still hidden (the line preview lists them). Once every one
// still hidden is the same crew (one colour, one number), there is nothing left to guess, so they
// are shown as themselves. Returns the crew it showed. The planning test player keeps its own
// unknowns (`unknown`, tools/players.mjs) and works the same thing out itself, so it skips them.
export function revealLone(st) {
  let kind = null;
  const lone = [];
  for (const col of st.columns) {
    for (const s of col) {
      if (!s.hidden) continue;
      if (s.unknown) return [];
      const k = `${s.color}:${s.count}`;
      if (kind !== null && k !== kind) return [];
      kind = k;
      lone.push(s);
    }
  }
  for (const s of lone) s.hidden = false;
  return lone;
}

// st.exposed[c] holds the cubes of colour c that can be hit and that no shot has taken yet.
// canReach: the crew member on this pad has something to hit, landed or not (what the screen
// shows as awake); canFire: it can shoot this tick.
export function canReach(st, slot) {
  const s = st.slots[slot];
  return !!s && s.count > 0 && st.exposed[s.color].size > 0;
}
export const canFire = (st, slot) => canReach(st, slot) && !(st.slots[slot].land > 0);

// The cube a crew member of colour c would hit now under the targeting rule; -1 when none.
export function target(st, c) {
  let best = -1, rank = Infinity;
  for (const i of st.exposed[c]) if (st.order[i] < rank) { rank = st.order[i]; best = i; }
  return best;
}

// One shot leaves a pad: it takes its cube (no other shot aims at it) and is in the air until
// tick `at`. A crew member that has just sent its last shot leaves the pad at once, so the pad
// is free for the next one while that shot is still flying. A shot in the air remembers when it
// left, from which pad, in which colour and whose it is, so the screen can draw it from the
// rules alone (and draw it again after an undo).
// Returns { slot, shooter, cell, freed, flight } or null when the pad cannot fire; flight is that
// shot's record in st.flying, which the screen draws as it is.
export function launch(st, slot) {
  if (!canFire(st, slot)) return null;
  const s = st.slots[slot];
  const cell = target(st, s.color);
  st.exposed[s.color].delete(cell);
  s.count--;
  const flight = { cell, at: st.tick + FLIGHT, from: st.tick, slot, color: s.color, id: s.id };
  st.flying.push(flight);
  const freed = s.count <= 0;
  if (freed) st.slots[slot] = null;
  return { slot, shooter: s, cell, freed, flight };
}

// A shot lands: its cube goes and the cubes behind it open up.
export const land = (st, cell) => removeCube(st, cell);

// One tick: the shots due now land (in the order they left), crew still landing on a pad come
// one tick closer, then every pad that can fire sends one shot, pad by pad from the left.
// Returns what happened, for the screen.
export function step(st) {
  st.tick++;
  const landed = [];
  while (st.flying.length && st.flying[0].at <= st.tick) {
    const { cell } = st.flying.shift();
    land(st, cell);
    landed.push(cell);
  }
  for (const s of st.slots) if (s && s.land > 0) s.land--;
  const shots = [];
  for (let i = 0; i < st.slots.length; i++) {
    const shot = launch(st, i);
    if (shot) shots.push(shot);
  }
  return { landed, shots };
}

export const busy = st => st.flying.length > 0 || st.slots.some((_, i) => canReach(st, i));

// Runs ticks until every shot has landed and no pad can fire: what a player who waits sees.
export function settle(st) {
  while (busy(st)) step(st);
  return st;
}

// One tick exactly as the game runs it: step(), then crew whose colour is gone leave (a dealt
// level never has any). The game, the forecast and replay() all tick through here, so they
// agree to the cube.
export function tickGame(st) {
  const r = step(st);
  r.gone = r.landed.length ? purgeCleared(st) : [];
  return r;
}

// Nothing would change in a tick but the clock: no shot in the air, nobody landing, nothing that
// can fire.
const idle = st => !st.flying.length && st.slots.every(s => !s || (!(s.land > 0) && !(s.count > 0 && st.exposed[s.color].size)));

// Runs the game's ticks until st.tick is `tick` (a quiet board skips straight there).
export function advance(st, tick) {
  while (st.tick < tick) {
    if (idle(st)) { st.tick = tick; break; }
    tickGame(st);
  }
  return st;
}

// What sending the front of line `col` now would do if nothing else were sent after it: the
// rules run on a copy of the board, with the crew already on the pads, the shots in the air,
// the landing pause and the one targeting rule, until that crew member has sent its last shot
// (it finishes and frees its pad) or nothing can fire any more (it parks, with `left` shots).
// null when it cannot be sent now (the line is empty or every pad is taken).
export function forecast(st, col, land = 0) {
  const sim = cloneBoard(st);
  const d = deploy(sim, col, land);
  if (!d) return null;
  const me = d.shooter;
  for (;;) {
    if (sim.slots[d.slot] !== me) return { finishes: true, left: 0 };
    if (!busy(sim)) return { finishes: false, left: me.count };
    tickGame(sim);
  }
}

// What becomes of each crew member already on a pad if nothing else is sent: the rules run on a
// copy of the board until nothing moves. A Map from crew id to the shots it is left with when it
// parks, 0 when it finishes and frees its pad. One run answers every pad, and the answer holds
// until the next send or undo, since nothing else changes where the board is going. This is how
// a crew member that a later send has robbed shows it at once, before it runs dry.
export function fates(st) {
  const sim = cloneBoard(st);
  const onPads = sim.slots.filter(Boolean);
  while (busy(sim)) tickGame(sim);
  return new Map(onPads.map(s => [s.id, sim.slots.includes(s) ? s.count : 0]));
}

// A board in four numbers: its clock, how many cubes are gone and which (two hashes). A saved
// attempt keeps one after each send and one for the moment it was left, so a replay that comes out
// different (other rules, another sculpture) is caught instead of played.
export const checkOf = b => [b.tick, b.cleared, b.h1, b.h2];
const sameCheck = (a, b) => Array.isArray(b) && b.length === 4 && a.every((v, k) => v === b[k]);

// A level being played: its board, the sends made so far (line and tick), a check of the board
// just after each, and a copy of the board from just before each one, so the last send can be
// taken back, again and again, to the start of the level. `undos` counts every send taken back in
// this attempt; undoing never lowers it, and a win with none is a clean clear (js/main.js).
// restore() rebuilds all of it from save(), which is what the game keeps in the browser's storage.
export class Attempt {
  constructor(board) {
    this.board = board;
    this.sends = [];
    this.checks = [];
    this.before = [];
    this.undos = 0;
  }

  get canUndo() { return this.before.length > 0; }

  // Sends the front of line `col` the way deploy() does; null when it cannot go.
  send(col, land = 0) {
    const copy = cloneBoard(this.board);
    const d = deploy(this.board, col, land);
    if (!d) return null;
    this.before.push(copy);
    this.sends.push([col, copy.tick]);
    this.checks.push(checkOf(this.board));
    return d;
  }

  // The board as it was just before the last send: cubes, lines, pads, shots in the air, clock.
  undo() {
    if (!this.before.length) return false;
    this.board = this.before.pop();
    this.sends.pop();
    this.checks.pop();
    this.undos++;
    return true;
  }

  // Plain data for storage: the sends with their checks, the undos so far, and the tick the board
  // is at now with its check, so restore() can bring back the board as it is at this moment.
  save() {
    return { sends: this.sends.map(s => s.slice()), checks: this.checks.map(c => c.slice()), undos: this.undos, at: this.board.tick, end: checkOf(this.board) };
  }

  // Plays `sends` on a fresh copy of `start` with the game's own ticks and returns the attempt
  // as it stood just after the last of them, or null when they do not fit the board. With
  // `checks`, every send must also leave the board its check says, or it is null.
  static replay(start, sends, land = 0, checks = null) {
    if (!Array.isArray(sends) || (checks && (!Array.isArray(checks) || checks.length !== sends.length))) return null;
    const a = new Attempt(cloneBoard(start));
    for (let k = 0; k < sends.length; k++) {
      const s = sends[k];
      if (!Array.isArray(s) || s.length !== 2 || !Number.isSafeInteger(s[0]) || !Number.isSafeInteger(s[1])) return null;
      if (s[1] < a.board.tick || s[1] > MAX_TICK) return null;
      advance(a.board, s[1]);
      if (!a.send(s[0], land)) return null; // a line that is not there or is empty, or no free pad
      if (checks && !sameCheck(a.checks[k], checks[k])) return null;
    }
    return a;
  }

  // The attempt a save() describes, with the board at the tick it was left at, or null when the
  // save is broken or does not fit this board: every field is checked, every tick bounded, and
  // each send's check and the last one must come out the same.
  static restore(start, save, land = 0) {
    if (!save || typeof save !== 'object') return null;
    const { sends, checks, undos, at, end } = save;
    if (!Number.isSafeInteger(undos) || undos < 0 || undos > MAX_UNDOS) return null;
    if (!Number.isSafeInteger(at) || at < 0 || at > MAX_TICK) return null;
    const a = Attempt.replay(start, sends, land, checks || []);
    if (!a || at < a.board.tick) return null;
    advance(a.board, at);
    if (!sameCheck(checkOf(a.board), end)) return null;
    a.undos = undos;
    return a;
  }
}

// One shot that lands at once (for tests and quick checks; the game and players use step()).
export function fire(st, slot) {
  const shot = launch(st, slot);
  if (!shot) return -1;
  st.flying.pop();
  land(st, shot.cell);
  return shot.cell;
}

// Shooters whose colour is gone from the sculpture have nothing left to do; they leave. A dealt
// level gives every colour exactly as many shots as it has cubes, so this only matters for
// boards made by hand.
export function purgeCleared(st) {
  const gone = [];
  st.slots.forEach((s, i) => {
    if (s && st.remaining[s.color] === 0) { st.slots[i] = null; gone.push({ where: 'slot', slot: i, shooter: s }); }
  });
  st.columns.forEach((col, ci) => {
    for (let k = col.length - 1; k >= 0; k--) {
      if (st.remaining[col[k].color] === 0) gone.push({ where: 'column', col: ci, shooter: col.splice(k, 1)[0] });
    }
    if (col.length && col[0].hidden) col[0].hidden = false;
  });
  if (gone.length) revealLone(st);
  return gone;
}

// Stuck: no shot is in the air, nothing on a pad can fire, and no shooter can be added
// (pads full or queues empty).
export function isJammed(st) {
  if (isWon(st) || st.flying.length) return false;
  for (let i = 0; i < st.slots.length; i++) if (canReach(st, i)) return false;
  const anyQueued = st.columns.some(c => c.length);
  return freeSlot(st) < 0 || !anyQueued;
}
