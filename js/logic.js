// The rules of the game, with no DOM and no three.js, so the tests run them in Node.
// A board is a voxel grid of colour indices (0 = empty, c+1 = colour c), y pointing up.
// A cube can be hit only while nothing sits on top of it: the crew eat the sculpture from the
// top down, and taking the top cube of a stack opens the one under it.
//
// Time runs in ticks. In one tick every pad that can fire sends one shot. A shot picks its cube
// when it leaves (that cube is then taken: no second shot aims at it) and the cube is removed,
// opening the one under it, only when the shot lands, FLIGHT ticks later. The game runs one
// tick every FIRE_GAP seconds (js/main.js); the test players run the same ticks back to back,
// so a player who waits for the pads to stop sees exactly the board the checks saw.

export const START_SLOTS = 5; // launch pads, unless the level says otherwise (pads: in levels.js)
export const FLIGHT = 9;      // ticks from a shot leaving its pad to landing (9 x 1/30 s = 0.3 s)

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
// Returns { slot, shooter, revealed } or null when the column is empty or no slot is free.
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
  return { slot, shooter, revealed };
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
// is free for the next one while that shot is still flying.
// Returns { slot, shooter, cell, freed } or null when the pad cannot fire.
export function launch(st, slot) {
  if (!canFire(st, slot)) return null;
  const s = st.slots[slot];
  const cell = target(st, s.color);
  st.exposed[s.color].delete(cell);
  s.count--;
  st.flying.push({ cell, at: st.tick + FLIGHT });
  const freed = s.count <= 0;
  if (freed) st.slots[slot] = null;
  return { slot, shooter: s, cell, freed };
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
