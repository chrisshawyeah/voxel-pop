// The rules of the game, with no DOM and no three.js, so the tests run them in Node.
// A board is a voxel grid of colour indices (0 = empty, c+1 = colour c), y pointing up.
// The crew hit only cubes the player can see. A cube is on the outside while one of its faces
// touches the outside air (the turntable under the sculpture is not air, and nor is air sealed in
// a hollow until a cube between it and the outside goes). It can be hit while such a face is
// turned well towards the camera and a fair part of that face has a clear straight line to the
// camera, nothing of the sculpture or the turntable in between: what the player sees, from
// wherever the camera looks, the top, the sides, at a slant into a notch, or from below. So the
// crew eat the sculpture from the outside in, and a colour hidden inside waits until the cubes
// covering it go. A cube the camera cannot see is never hit, however long the crew wait.
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
export const RULES = 7;
// The view (see the top of this file). A turn of the turntable is YAW_STEPS steps; on its own it
// turns TURN steps a tick (about 0.41 radians a second, a turn in 15 seconds at normal speed). The
// camera looks from PITCH_MIN to PITCH_MAX radians above level in PITCH_STEPS steps: from well
// below the turntable (it hides what stands on it) to almost straight down, so with the turn the
// player can look at the sculpture from every direction.
export const YAW_STEPS = 4096;
export const TURN = 9;
export const PITCH_STEPS = 96;
export const PITCH_MIN = -1.35;
export const PITCH_MAX = 1.5;
export const START_YAW = 391;   // about 0.6 radians: a level starts turned a little, so it reads as 3D
export const MAX_SPIN = 64;     // the most a saved view may turn a tick
export const yawRad = u => (u * 2 * Math.PI) / YAW_STEPS;
export const pitchRad = u => PITCH_MIN + (u * (PITCH_MAX - PITCH_MIN)) / (PITCH_STEPS - 1);
export const yawUnits = rad => ((Math.round((rad * YAW_STEPS) / (2 * Math.PI)) % YAW_STEPS) + YAW_STEPS) % YAW_STEPS;
export const pitchUnits = rad => Math.max(0, Math.min(PITCH_STEPS - 1, Math.round(((rad - PITCH_MIN) * (PITCH_STEPS - 1)) / (PITCH_MAX - PITCH_MIN))));
export const START_PITCH = pitchUnits(0.39); // about 22 degrees above level
// While the turntable turns on its own and crew on the pads have waited SEEK ticks with nothing
// of their colour in view, the camera swings round to the nearest view that shows a fair part of
// one of their cubes, or failing that a sliver of one (swing()), and they fire at it; the screen
// glides there in about a fifth of a second, while the shot flies. The camera goes back to the
// height the player left it at (st.home) once a shot flies. A shot never takes a cube the camera
// cannot see: crew whose colour shows from no view wait until the cubes covering it go (the player
// sends other crew), or until the player turns or tilts the sculpture to show it. The checks below
// call a board settled after twice STALL ticks with nothing fired or landed.
export const SEEK = 120;
export const STALL = 520;
// While it moves, the camera's height changes by SEEK_JUMP pitch steps every SEEK_STEP ticks (the
// screen glides between them).
const SEEK_STEP = 5, SEEK_JUMP = 2;
// The latest tick a saved attempt may name (about 90 hours of play at 30 ticks a second). Ticks
// stay whole numbers far below this, so tick + FLIGHT is always exact and every replay ends.
export const MAX_TICK = 1e7;
export const MAX_UNDOS = 1e6;

export const coords = (st, i) => [i % st.sx, Math.floor(i / st.sx) % st.sy, Math.floor(i / (st.sx * st.sy))];
export const index = (st, x, y, z) => x + st.sx * (y + st.sy * z);

// The one targeting rule, used by the game, the checks and the test players alike: of the cubes
// a crew member can hit now (seen by the camera, seen()), it takes the highest one
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

// The quick check first: a cube is plainly in view when it is the first cube along a straight
// line of the grid coming in from a side (front, back, left, right or the top), that side is
// turned to the camera (SIDE_FACING), and the line from the middle of that side of it to the camera
// is clear. Most shots find their cube this way.
const SIDES = 5;
const SIDE_N = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
const SIDE_FACING = 0.3;
// st.out[i] is 1 when cell i is on the outside: an empty cell that is outside air (joined to the
// space around the grid), or a cube with a face on that air. It only ever turns from 0 to 1, so a
// cube that goes leaves a gap with the same mark. st.taken[i] is 1 while a shot is on its way to
// cube i. st.exposed[c] holds the cubes of colour c on the outside that no shot has taken yet: the
// ones a crew member of that colour can hit once the camera sees them (canReach). st.reachR and
// st.tableR are how far the sculpture and the turntable reach from the middle of the grid, and
// st.topY how high the sculpture stands, in cells (as js/render.js draws them).
export function makeBoard(model) {
  const { sx, sy, sz, palette } = model;
  const cells = Uint8Array.from(model.cells);
  const n = palette.length;
  let reachR = 1, topY = 1;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    reachR = Math.max(reachR, Math.hypot(x - (sx - 1) / 2, z - (sz - 1) / 2) + 0.75);
    topY = Math.max(topY, y + 1);
  }
  const st = {
    sx, sy, sz, cells, palette,
    order: targetOrder(sx, sy, sz), zob: zobrist(cells.length), h1: 0, h2: 0,
    out: new Uint8Array(cells.length), taken: new Uint8Array(cells.length), side: new Uint8Array(cells.length),
    qKey: new Int32Array(cells.length).fill(-1), qBlock: new Int32Array(cells.length),
    fKey: new Int32Array(cells.length).fill(-1), fN: new Uint8Array(cells.length), fBlock: new Int32Array(cells.length * F_KEEP), fRev: new Int32Array(cells.length),
    tableR: reachR + 0.5, reachR, topY,
    remaining: new Int32Array(n),
    exposed: Array.from({ length: n }, () => new Set()),
    byOrder: Array.from({ length: n }, () => []), sorted: new Uint8Array(n).fill(1),
    total: 0, cleared: 0,
    tick: 0, flying: [],
    yaw: START_YAW, pitch: START_PITCH, spin: TURN, home: START_PITCH,
    rev: 0, quiet: 0, aimKey: new Float64Array(n).fill(-1), aimCell: new Int32Array(n),
    // The camera's swing for crew who wait (step()): the height it swung to, whether a sliver will
    // do, the search known to find nothing, how far back the camera stands at each height, and
    // how many more ticks the view holds still while the shot it swung for flies.
    seekH: -2, sliver: false, swingMiss: '', camD: new Float64Array(PITCH_STEPS).fill(-1), hold: 0,
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
      if ((dx > 0 && x !== sx - 1) || (dx < 0 && x !== 0) || (dy > 0 && y !== sy - 1) || (dz > 0 && z !== sz - 1) || (dz < 0 && z !== 0)) continue;
      const j = along(st, x, y, z, -dx, -dy, -dz);
      if (j >= 0) st.side[j] |= 1 << s;
    }
  }
  // Every cell on a side or the top of the grid touches the space around it; the air spreads in
  // from there. The bottom layer stands on the turntable, which is not air.
  const air = [];
  for (let i = 0; i < cells.length; i++) {
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    if (x && z && x < sx - 1 && z < sz - 1 && y < sy - 1) continue;
    if (reach(st, i)) air.push(i);
  }
  for (const i of air) letAirIn(st, i);
  return st;
}

export function cloneBoard(st) {
  return {
    ...st,
    cells: Uint8Array.from(st.cells),
    out: Uint8Array.from(st.out),
    taken: Uint8Array.from(st.taken), side: Uint8Array.from(st.side),
    qKey: Int32Array.from(st.qKey), qBlock: Int32Array.from(st.qBlock),
    fKey: Int32Array.from(st.fKey), fN: Uint8Array.from(st.fN), fBlock: Int32Array.from(st.fBlock), fRev: Int32Array.from(st.fRev),
    aimKey: Float64Array.from(st.aimKey), aimCell: Int32Array.from(st.aimCell),
    memo: null, memoRev: -1,
    remaining: Int32Array.from(st.remaining),
    exposed: st.exposed.map(s => new Set(s)),
    byOrder: st.byOrder.map(a => a.slice()), sorted: Uint8Array.from(st.sorted),
    flying: st.flying.slice(),
    columns: st.columns.map(col => col.map(s => ({ ...s }))),
    slots: st.slots.map(s => (s ? { ...s } : null)),
  };
}

// The outside air reaches cell i: a cube there is now on the outside; an empty cell becomes air.
// True when it was an empty cell not yet reached (the air goes on through it).
function reach(st, i) {
  if (st.out[i]) return false;
  st.out[i] = 1;
  const c = st.cells[i];
  if (c) { if (!st.taken[i]) list(st, c - 1, i); return false; }
  return true;
}

// Cube i of colour c joins the cubes a crew member of that colour may pick. st.byOrder[c] holds
// them in the targeting order (with cubes since taken or gone left in, skipped by target()), sorted
// again only when a cube has joined since.
function list(st, c, i) {
  st.exposed[c].add(i);
  st.byOrder[c].push(i);
  st.sorted[c] = 0;
}

// Cell i has just become outside air: it opens the cubes beside it, and the air runs on into any
// sealed hollow it joins, opening that hollow's walls too.
const todo = [];
function letAirIn(st, i) {
  const { sx, sy, sz } = st, layer = sx * sy;
  todo.push(i);
  while (todo.length) {
    const j = todo.pop();
    const x = j % sx, y = Math.floor(j / sx) % sy, z = Math.floor(j / layer);
    if (x > 0 && reach(st, j - 1)) todo.push(j - 1);
    if (x < sx - 1 && reach(st, j + 1)) todo.push(j + 1);
    if (y > 0 && reach(st, j - sx)) todo.push(j - sx);
    if (y < sy - 1 && reach(st, j + sx)) todo.push(j + sx);
    if (z > 0 && reach(st, j - layer)) todo.push(j - layer);
    if (z < sz - 1 && reach(st, j + layer)) todo.push(j + layer);
  }
}

// A shot takes cube i: no other shot will aim at it, and it stays where it is until the shot lands.
function take(st, i) {
  st.exposed[st.cells[i] - 1].delete(i);
  st.taken[i] = 1;
  st.rev++;
}

// True while cube i is on the outside (a cube a shot has already taken counts too).
export const isExposed = (st, i) => st.cells[i] > 0 && st.out[i] === 1;

// Removes one cube and lets the air into the gap, opening the cubes beside it. Returns its colour.
export function removeCube(st, i) {
  const c = st.cells[i] - 1;
  if (c < 0) return -1;
  st.exposed[c].delete(i);
  st.rev++;
  st.cells[i] = 0;
  st.taken[i] = 0;
  st.remaining[c]--;
  st.cleared++;
  st.h1 ^= st.zob[0][i]; st.h2 ^= st.zob[1][i];
  if (st.out[i]) letAirIn(st, i);
  // The cube behind it along every line it was first on is first now.
  const bits = st.side[i];
  st.side[i] = 0;
  if (bits) {
    const { sx, sy } = st;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (let s = 0; s < SIDES; s++) {
      if (!(bits & (1 << s))) continue;
      const [dx, dy, dz] = SIDE_N[s];
      const j = along(st, x - dx, y - dy, z - dz, -dx, -dy, -dz);
      if (j >= 0) st.side[j] |= 1 << s;
    }
  }
  return c;
}

// ---------- the view: what the camera sees ----------
// While the turntable turns, the rules look from the middle of the step of VIEW_STEP (about 2.8
// degrees) it is in, so what is in view changes 64 times a turn, not every tick, and is worked out
// once for each; the screen is never more than 1.4 degrees from the view the rules use. While the
// player holds it still they look from exactly where it stands.
export const VIEW_STEP = 64;
const yawKey = st => (st.spin ? Math.floor(st.yaw / VIEW_STEP) : YAW_STEPS / VIEW_STEP + st.yaw);
const viewYaw = st => (st.spin ? Math.floor(st.yaw / VIEW_STEP) * VIEW_STEP + VIEW_STEP / 2 : st.yaw);
const viewKey = st => yawKey(st) * PITCH_STEPS + st.pitch;

// The camera's direction seen from the sculpture, in the grid's own frame: the turntable turned by
// yaw (three.js turns the sculpture by rotation.y = yaw, js/render.js), the camera pitch above level
// (below it when pitch is negative).
export function viewDir(st) {
  if (st._dk === viewKey(st)) return st._dir;
  const a = yawRad(viewYaw(st)), p = pitchRad(st.pitch);
  const cp = Math.cos(p);
  st._dk = viewKey(st);
  st._dir = [-cp * Math.sin(a), Math.sin(p), cp * Math.cos(a)];
  return st._dir;
}

// Where the camera is, in grid units (cell (x, y, z) spans [x, x + 1) on each axis, the turntable's
// top is y = 0): placed the way js/render.js frames the sculpture and its turntable on a phone held
// upright (a stage CAM_ASPECT wide for its height, a CAM_FOV degree lens), from the middle of this
// step of the view. Lines of sight go to this point, so a part that sticks out hides what the
// screen shows it hiding, near the edges of the picture too.
const CAM_FOV = 14, CAM_ASPECT = 0.66;
export function camPos(st) {
  const key = viewKey(st);
  if (st._ck === key) return st._cam;
  st._ck = key;
  st._cam = camAt(st, viewYaw(st), st.pitch);
  return st._cam;
}

// Where the camera is for the view with the turntable turned `yaw` steps and the camera `pitch`
// steps high (camPos() is the board's own view). How far back it stands depends only on the height
// and the sculpture's size, which never change on a board, so it is worked out once per height.
function camAt(st, yaw, pitch) {
  const p = pitchRad(pitch), sp = Math.sin(p), cp = Math.cos(p);
  const a = yawRad(yaw);
  const ty = -0.6 + (st.topY + 0.6) * 0.46;
  if (!st.camD) st.camD = new Float64Array(PITCH_STEPS).fill(-1);
  let d = st.camD[pitch];
  if (d < 0) {
    const top = st.topY, rad = st.tableR, reachR = st.reachR;
    const tan = Math.tan((CAM_FOV * Math.PI) / 360), tanUp = tan * 0.92, tanDown = tan * 0.74, tanH = tan * CAM_ASPECT * 0.9;
    d = 0;
    const fit = (x, y, z) => {
      const dy = y - ty, depth = dy * sp + z * cp, up = dy * cp - z * sp;
      d = Math.max(d, depth + Math.abs(x) / tanH, depth + Math.abs(up) / (up > 0 ? tanUp : tanDown));
    };
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      fit(c * rad, -0.6, s * rad); fit(c * rad, 0, s * rad); fit(c * reachR, top, s * reachR);
    }
    st.camD[pitch] = d;
  }
  return [st.sx / 2 - cp * d * Math.sin(a), ty + sp * d, st.sz / 2 + cp * d * Math.cos(a)];
}

// The line from (cx, ., cz) in direction (dx, ., dz) crosses the turntable's top at distance t.
function onTable(st, cx, cz, dx, dz, t) {
  const hx = cx + dx * t - st.sx / 2, hz = cz + dz * t - st.sz / 2;
  return hx * hx + hz * hz < st.tableR * st.tableR;
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

// The sides turned to the camera now, one bit each (side s is bit s).
function sideMask(st) {
  const key = viewKey(st);
  if (st._smk === key) return st._smask;
  const v = viewDir(st);
  let m = 0;
  for (let s = 0; s < SIDES; s++) {
    const n = SIDE_N[s];
    if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > SIDE_FACING) m |= 1 << s;
  }
  st._smk = key; st._smask = m;
  return m;
}

// The quick check (see SIDES above): kept per cube for this view and these sides; a clear line
// stays clear, and a blocked one stays blocked while the cube that blocks it is there.
function plainView(st, i, m) {
  const bits = st.side[i] & m;
  if (!bits) return false;
  const key = viewKey(st) * 32 + bits;
  if (st.qKey[i] === key) {
    const b = st.qBlock[i];
    if (b < 0 || (b >= 0 && st.cells[b])) return b === -1;
  }
  const v = viewDir(st);
  let best = 0, dot = -Infinity;
  for (let s = 0; s < SIDES; s++) {
    if (!(bits & (1 << s))) continue;
    const n = SIDE_N[s], d = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
    if (d > dot) { dot = d; best = s; }
  }
  const n = SIDE_N[best], C = camPos(st), { sx, sy } = st;
  const px = (i % sx) + 0.5 + n[0] * 0.5, py = (Math.floor(i / sx) % sy) + 0.5 + n[1] * 0.5, pz = Math.floor(i / (sx * sy)) + 0.5 + n[2] * 0.5;
  const wx = C[0] - px, wy = C[1] - py, wz = C[2] - pz, L = Math.hypot(wx, wy, wz);
  const b = lineFrom(st, i, px, py, pz, wx / L, wy / L, wz / L);
  st.qKey[i] = key; st.qBlock[i] = b;
  return b === -1;
}

// The first cube on the line from point (qx, qy, qz) of cube i's surface in direction v: its
// index, -2 for the turntable, or -1 when the line leaves clear.
function lineFrom(st, i, qx, qy, qz, vx, vy, vz) {
  const { sx, sy, sz, cells } = st;
  const px = qx + vx * 1e-4, py = qy + vy * 1e-4, pz = qz + vz * 1e-4;
  let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  const stepX = vx > 0 ? 1 : -1, stepY = vy > 0 ? 1 : -1, stepZ = vz > 0 ? 1 : -1;
  const tdx = vx ? Math.abs(1 / vx) : Infinity, tdy = vy ? Math.abs(1 / vy) : Infinity, tdz = vz ? Math.abs(1 / vz) : Infinity;
  let tx = vx ? ((vx > 0 ? x + 1 - px : px - x) * tdx) : Infinity;
  let ty = vy ? ((vy > 0 ? y + 1 - py : py - y) * tdy) : Infinity;
  let tz = vz ? ((vz > 0 ? z + 1 - pz : pz - z) * tdz) : Infinity;
  for (let k = 0; k < sx + sy + sz + 3; k++) {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) break;
    const j = x + sx * (y + sy * z);
    if (j !== i && cells[j]) return j;
    if (tx <= ty && tx <= tz) { x += stepX; tx += tdx; } else if (ty <= tz) { y += stepY; ty += tdy; } else { z += stepZ; tz += tdz; }
  }
  return vy < 0 && onTable(st, px, pz, vx, vz, py / -vy) ? -2 : -1;
}

// Cube i can be seen from the camera now: the quick check, or the middle of one of its faces on the
// outside air, turned to the camera, has a clear line to it.
export function seen(st, i) {
  return st.cells[i] > 0 && (plainView(st, i, sideMask(st)) || faceView(st, i));
}

// The faces of cube i on the outside air (its neighbour that way is outside the grid or outside
// air; below the bottom layer is the turntable), one bit each in FACE_N's order.
const FACE_N = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
const FACE_FACING = 0.3; // turned less than about 72 degrees from the camera: edge-on is a sliver
// The points of a face whose lines to the camera are tried: its middle and near its four corners,
// so a face half under a part that sticks out still counts.
const FACE_POINTS = [[0, 0], [0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]];
// How many of the cubes that blocked those lines a cube keeps; with more than that, it is looked
// at again whenever any cube goes.
const F_KEEP = 8;
function openFaces(st, i) {
  const { sx, sy, sz, cells, out } = st;
  const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
  const open = j => !cells[j] && out[j];
  let m = 0;
  if (x === sx - 1 || open(i + 1)) m |= 1;
  if (x === 0 || open(i - 1)) m |= 2;
  if (z === sz - 1 || open(i + sx * sy)) m |= 4;
  if (z === 0 || open(i - sx * sy)) m |= 8;
  if (y === sy - 1 || open(i + sx)) m |= 16;
  if (y > 0 && open(i - sx)) m |= 32;
  return m;
}

// Some face of cube i on the outside air is turned to the camera and the lines from at least
// FACE_NEED of its points to the camera are clear: a fair part of it shows, not a sliver at an
// edge. Only when no view shows a fair part of any cube the waiting crew can hit does the camera
// swing to one that shows a sliver, and then one clear line does (st.sliver, swing()), so a cube
// that only ever shows a sliver can still be hit; a cube with no clear line at all never is. Kept per cube for this view, these faces and that need:
// clear stays clear, and blocked stays blocked while every cube that blocked a line is still there.
const FACE_NEED = 2;
function faceView(st, i) {
  const open = openFaces(st, i);
  if (!open) return false;
  const need = st.sliver ? 1 : FACE_NEED;
  const key = (viewKey(st) * 64 + open) * 2 + need - 1;
  const base = i * F_KEEP;
  if (st.fKey[i] === key) {
    const k = st.fN[i];
    if (k === 255) return true;
    let still = k <= F_KEEP || st.fRev[i] === st.rev;
    for (let q = 0; q < k && q < F_KEEP && still; q++) { const b = st.fBlock[base + q]; if (b >= 0 && !st.cells[b]) still = false; }
    if (still) return false;
  }
  st.fKey[i] = key; st.fRev[i] = st.rev;
  const C = camPos(st), { sx, sy } = st;
  const cx = (i % sx) + 0.5, cy = (Math.floor(i / sx) % sy) + 0.5, cz = Math.floor(i / (sx * sy)) + 0.5;
  let k = 0;
  for (let f = 0; f < 6; f++) {
    if (!(open & (1 << f))) continue;
    const n = FACE_N[f];
    const fx = cx + n[0] * 0.5, fy = cy + n[1] * 0.5, fz = cz + n[2] * 0.5;
    const ox = C[0] - fx, oy = C[1] - fy, oz = C[2] - fz;
    if (n[0] * ox + n[1] * oy + n[2] * oz <= FACE_FACING * Math.hypot(ox, oy, oz)) continue;
    const ax = n[0] ? 0 : n[1] ? 1 : 2; // the face's edges run along the other two axes
    let clear = 0;
    for (let q = 0; q < FACE_POINTS.length; q++) {
      const a = FACE_POINTS[q][0], b2 = FACE_POINTS[q][1];
      const px = fx + (ax === 1 ? b2 : ax === 2 ? a : 0), py = fy + (ax === 2 ? b2 : ax === 0 ? a : 0), pz = fz + (ax === 0 ? b2 : ax === 1 ? a : 0);
      const wx = C[0] - px, wy = C[1] - py, wz = C[2] - pz, L = Math.hypot(wx, wy, wz);
      const b = lineFrom(st, i, px, py, pz, wx / L, wy / L, wz / L);
      if (b === -1) { if (++clear >= need) { st.fN[i] = 255; return true; } continue; }
      if (k < F_KEEP) st.fBlock[base + k] = b;
      k++;
    }
  }
  st.fN[i] = k;
  return false;
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

// canReach: the crew member on this pad has something to hit once the camera sees it, landed
// or not (what the screen shows as awake); canFire: it can shoot this tick (landed, and a cube of
// its colour faces the camera now).
export function canReach(st, slot) {
  const s = st.slots[slot];
  return !!s && s.count > 0 && st.exposed[s.color].size > 0;
}
export const canFire = (st, slot) => canReach(st, slot) && !(st.slots[slot].land > 0) && target(st, st.slots[slot].color) >= 0;

// The cube a crew member of colour c would hit now under the targeting rule; -1 when none: of the
// cubes on the outside with a face turned to the camera, the first in the targeting order with a clear line
// to the camera (seen()). A cube the camera cannot see is never taken: crew whose colour is all
// hidden wait, while the camera looks around (step()) or the player turns and tilts the sculpture
// to bring one into view. Worked out once for each step of the view and each change to the board
// (st.rev), since a pad asks every tick.
export function target(st, c) {
  const key = viewKey(st) * 2 ** 27 + (st.rev % 2 ** 25) * 2 + (st.sliver ? 1 : 0);
  if (st.aimKey[c] === key) return st.aimCell[c];
  // While the board stays as it is, the turntable brings the same views round again: what each
  // colour can hit from each is kept until something on the board changes (st.rev).
  if (st.memoRev !== st.rev || !st.memo) { st.memo = new Map(); st.memoRev = st.rev; }
  const mk = (viewKey(st) * 2 + (st.sliver ? 1 : 0)) * 64 + c;
  const known = st.memo.get(mk);
  if (known !== undefined) { st.aimKey[c] = key; st.aimCell[c] = known; return known; }
  const pick = aim(st, c);
  st.memo.set(mk, pick);
  st.aimKey[c] = key; st.aimCell[c] = pick;
  return pick;
}

function aim(st, c) {
  const order = st.order, set = st.exposed[c];
  let list = st.byOrder[c];
  if (!st.sorted[c] || list.length > 2 * set.size + 16) {
    list = st.byOrder[c] = [...set].sort((a, b) => order[a] - order[b]);
    st.sorted[c] = 1;
  }
  // The quick check first; only when it finds nothing, every face.
  const m = sideMask(st);
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    if (set.has(i) && plainView(st, i, m)) return i;
  }
  // Then any face of a cube on the outside air turned to the camera with a fair part of it in
  // clear sight of the camera: a cube seen at a slant, into a notch or from below.
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    if (set.has(i) && faceView(st, i)) return i;
  }
  return -1;
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

// Face f of cube i (FACE_N's order) shows from the camera at C: turned to it, and `need` of
// FACE_POINTS in clear sight, as faceView() asks of the board's own view.
function faceShows(st, i, f, C, need) {
  const { sx, sy } = st, n = FACE_N[f];
  const fx = (i % sx) + 0.5 + n[0] * 0.5, fy = (Math.floor(i / sx) % sy) + 0.5 + n[1] * 0.5, fz = Math.floor(i / (sx * sy)) + 0.5 + n[2] * 0.5;
  const ox = C[0] - fx, oy = C[1] - fy, oz = C[2] - fz;
  if (n[0] * ox + n[1] * oy + n[2] * oz <= FACE_FACING * Math.hypot(ox, oy, oz)) return false;
  const ax = n[0] ? 0 : n[1] ? 1 : 2;
  let clear = 0;
  for (let q = 0; q < FACE_POINTS.length; q++) {
    const a = FACE_POINTS[q][0], b2 = FACE_POINTS[q][1];
    const px = fx + (ax === 1 ? b2 : ax === 2 ? a : 0), py = fy + (ax === 2 ? b2 : ax === 0 ? a : 0), pz = fz + (ax === 0 ? b2 : ax === 1 ? a : 0);
    const wx = C[0] - px, wy = C[1] - py, wz = C[2] - pz, L = Math.hypot(wx, wy, wz);
    if (lineFrom(st, i, px, py, pz, wx / L, wy / L, wz / L) === -1 && ++clear >= need) return true;
  }
  return false;
}

const SWING_CUBES = 3, SWING_STEP = 2;
// The cubes the crew on the pads wait for, as [cube, face, ...] for each open face, up to `most`
// cubes of each colour.
function waitedFaces(st, most) {
  const faces = [];
  for (const s of st.slots) {
    if (!s || !(s.count > 0) || s.land > 0) continue;
    let k = 0;
    for (const i of st.exposed[s.color]) {
      const open = openFaces(st, i);
      for (let f = 0; f < 6; f++) if (open & (1 << f)) faces.push(i, f);
      if (++k >= most) break;
    }
  }
  return faces;
}
// The heights in pitch steps, nearest the camera's own first.
function* heights(st, by) {
  yield st.pitch;
  for (let d = by; d < PITCH_STEPS; d += by) {
    if (st.pitch + d < PITCH_STEPS) yield st.pitch + d;
    if (st.pitch - d >= 0) yield st.pitch - d;
  }
}
// The nearest view, [turn, height], from which an open face of a cube the crew wait for shows
// with `need` of its points in clear sight; null when none does. Every other height is tried,
// nearest first, and at each every other step of the turn, nearest first, for SWING_CUBES of each
// colour's cubes. A search that found nothing finds nothing again while the board and the crew
// waiting stay the same, so that answer is kept.
function viewShowing(st, need) {
  const miss = `${need} ${st.rev} ${st.slots.map(s => (s && s.count > 0 && !(s.land > 0) ? s.color : -1)).join()}`;
  if (st.swingMiss === miss) return null;
  const faces = waitedFaces(st, SWING_CUBES);
  const here = Math.floor(st.yaw / VIEW_STEP), n = YAW_STEPS / VIEW_STEP;
  for (const u of faces.length ? heights(st, SWING_STEP) : []) {
    for (let k = 0; k < n; k += SWING_STEP) {
      const y = (((here + (k % 2 ? (k + 1) / 2 : -k / 2)) % n + n) % n) * VIEW_STEP + VIEW_STEP / 2;
      const C = camAt(st, y, u);
      for (let q = 0; q < faces.length; q += 2) if (faceShows(st, faces[q], faces[q + 1], C, need)) return [y, u];
    }
  }
  st.swingMiss = miss;
  return null;
}
// Crew have waited SEEK ticks with nothing of theirs in view: the camera swings to the nearest view
// that shows a fair part of a cube they wait for, else to one that shows a sliver (and a sliver
// will do, faceView()); when none shows from anywhere, the view stays as it is. The view then holds
// still for FLIGHT ticks (st.hold), so the cube still shows when the shot lands.
function swing(st) {
  for (const s of st.slots) if (s && s.count > 0 && !(s.land > 0) && target(st, s.color) >= 0) return;
  for (const need of [FACE_NEED, 1]) {
    const v = viewShowing(st, need);
    if (!v) continue;
    st.yaw = v[0]; st.pitch = v[1]; st.seekH = v[1]; st.hold = FLIGHT;
    if (need === 1) st.sliver = true;
    return;
  }
}

// One tick: the turntable turns by st.spin, the shots due now land (in the order they left), crew
// still landing on a pad come one tick closer, then every pad that can fire sends one shot, pad by
// pad from the left. Returns what happened, for the screen.
export function step(st) {
  st.tick++;
  if (st.hold > 0) st.hold--; // the view holds still while a shot the camera swung for flies (swing())
  else {
    st.yaw = turned(st.yaw, st.spin);
    if (st.spin) { // turning on its own: the camera looks for what the crew wait for (SEEK)
      if (st.quiet === SEEK) swing(st);
      const want = st.quiet >= SEEK && st.seekH >= 0 ? st.seekH : st.home;
      if (st.tick % SEEK_STEP === 0) st.pitch += Math.sign(want - st.pitch) * Math.min(SEEK_JUMP, Math.abs(want - st.pitch));
    }
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
  if (!st.quiet) { st.seekH = -2; st.sliver = false; }
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
      const steps = (Math.floor(tick / SEEK_STEP) - Math.floor(st.tick / SEEK_STEP)) * SEEK_JUMP; // as step() does
      if (st.spin) st.pitch += Math.sign(st.home - st.pitch) * Math.min(steps, Math.abs(st.home - st.pitch));
      st.quiet = 0; st.seekH = -2; st.sliver = false;
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
// the landing pause, the one targeting rule and the view as it is (the turntable turning and the
// camera looking as they would if the player leaves them be; seeing every side at once instead was
// wrong about 1 send in 1,000), until that crew member has sent its last shot
// (it finishes and frees its pad) or nothing can fire any more (it parks, with `left` shots), and
// until every crew member already on a pad that would finish without this send has finished or
// is stuck. Those stuck are `strands`: [{ id, color, left }], pad by pad, the crew this send
// leaves parked that would otherwise have finished. `base` is fates(st), when already known (it
// holds from one send to the next). null when it cannot be sent now (the line is empty or every
// pad is taken).
export function forecast(st, col, land = 0, base = null) {
  const sim = cloneBoard(st);
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
// copy of the board, with the view as it is (as forecast() does), until nothing moves. A Map from crew id to the shots it is left with when it
// parks, 0 when it finishes and frees its pad. One run answers every pad, and the answer holds
// until the next send or undo, since nothing else changes where the board is going. This is how
// a crew member that a later send has robbed shows it at once, before it runs dry.
export function fates(st) {
  const sim = cloneBoard(st);
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
// (pads full or queues empty). Crew still waiting for cubes of their colour count as able to
// fire until they have waited twice STALL (st.quiet): by then the camera has looked all round and
// what they wait for shows from nowhere, so only cubes of other colours going can free them.
export function isJammed(st) {
  if (isWon(st) || st.flying.length) return false;
  if (st.quiet <= 2 * STALL) for (let i = 0; i < st.slots.length; i++) if (canReach(st, i)) return false;
  const anyQueued = st.columns.some(c => c.length);
  return freeSlot(st) < 0 || !anyQueued;
}
