// The rules of the game, with no DOM and no three.js, so the tests run them in Node.
// A board is a voxel grid of colour indices (0 = empty, c+1 = colour c), y pointing up.
// The crew hit only cubes the player can see. A cube is in sight from a side of the sculpture
// (front, back, left, right or the top; it stands on a turntable, so never from below) when it is
// the first cube along a straight line of the grid coming in from that side: nothing stands
// between it and the outside that way. It can be hit while one of its sides faces the camera: the
// sculpture turns on its turntable (and the player can turn and tilt it), so its sides come round
// in turn, and the top is always in view (the camera never looks from below or straight down).
// Of those, a shot prefers a cube with a clear line to the camera (seen()), so it never pops a cube
// hidden behind another part. So the crew eat the sculpture from the outside in, and a colour
// hidden inside waits until the cubes covering it are gone: taking a cube opens the one behind it
// along every line it was first on.
//
// The view is part of the board: st.yaw (how far the turntable has turned, YAW_STEPS to a turn),
// st.pitch (how high the camera looks from, PITCH_STEPS from low to high) and st.spin (how far the
// turntable turns each tick: TURN on its own, 0 while the player holds it). The game sets them
// when the player turns or tilts the sculpture (Attempt.view), and a saved attempt keeps those
// changes, so playing it back hits the same cubes. The forecast and the test players let the
// turntable turn on its own.
//
// Time runs in ticks. In one tick the turntable turns by st.spin, then every pad that can fire
// sends one shot. A shot picks its cube when it leaves (that cube is then taken: no second shot
// aims at it) and the cube is removed, opening the cubes behind it, only when the shot lands,
// FLIGHT ticks later. The game runs one tick every 1/30 s, or FAST times as often while there is
// nothing to send (pace() below); the test players run the same ticks back to back, so a player
// who waits for the pads to stop sees exactly the board the checks saw, and the timed ones keep
// the game's clock (pace()) to play each winning line with the sends overlapping in time
// (tools/players.mjs).

export const START_SLOTS = 5; // launch pads, unless the level says otherwise (pads: in levels.js)
export const FLIGHT = 9;      // ticks from a shot leaving its pad to landing (9 x 1/30 s = 0.3 s)
export const FAST = 3;        // how much faster the ticks run while there is nothing to send (pace)
// Which version of these rules a saved attempt was played under (js/main.js keeps it with the
// save). Add one whenever a change here makes the same sends end on a different board, so a level
// left half-played under the old rules starts again instead of coming back wrong.
export const RULES = 5;
// The view (see the top of this file). A turn of the turntable is YAW_STEPS steps; on its own it
// turns TURN steps a tick (about 0.41 radians a second, a turn in 15 seconds at normal speed). The
// camera looks from PITCH_MIN to PITCH_MAX radians above level in PITCH_STEPS steps: never from
// below (the turntable) and never straight down, so every side comes into view once a turn.
export const YAW_STEPS = 4096;
export const TURN = 9;
export const PITCH_STEPS = 64;
export const PITCH_MIN = 0.08;
export const PITCH_MAX = 1.1;
export const START_YAW = 391;   // about 0.6 radians: a level starts turned a little, so it reads as 3D
export const START_PITCH = 19;  // about 0.39 radians (22 degrees) above level
export const MAX_SPIN = 64;     // the most a saved view may turn a tick
export const yawRad = u => (u * 2 * Math.PI) / YAW_STEPS;
export const pitchRad = u => PITCH_MIN + (u * (PITCH_MAX - PITCH_MIN)) / (PITCH_STEPS - 1);
export const yawUnits = rad => ((Math.round((rad * YAW_STEPS) / (2 * Math.PI)) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
export const pitchUnits = rad => Math.max(0, Math.min(PITCH_STEPS - 1, Math.round(((rad - PITCH_MIN) * (PITCH_STEPS - 1)) / (PITCH_MAX - PITCH_MIN))));
// A side of the sculpture faces the camera while it is turned less than about 72 degrees away (at
// the usual height; less when the camera looks from high up).
const FACING = 0.3;
// While the turntable turns on its own and crew on the pads have waited SEEK ticks with nothing
// of their colour in view, the camera looks for it: up high for LOOK ticks (into pits), then down
// low for LOOK ticks (under parts that stick out), one pitch step a tick, and back to the height
// the player left it at (st.home) once a shot flies. Only after all that (STALL) does a shot take
// a cube hidden behind another part (target()). The checks below call a board settled after twice
// STALL with nothing fired or landed.
export const SEEK = 120;
export const LOOK = 200;
export const STALL = SEEK + 2 * LOOK;
const HIGH = PITCH_STEPS - 4, LOW = 2;
// The latest tick a saved attempt may name (about 90 hours of play at 30 ticks a second). Ticks
// stay whole numbers far below this, so tick + FLIGHT is always exact and every replay ends.
export const MAX_TICK = 1e7;
export const MAX_UNDOS = 1e6;

export const coords = (st, i) => [i % st.sx, Math.floor(i / st.sx) % st.sy, Math.floor(i / (st.sx * st.sy))];
export const index = (st, x, y, z) => x + st.sx * (y + st.sy * z);

// The one targeting rule, used by the game, the checks and the test players alike: of the cubes
// a crew member can hit now (in sight from a side that faces the camera), it takes the highest one
// first, and on the same layer the one farthest from the middle, so each crew peels its colour
// from the top down and from the outside in; one with a clear line to the camera before one hidden
// behind another part (target()). It depends on the view only through the board's own st.yaw and
// st.pitch, so the same taps and turns give the same board every time. order[i] is cell i's place
// in that rule (lower goes first); it depends only on the grid's size, so boards share it.
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

// The five sides a cube can be seen from: +x, -x, +z, -z and the top (+y). Never from below.
// SIDE_N[s] is that side's outward direction.
export const SIDES = 5;
const SIDE_N = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
export const SIDE_NAMES = ['right', 'left', 'front', 'back', 'top'];

// st.side[i] has bit s set while cube i is the first cube along its line from side s: in sight
// from that side. st.taken[i] is 1 while a shot is on its way to cube i. st.exposed[c] holds the
// cubes of colour c in sight from some side that no shot has taken yet: the ones a crew member of
// that colour can hit once their side comes round (canReach). st.facing[c * SIDES + s] counts
// those in sight from side s, so whether a colour has a cube facing the camera now is quick to
// tell (canFire).
export function makeBoard(model) {
  const { sx, sy, sz, palette } = model;
  const cells = Uint8Array.from(model.cells);
  const n = palette.length;
  const st = {
    sx, sy, sz, cells, palette,
    order: targetOrder(sx, sy, sz), zob: zobrist(cells.length), h1: 0, h2: 0,
    side: new Uint8Array(cells.length), taken: new Uint8Array(cells.length),
    facing: new Int32Array(n * SIDES),
    remaining: new Int32Array(n),
    exposed: Array.from({ length: n }, () => new Set()),
    total: 0, cleared: 0,
    tick: 0, flying: [],
    yaw: START_YAW, pitch: START_PITCH, spin: TURN, home: START_PITCH,
    rev: 0, quiet: 0, aimKey: new Float64Array(n).fill(-1), aimCell: new Int32Array(n),
    clrKey: new Int32Array(cells.length), clrBlock: new Int32Array(cells.length),
    columns: [], slots: Array(START_SLOTS).fill(null),
  };
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) { st.remaining[cells[i] - 1]++; st.total++; }
  }
  // The first cube along every line, from every side.
  for (let s = 0; s < SIDES; s++) {
    const [dx, dy, dz] = SIDE_N[s];
    for (let i = 0; i < cells.length; i++) {
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      // Start each line at the grid's edge on side s.
      if ((dx > 0 && x !== sx - 1) || (dx < 0 && x !== 0) || (dy > 0 && y !== sy - 1) || (dz > 0 && z !== sz - 1) || (dz < 0 && z !== 0)) continue;
      const j = along(st, x, y, z, -dx, -dy, -dz);
      if (j >= 0) show(st, j, s);
    }
  }
  return st;
}

export function cloneBoard(st) {
  return {
    ...st,
    cells: Uint8Array.from(st.cells),
    side: Uint8Array.from(st.side),
    taken: Uint8Array.from(st.taken),
    facing: Int32Array.from(st.facing),
    aimKey: Float64Array.from(st.aimKey), aimCell: Int32Array.from(st.aimCell),
    clrKey: Int32Array.from(st.clrKey), clrBlock: Int32Array.from(st.clrBlock),
    remaining: Int32Array.from(st.remaining),
    exposed: st.exposed.map(s => new Set(s)),
    flying: st.flying.slice(),
    columns: st.columns.map(col => col.map(s => ({ ...s }))),
    slots: st.slots.map(s => (s ? { ...s } : null)),
  };
}

// The first cube from (x, y, z) on, walking by (dx, dy, dz); -1 when the line runs out first.
function along(st, x, y, z, dx, dy, dz) {
  const { sx, sy, sz, cells } = st;
  while (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) {
    const i = x + sx * (y + sy * z);
    if (cells[i]) return i;
    x += dx; y += dy; z += dz;
  }
  return -1;
}

// Cube i comes into sight from side s.
function show(st, i, s) {
  const b = 1 << s;
  if (st.side[i] & b) return;
  st.side[i] |= b;
  if (st.taken[i]) return;
  const c = st.cells[i] - 1;
  st.facing[c * SIDES + s]++;
  st.exposed[c].add(i);
}

// Cube i is no longer one a crew member can pick (a shot has taken it, or it is gone).
function unlist(st, i) {
  const c = st.cells[i] - 1;
  if (c < 0 || st.taken[i] || !st.exposed[c].has(i)) return;
  st.exposed[c].delete(i);
  for (let s = 0; s < SIDES; s++) if (st.side[i] & (1 << s)) st.facing[c * SIDES + s]--;
}

// A shot takes cube i: no other shot will aim at it, and it stays where it is until the shot lands.
function take(st, i) {
  unlist(st, i);
  st.taken[i] = 1;
  st.rev++;
}

// True while cube i is in sight from some side (a cube a shot has already taken counts too).
export const isExposed = (st, i) => st.cells[i] > 0 && st.side[i] !== 0;

// Removes one cube and brings into sight the cube behind it along every line it was first on.
// Returns its colour.
export function removeCube(st, i) {
  const c = st.cells[i] - 1;
  if (c < 0) return -1;
  unlist(st, i);
  st.rev++;
  st.cells[i] = 0;
  st.taken[i] = 0;
  st.remaining[c]--;
  st.cleared++;
  st.h1 ^= st.zob[0][i]; st.h2 ^= st.zob[1][i];
  const bits = st.side[i];
  st.side[i] = 0;
  if (bits) {
    const { sx, sy } = st;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (let s = 0; s < SIDES; s++) {
      if (!(bits & (1 << s))) continue;
      const [dx, dy, dz] = SIDE_N[s];
      const j = along(st, x - dx, y - dy, z - dz, -dx, -dy, -dz);
      if (j >= 0) show(st, j, s);
    }
  }
  return c;
}

// ---------- the view: what the camera sees ----------
// The rules look from the middle of the turntable's step of VIEW_STEP (about 5.6 degrees) it is in,
// so what is in view changes 64 times a turn, not every tick, and is worked out once for each.
export const VIEW_STEP = 128;
const viewKey = st => Math.floor(st.yaw / VIEW_STEP) * PITCH_STEPS + st.pitch;

// The camera's direction seen from the sculpture, in the grid's own frame: the turntable turned by
// yaw (three.js turns the sculpture by rotation.y = yaw, js/render.js), the camera pitch above level.
export function viewDir(st) {
  if (st._dk === viewKey(st)) return st._dir;
  const a = yawRad(Math.floor(st.yaw / VIEW_STEP) * VIEW_STEP + VIEW_STEP / 2), p = pitchRad(st.pitch);
  const cp = Math.cos(p);
  st._dk = viewKey(st);
  st._dir = [-cp * Math.sin(a), Math.sin(p), cp * Math.cos(a)];
  return st._dir;
}

// The sides that face the camera now, one bit each (side s is bit s). The top always does.
export function viewMask(st) {
  const key = viewKey(st);
  if (st._mk === key) return st._mask;
  const v = viewDir(st);
  let m = 1 << 4;
  for (let s = 0; s < 4; s++) {
    const n = SIDE_N[s];
    if (n[0] * v[0] + n[2] * v[2] > FACING) m |= 1 << s;
  }
  st._mk = key; st._mask = m;
  return m;
}

// Cube i, in sight from a side facing the camera, has a clear line to the camera: walking from
// the middle of that side of it toward the camera (the side most turned to it, when it shows two),
// the line leaves the sculpture's grid without passing through another cube. A cube in sight from
// the front can still be hidden from a camera that looks at it from above or at a slant, by a part
// that sticks out or the walls of a pit; this is what tells.
export function clearView(st, i, m = viewMask(st)) {
  const bits = st.side[i] & m;
  if (!bits) return false;
  // Kept per cube for this step of the view and these sides in sight: a line once clear stays
  // clear (cubes only ever go), and a blocked one stays blocked while the cube that blocks it is
  // there.
  const key = viewKey(st) * 32 + bits + 1;
  if (st.clrKey[i] === key) {
    const b = st.clrBlock[i];
    if (b < 0 || st.cells[b]) return b < 0;
  }
  const b = blocker(st, i, bits);
  st.clrKey[i] = key; st.clrBlock[i] = b;
  return b < 0;
}

// The first cube on the line from cube i to the camera (see clearView); -1 when it is clear.
function blocker(st, i, bits) {
  const v = viewDir(st);
  let best = -1, dot = -Infinity;
  for (let s = 0; s < SIDES; s++) {
    if (!(bits & (1 << s))) continue;
    const n = SIDE_N[s];
    const d = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
    if (d > dot) { dot = d; best = s; }
  }
  const { sx, sy, sz, cells } = st;
  const n = SIDE_N[best];
  // Cell coordinates shifted by a half, so cell (x, y, z) spans [x, x + 1) on each axis.
  const px = (i % sx) + 0.5 + n[0] * 0.5 + v[0] * 1e-4;
  const py = (Math.floor(i / sx) % sy) + 0.5 + n[1] * 0.5 + v[1] * 1e-4;
  const pz = Math.floor(i / (sx * sy)) + 0.5 + n[2] * 0.5 + v[2] * 1e-4;
  let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  const stepX = v[0] > 0 ? 1 : -1, stepY = v[1] > 0 ? 1 : -1, stepZ = v[2] > 0 ? 1 : -1;
  const tdx = v[0] ? Math.abs(1 / v[0]) : Infinity, tdy = v[1] ? Math.abs(1 / v[1]) : Infinity, tdz = v[2] ? Math.abs(1 / v[2]) : Infinity;
  let tx = v[0] ? ((v[0] > 0 ? x + 1 - px : px - x) * tdx) : Infinity;
  let ty = v[1] ? ((v[1] > 0 ? y + 1 - py : py - y) * tdy) : Infinity;
  let tz = v[2] ? ((v[2] > 0 ? z + 1 - pz : pz - z) * tdz) : Infinity;
  for (let k = 0; k < sx + sy + sz + 3; k++) {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return -1;
    const j = x + sx * (y + sy * z);
    if (j !== i && cells[j]) return j;
    if (tx <= ty && tx <= tz) { x += stepX; tx += tdx; } else if (ty <= tz) { y += stepY; ty += tdy; } else { z += stepZ; tz += tdz; }
  }
  return -1;
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

// canReach: the crew member on this pad has something to hit once its side comes round, landed
// or not (what the screen shows as awake); canFire: it can shoot this tick (landed, and a cube of
// its colour faces the camera now).
export function canReach(st, slot) {
  const s = st.slots[slot];
  return !!s && s.count > 0 && st.exposed[s.color].size > 0;
}
export const canFire = (st, slot) => canReach(st, slot) && !(st.slots[slot].land > 0) && target(st, st.slots[slot].color) >= 0;

// The cube a crew member of colour c would hit now under the targeting rule; -1 when none: of the
// cubes in sight from a side facing the camera, the first in the targeting order with a clear line
// to the camera (clearView). Only when crew have waited a whole turn of the turntable with nothing
// in view at all (st.quiet over STALL: the colour is under a part that sticks out, or down a pit)
// does a shot take the first of them that is hidden; the player can turn and tilt the sculpture to
// bring one into view sooner. Worked out once for each step of the view and each change to the
// board (st.rev), since a pad asks every tick.
export function target(st, c) {
  if (st.blind) { // the forecast's board: in view or not, every side comes round in the end
    let best = -1, rank = Infinity;
    for (const i of st.exposed[c]) if (st.order[i] < rank) { rank = st.order[i]; best = i; }
    return best;
  }
  const key = viewKey(st) * 2 ** 28 + (st.rev % 2 ** 26) * 2 + (st.quiet > STALL ? 1 : 0);
  if (st.aimKey[c] === key) return st.aimCell[c];
  const m = viewMask(st), order = st.order, side = st.side;
  let pick = -1, rank = Infinity, any = -1, anyRank = Infinity;
  for (const i of st.exposed[c]) {
    if (!(side[i] & m)) continue;
    const o = order[i];
    if (o < anyRank) { anyRank = o; any = i; }
    if (o < rank && clearView(st, i, m)) { rank = o; pick = i; }
  }
  if (pick < 0 && st.quiet > STALL) pick = any;
  st.aimKey[c] = key; st.aimCell[c] = pick;
  return pick;
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
  take(st, cell);
  s.count--;
  const flight = { cell, at: st.tick + FLIGHT, from: st.tick, slot, color: s.color, id: s.id };
  st.flying.push(flight);
  const freed = s.count <= 0;
  if (freed) st.slots[slot] = null;
  return { slot, shooter: s, cell, freed, flight };
}

// A shot lands: its cube goes and the cubes behind it open up.
export const land = (st, cell) => removeCube(st, cell);

// One tick: the turntable turns by st.spin, the shots due now land (in the order they left), crew
// still landing on a pad come one tick closer, then every pad that can fire sends one shot, pad by
// pad from the left. Returns what happened, for the screen.
export function step(st) {
  st.tick++;
  st.yaw = turned(st.yaw, st.spin);
  if (st.spin) { // turning on its own: the camera looks for what the crew wait for (SEEK)
    const want = st.quiet < SEEK ? st.home : st.quiet < SEEK + LOOK ? HIGH : LOW;
    if (st.pitch < want) st.pitch++; else if (st.pitch > want) st.pitch--;
  }
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
  // How long crew on the pads have waited with nothing of theirs in view (target()).
  if (shots.length || landed.length) st.quiet = 0;
  else if (st.slots.some(s => s && s.count > 0 && !(s.land > 0) && st.exposed[s.color].size)) st.quiet++;
  else st.quiet = 0;
  return { landed, shots };
}

export const busy = st => st.flying.length > 0 || st.slots.some((_, i) => canReach(st, i));

// The turntable's position after turning by `by` steps.
export const turned = (yaw, by) => (((yaw + by) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;

// Runs ticks until every shot has landed and nothing on a pad has anything left in sight: what a
// player who waits sees. The turntable turns on its own meanwhile (a board held still is let go).
export function settle(st) {
  if (!st.spin) st.spin = TURN;
  let quiet = 0;
  while (busy(st)) {
    const r = step(st);
    if (r.shots.length || r.landed.length) quiet = 0;
    else if (++quiet > 2 * STALL) break;
  }
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

// How fast the next tick runs, 1 or FAST, with `down` true while a finger (or a mouse button) is
// down. The game (js/main.js tick()) and the timed test players (tools/players.mjs) both ask this
// before every tick. Normal speed while a finger is down, and while any crew member is still
// landing, so its flight up to the pad (120 ms) always ends before its first shot; otherwise FAST
// while there is nothing to send (every pad taken, or every line empty); otherwise normal speed,
// however long the player takes to choose.
export function pace(st, down = false) {
  if (down || st.slots.some(s => s && s.land > 0)) return 1;
  return freeSlot(st) < 0 || st.columns.every(c => !c.length) ? FAST : 1;
}

// Nothing would change in a tick but the clock: no shot in the air, nobody landing, nothing that
// can fire.
const idle = st => !st.flying.length && st.slots.every(s => !s || (!(s.land > 0) && !(s.count > 0 && st.exposed[s.color].size)));

// Runs the game's ticks until st.tick is `tick` (a quiet board skips straight there, the
// turntable turning as it would).
export function advance(st, tick) {
  while (st.tick < tick) {
    if (idle(st)) {
      const dt = tick - st.tick;
      st.yaw = turned(st.yaw, st.spin * dt);
      if (st.spin) st.pitch += Math.sign(st.home - st.pitch) * Math.min(dt, Math.abs(st.home - st.pitch)); // as step() does
      st.quiet = 0;
      st.tick = tick;
      break;
    }
    tickGame(st);
  }
  return st;
}

// Sets the view (see the top of this file) on a board; false when it is no view at all. The pitch
// set is the one the camera comes back to after looking around (st.home).
export function setView(st, yaw, pitch, spin) {
  if (![yaw, pitch, spin].every(Number.isSafeInteger) || yaw < 0 || yaw >= YAW_STEPS || pitch < 0 || pitch >= PITCH_STEPS || spin < 0 || spin > MAX_SPIN) return false;
  st.yaw = yaw; st.pitch = pitch; st.spin = spin; st.home = pitch;
  return true;
}

// What sending the front of line `col` now would do if no more crew were sent after it: the
// rules run on a copy of the board, with the crew already on the pads, the shots in the air,
// the landing pause and the one targeting rule, as if every side were in view (st.blind: where
// the board ends up once the turntable has brought every side round, whatever the view does on
// the way, and quick to work out), until that crew member has sent its last shot
// (it finishes and frees its pad) or nothing can fire any more (it parks, with `left` shots), and
// until every crew member already on a pad that would finish without this send has finished or
// is stuck. Those stuck are `strands`: [{ id, color, left }], pad by pad, the crew this send
// leaves parked that would otherwise have finished. `base` is fates(st), when already known (it
// holds from one send to the next). null when it cannot be sent now (the line is empty or every
// pad is taken).
export function forecast(st, col, land = 0, base = null) {
  const sim = cloneBoard(st);
  sim.blind = true; // where the board ends up once every side has come round (target())
  const d = deploy(sim, col, land);
  if (!d) return null;
  const me = d.shooter;
  const onPads = sim.slots.filter(s => s && s !== me);
  if (onPads.length && !base) base = fates(st);
  const watch = onPads.filter(s => base.get(s.id) === 0);
  let mine = null, quiet = 0;
  for (;;) {
    const moving = busy(sim) && quiet <= 2 * STALL;
    if (!mine && sim.slots[d.slot] !== me) mine = { finishes: true, left: 0 };
    if (!mine && !moving) mine = { finishes: false, left: me.count };
    if (mine && (!moving || watch.every(s => !sim.slots.includes(s)))) break;
    const r = tickGame(sim);
    if (r.shots.length || r.landed.length) quiet = 0; else quiet++;
  }
  mine.strands = watch.filter(s => sim.slots.includes(s)).map(s => ({ id: s.id, color: s.color, left: s.count }));
  return mine;
}

// A forecast in one word for comparing two of them: 'done' for a send that finishes and strands
// nobody, otherwise what is left parked.
export const forecastKey = f => (!f ? 'full' : !f.strands.length && f.finishes ? 'done' : `${f.left}|${f.strands.map(s => `${s.id}.${s.left}`).join(',')}`);

// What becomes of each crew member already on a pad if nothing else is sent: the rules run on a
// copy of the board, every side in view (as forecast() does), until nothing moves. A Map from crew id to the shots it is left with when it
// parks, 0 when it finishes and frees its pad. One run answers every pad, and the answer holds
// until the next send or undo, since nothing else changes where the board is going. This is how
// a crew member that a later send has robbed shows it at once, before it runs dry.
export function fates(st) {
  const sim = cloneBoard(st);
  sim.blind = true;
  const onPads = sim.slots.filter(Boolean);
  let quiet = 0;
  while (busy(sim) && quiet <= 2 * STALL) {
    const r = tickGame(sim);
    if (r.shots.length || r.landed.length) quiet = 0; else quiet++;
  }
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
// `views` holds every change the player made to the view, [tick, yaw, pitch, spin], and `marks`
// how many of them came before each send, so a replay turns the sculpture the same way and hits
// the same cubes. restore() rebuilds all of it from save(), which is what the game keeps in the
// browser's storage.
export const MAX_VIEWS = 100000;
export class Attempt {
  constructor(board) {
    this.board = board;
    this.sends = [];
    this.checks = [];
    this.before = [];
    this.views = [];
    this.marks = [];
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
    this.marks.push(this.views.length);
    return d;
  }

  // The player turns or tilts the sculpture, or holds it or lets it go (spin): the board takes the
  // new view now, and it is kept for a replay. A change at the same tick as the last one, with no
  // send between them, replaces it. False when nothing changed or it is no view.
  view(yaw, pitch, spin) {
    const b = this.board;
    if (b.yaw === yaw && b.pitch === pitch && b.spin === spin) return false;
    if (!setView(b, yaw, pitch, spin)) return false;
    const e = [b.tick, yaw, pitch, spin];
    const last = this.views[this.views.length - 1];
    if (last && last[0] === b.tick && this.views.length > (this.marks[this.marks.length - 1] || 0)) this.views[this.views.length - 1] = e;
    else if (this.views.length < MAX_VIEWS) this.views.push(e);
    return true;
  }

  // The board as it was just before the last send: cubes, lines, pads, shots in the air, clock.
  // The view goes back with it; the game sets the view the player has now again (view()).
  undo() {
    if (!this.before.length) return false;
    this.board = this.before.pop();
    this.sends.pop();
    this.checks.pop();
    this.views.length = this.marks.pop();
    this.undos++;
    return true;
  }

  // Plain data for storage: the sends with their checks, the view changes, the undos so far, and
  // the tick the board is at now with its check, so restore() can bring back the board as it is at
  // this moment.
  save() {
    return {
      sends: this.sends.map(s => s.slice()), checks: this.checks.map(c => c.slice()),
      views: this.views.map(v => v.slice()), marks: this.marks.slice(),
      undos: this.undos, at: this.board.tick, end: checkOf(this.board),
    };
  }

  // Plays `sends` on a fresh copy of `start` with the game's own ticks, turning the sculpture as
  // `views` says (`marks[k]` of them before send k), and returns the attempt as it stood just after
  // the last send, or null when they do not fit the board. With `checks`, every send must also leave
  // the board its check says, or it is null. The views after the last send are left for restore().
  static replay(start, sends, land = 0, checks = null, views = [], marks = null) {
    if (!Array.isArray(sends) || (checks && (!Array.isArray(checks) || checks.length !== sends.length))) return null;
    if (!okViews(views) || (marks !== null && !okMarks(marks, sends.length, views.length))) return null;
    const a = new Attempt(cloneBoard(start));
    let v = 0;
    for (let k = 0; k < sends.length; k++) {
      const s = sends[k];
      if (!Array.isArray(s) || s.length !== 2 || !Number.isSafeInteger(s[0]) || !Number.isSafeInteger(s[1])) return null;
      if (s[1] < a.board.tick || s[1] > MAX_TICK) return null;
      const upTo = marks ? marks[k] : 0;
      if (!a.playViews(views, v, upTo, s[1])) return null;
      v = upTo;
      advance(a.board, s[1]);
      if (!a.send(s[0], land)) return null; // a line that is not there or is empty, or no free pad
      if (checks && !sameCheck(a.checks[k], checks[k])) return null;
    }
    a.rest = v;
    return a;
  }

  // Applies views[from..to) in order, each at its tick, none later than `limit`; false when they
  // do not fit (a tick before the board's, or after `limit`).
  playViews(views, from, to, limit = MAX_TICK) {
    for (let k = from; k < to; k++) {
      const e = views[k];
      if (e[0] < this.board.tick || e[0] > limit) return false;
      advance(this.board, e[0]);
      if (!this.view(e[1], e[2], e[3]) && !(this.board.yaw === e[1] && this.board.pitch === e[2] && this.board.spin === e[3])) return false;
    }
    return true;
  }

  // The attempt a save() describes, with the board at the tick it was left at, or null when the
  // save is broken or does not fit this board: every field is checked, every tick bounded, and
  // each send's check and the last one must come out the same.
  static restore(start, save, land = 0) {
    if (!save || typeof save !== 'object') return null;
    const { sends, checks, undos, at, end } = save;
    const views = save.views === undefined ? [] : save.views;
    const marks = save.marks === undefined ? (Array.isArray(sends) ? sends.map(() => 0) : null) : save.marks;
    if (!Number.isSafeInteger(undos) || undos < 0 || undos > MAX_UNDOS) return null;
    if (!Number.isSafeInteger(at) || at < 0 || at > MAX_TICK) return null;
    const a = Attempt.replay(start, sends, land, checks || [], views, marks);
    if (!a || at < a.board.tick) return null;
    if (!a.playViews(views, a.rest, views.length, at)) return null;
    delete a.rest;
    advance(a.board, at);
    if (!sameCheck(checkOf(a.board), end)) return null;
    a.undos = undos;
    return a;
  }
}

// A list of view changes as save() writes it: [tick, yaw, pitch, spin], ticks never going back.
function okViews(views) {
  if (!Array.isArray(views) || views.length > MAX_VIEWS) return false;
  let t = 0;
  for (const e of views) {
    if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isSafeInteger)) return false;
    if (e[0] < t || e[0] > MAX_TICK) return false;
    if (e[1] < 0 || e[1] >= YAW_STEPS || e[2] < 0 || e[2] >= PITCH_STEPS || e[3] < 0 || e[3] > MAX_SPIN) return false;
    t = e[0];
  }
  return true;
}
// One mark per send, never going back, none past the end of the views.
function okMarks(marks, n, views) {
  if (!Array.isArray(marks) || marks.length !== n) return false;
  let m = 0;
  for (const k of marks) {
    if (!Number.isSafeInteger(k) || k < m || k > views) return false;
    m = k;
  }
  return true;
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
