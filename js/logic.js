// The rules of the game, with no DOM and no three.js, so the tests run them in Node.
// A board is a voxel grid of colour indices (0 = empty, c+1 = colour c). The crew shoot in
// straight lines from outside, so a cube can be hit only while it is the first cube along
// some row, column or depth line seen from one of the six sides. Removing a cube opens its
// lines to the cube behind it, which digs tunnels rather than craters.

export const START_SLOTS = 5; // launch pads, unless the level says otherwise (pads: in levels.js)

export const coords = (st, i) => [i % st.sx, Math.floor(i / st.sx) % st.sy, Math.floor(i / (st.sx * st.sy))];
export const index = (st, x, y, z) => x + st.sx * (y + st.sy * z);

// The three line directions: how many cells a line has and how far apart they sit.
function axes(st) {
  return [{ len: st.sx, step: 1 }, { len: st.sy, step: st.sx }, { len: st.sz, step: st.sx * st.sy }];
}

// Which line of direction `a` cube i sits on, the index of that line's first cell, and i's place on it.
function lineOf(st, a, i) {
  const [x, y, z] = coords(st, i);
  if (a === 0) return { line: y + st.sy * z, start: index(st, 0, y, z), pos: x };
  if (a === 1) return { line: x + st.sx * z, start: index(st, x, 0, z), pos: y };
  return { line: x + st.sx * y, start: index(st, x, y, 0), pos: z };
}

function see(st, i, delta) {
  const before = st.seen[i];
  st.seen[i] += delta;
  const c = st.cells[i] - 1;
  if (c < 0) return;
  if (!before && st.seen[i]) st.exposed[c].add(i);
  if (before && !st.seen[i]) st.exposed[c].delete(i);
}

// First filled place on a line from `from`, walking by `dir`; -1 when there is none.
function scan(st, start, step, len, from, dir) {
  for (let p = from; p >= 0 && p < len; p += dir) if (st.cells[start + p * step]) return p;
  return -1;
}

export function makeBoard(model) {
  const { sx, sy, sz, palette } = model;
  const cells = Uint8Array.from(model.cells);
  const n = palette.length;
  const st = {
    sx, sy, sz, cells, palette,
    seen: new Uint8Array(cells.length),
    lo: [], hi: [],
    remaining: new Int32Array(n),
    exposed: Array.from({ length: n }, () => new Set()),
    total: 0, cleared: 0,
    columns: [], slots: Array(START_SLOTS).fill(null),
  };
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) { st.remaining[cells[i] - 1]++; st.total++; }
  }
  const ax = axes(st);
  const lineCount = [sy * sz, sx * sz, sx * sy];
  for (let a = 0; a < 3; a++) {
    st.lo[a] = new Int16Array(lineCount[a]).fill(-1);
    st.hi[a] = new Int16Array(lineCount[a]).fill(-1);
  }
  for (let i = 0; i < cells.length; i++) {
    for (let a = 0; a < 3; a++) {
      const { line, start, pos } = lineOf(st, a, i);
      if (pos !== 0) continue;
      const lo = scan(st, start, ax[a].step, ax[a].len, 0, 1);
      if (lo < 0) continue;
      const hi = scan(st, start, ax[a].step, ax[a].len, ax[a].len - 1, -1);
      st.lo[a][line] = lo; st.hi[a][line] = hi;
      see(st, start + lo * ax[a].step, 1);
      see(st, start + hi * ax[a].step, 1);
    }
  }
  return st;
}

export function cloneBoard(st) {
  return {
    ...st,
    cells: Uint8Array.from(st.cells),
    seen: Uint8Array.from(st.seen),
    lo: st.lo.map(a => Int16Array.from(a)),
    hi: st.hi.map(a => Int16Array.from(a)),
    remaining: Int32Array.from(st.remaining),
    exposed: st.exposed.map(s => new Set(s)),
    columns: st.columns.map(col => col.map(s => ({ ...s }))),
    slots: st.slots.map(s => (s ? { ...s } : null)),
  };
}

export const isExposed = (st, i) => st.seen[i] > 0;

// Removes one cube and opens its lines to the cubes behind it. Returns its colour.
export function removeCube(st, i) {
  const c = st.cells[i] - 1;
  if (c < 0) return -1;
  if (st.seen[i]) see(st, i, -st.seen[i]);
  st.cells[i] = 0;
  st.remaining[c]--;
  st.cleared++;
  const ax = axes(st);
  for (let a = 0; a < 3; a++) {
    const { line, start, pos } = lineOf(st, a, i);
    const { step, len } = ax[a];
    if (st.lo[a][line] === pos) {
      const p = scan(st, start, step, len, pos + 1, 1);
      st.lo[a][line] = p;
      if (p >= 0) see(st, start + p * step, 1);
    }
    if (st.hi[a][line] === pos) {
      const p = scan(st, start, step, len, pos - 1, -1);
      st.hi[a][line] = p;
      if (p >= 0) see(st, start + p * step, 1);
    }
  }
  return c;
}

export const isWon = st => st.cleared >= st.total;

export function freeSlot(st) {
  return st.slots.findIndex(s => s === null);
}

// Moves the front shooter of a column into the first free slot.
// Returns { slot, shooter, revealed } or null when the column is empty or no slot is free.
export function deploy(st, col) {
  const column = st.columns[col];
  if (!column || !column.length) return null;
  const slot = freeSlot(st);
  if (slot < 0) return null;
  const shooter = column.shift();
  shooter.hidden = false;
  st.slots[slot] = shooter;
  let revealed = null;
  if (column.length && column[0].hidden) { column[0].hidden = false; revealed = column[0]; }
  return { slot, shooter, revealed };
}

export function canFire(st, slot) {
  const s = st.slots[slot];
  return !!s && !s.leaving && s.count > 0 && st.exposed[s.color].size > 0;
}

// One shot from a slot. `choose(set)` picks the target among the exposed cubes of the
// shooter's colour (the game picks the one facing the camera); default is the first.
export function fire(st, slot, choose) {
  if (!canFire(st, slot)) return -1;
  const s = st.slots[slot];
  const set = st.exposed[s.color];
  const t = choose ? choose(set) : set.values().next().value;
  if (t === undefined || t < 0 || !set.has(t)) return -1;
  removeCube(st, t);
  s.count--;
  return t;
}

export function release(st, slot) {
  st.slots[slot] = null;
}

// Shooters whose colour is gone from the sculpture have nothing left to do; they leave.
export function purgeCleared(st) {
  const gone = [];
  st.slots.forEach((s, i) => {
    if (s && !s.leaving && st.remaining[s.color] === 0) { gone.push({ where: 'slot', slot: i, shooter: s }); }
  });
  st.columns.forEach((col, ci) => {
    for (let k = col.length - 1; k >= 0; k--) {
      if (st.remaining[col[k].color] === 0) gone.push({ where: 'column', col: ci, shooter: col.splice(k, 1)[0] });
    }
    if (col.length && col[0].hidden) col[0].hidden = false;
  });
  return gone;
}

// Stuck: nothing in a slot can fire, and no shooter can be added (slots full or queues empty).
export function isJammed(st) {
  if (isWon(st)) return false;
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    if (s && (s.leaving || canFire(st, i))) return false;
  }
  const anyQueued = st.columns.some(c => c.length);
  return freeSlot(st) < 0 || !anyQueued;
}

// Plays a level to the end with a simple strategy, so the generator can check it is winnable.
// Each step: let every slot fire out, then add the front shooter that can fire now; if none
// can, add the one the `rank` function prefers (lower first). Returns true on a win.
export function solve(st0, rank, slots = START_SLOTS) {
  const st = cloneBoard(st0);
  st.slots = Array(slots).fill(null);
  for (let guard = 0; guard < 100000; guard++) {
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < st.slots.length; i++) {
        while (canFire(st, i)) { fire(st, i); progress = true; }
        if (st.slots[i] && st.slots[i].count <= 0) { release(st, i); progress = true; }
      }
      if (purgeCleared(st).length) progress = true;
    }
    if (isWon(st)) return true;
    if (freeSlot(st) < 0) return false;
    let best = -1, bestScore = Infinity;
    st.columns.forEach((col, ci) => {
      if (!col.length) return;
      const s = col[0];
      const score = st.exposed[s.color].size > 0 ? -1e9 + rank(s) : rank(s);
      if (score < bestScore) { bestScore = score; best = ci; }
    });
    if (best < 0) return false;
    deploy(st, best);
  }
  return false;
}
