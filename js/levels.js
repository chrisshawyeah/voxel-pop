// The levels, and the dealer that hands each sculpture's cubes out to the crew.
// This is the file to edit. Change a number, save, reload the page; then run
// `node tools/pick-deals.mjs <level>` to pick a deal for the new settings (see README.md).
import { MODELS } from './models.js';
import { makeBoard, cloneBoard, removeCube, revealLone, START_SLOTS, RULES, FLIGHT } from './logic.js';

// One line per level, played top to bottom. Reorder, delete or copy lines freely.
//   name    what the level is called on screen
//   model   which sculpture from js/models.js
//   cols    how many lines of crew wait at the bottom (2 to 5 fit a phone)
//   pads    how many launch pads (3 to 5 fit a phone). Fewer pads is much harder.
//   crew    [smallest, largest] number one crew member carries. Each colour is split into crew
//           of round sizes (steps of ten) in that range; the last of a colour takes what is left,
//           so the numbers add up to the cubes exactly. Bigger crew means fewer sends, and more
//           crew left waiting on a pad while their colour is still hidden inside.
//   hidden  how many crew wait as a "?" until they reach the front (never two in a row in a line)
//   mix     how shuffled the lines are, 0 to 1. 0 deals crew in the order their cubes open up
//           (outside first), 1 deals them at random.
//   flip    how far crew whose cubes sit deep are pulled to the front of the lines, 0 to 1.
//           0 keeps them at the back, 0.5 ignores depth, 1 puts the deepest first. Higher is harder.
//   greedy  [lowest, highest] share of plays, in %, that a player who sends any crew that can
//           shoot right now should win. The tests check it (tools/players.mjs).
//   follow  [lowest, highest] share of plays, in %, that a player who sends whatever the forecast
//           says finishes, and never undoes, should win: the curve. Levels 1 to 3 teach (95-100),
//           4 to 8 rise gently (within 75-90), 9 to 13 are the middle (within 41-83), 14 to 20 are
//           hard (within 19-61), each band a little lower than the one before, and the lantern is
//           the one breather (95-100). From one level to the next the follower may win at most 20 points
//           more, unless the band itself sits above the one before it (the breather).
//   undos   the most undos the same player with undo may need in its median won play: at most 3 up
//           to level 12, at most 6 after. From one level to the next the median rises by at most 4
//           and falls by at most 1 (the breather is left out). tools/players.mjs curveMisses checks
//           all of it.
//   opening 'park' (optional): most players park a crew member on a pad in their first three sends
//           and have to free it (tools/players.mjs earlyParks). Levels 2 and 3 teach parking this way.
//   deal    which deal of these settings is played. Picked by `node tools/pick-deals.mjs`, which
//           tries deals until a careful player wins and the greedy, follow and undos measures
//           land where the line says.
//   lines   (instead of crew, hidden, mix, flip and deal) the crew written out by hand, one string
//           per line from the front: 'blue 40, ?green 20, red 30', a colour of the sculpture and
//           how many cubes that crew member pops, a "?" in front of one that waits hidden until it
//           reaches the front. Each colour's crew must add up to its cubes exactly.
//   solution  (with lines) a winning order of sends, the lines by number from 0 at the left.
//   traps   (with lines) the planned hard moments: [k, j] says that after the first k sends of
//           the solution, sending line j instead loses, though its front crew member could shoot
//           right away. The tests prove every one (tools/traps.mjs finds and checks them).
export const LEVELS = [
  { name: 'Toadstool', model: 'mushroom', cols: 3, pads: 5, crew: [40, 60], hidden: 0, mix: 0, flip: 0, greedy: [95, 100], follow: [95, 100], undos: 0, deal: 0 },
  { name: 'Bath Duck', model: 'duck', cols: 4, pads: 3, crew: [50, 80], hidden: 0, mix: 0.1, flip: 0.5, greedy: [85, 95], follow: [95, 100], undos: 0, opening: 'park', deal: 12 },
  { name: 'Penguin', model: 'penguin', cols: 3, pads: 3, crew: [60, 90], hidden: 0, mix: 0.1, flip: 0.4, greedy: [85, 95], follow: [95, 100], undos: 0, opening: 'park', deal: 16 },
  { name: 'Hot-Air Balloon', model: 'balloon', cols: 4, pads: 5, crew: [50, 80], hidden: 0, mix: 0.2, flip: 0.6, greedy: [70, 90], follow: [80, 90], undos: 1, deal: 6 },
  { name: 'Robot', model: 'robot', cols: 5, pads: 5, crew: [50, 70], hidden: 0, mix: 0, flip: 0.6, greedy: [70, 90], follow: [79, 89], undos: 1, deal: 1 },
  { name: 'Fish', model: 'fish', cols: 4, pads: 4, crew: [20, 40], hidden: 1, mix: 0.3, flip: 0.6, greedy: [70, 90], follow: [78, 88], undos: 1, deal: 22 },
  { name: 'Cactus', model: 'cactus', cols: 4, pads: 4, crew: [30, 50], hidden: 1, mix: 0.1, flip: 0.6, greedy: [70, 90], follow: [76, 86], undos: 1, deal: 0 },
  { name: 'Burger', model: 'burger', cols: 4, pads: 5, crew: [50, 80], hidden: 1, mix: 0.2, flip: 0.6, greedy: [70, 90], follow: [75, 85], undos: 1, deal: 4 },
  { name: 'Treehouse', model: 'treehouse', pads: 3, hidden: 2, lines: ['orange 96, teal 96, grey 152, grey 100', 'lilac 70, ?orange 100, orange 110, ?yellow 4', 'charcoal 83, red 110, green 96, green 110', 'teal 110, red 113, brown 165, green 100'], solution: [0, 0, 0, 0, 2, 2, 2, 2, 3, 3, 3, 3, 1, 1, 1, 1], traps: [[6, 3]], greedy: [45, 65], follow: [67, 83], undos: 3 },
  { name: 'Teapot', model: 'teapot', pads: 3, hidden: 2, lines: ['brown 40, blue 40, teal 40, teal 60, blue 50, blue 40, blue 60', 'orange 41, blue 51, teal 30, teal 34, ?blue 60, blue 40, yellow 5', 'brown 51, ?blue 40, teal 30, teal 30, white 55, blue 40'], solution: [0, 0, 1, 1, 0, 0, 0, 2, 0, 0, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1], traps: [[2, 0], [3, 0]], greedy: [55, 80], follow: [60, 76], undos: 3 },
  { name: 'Birdcage', model: 'birdcage', pads: 3, hidden: 0, lines: ['blue 139, teal 90, brown 100, yellow 120, white 29, brown 74', 'blue 110, red 40, teal 74, orange 4, charcoal 11, blue 110', 'teal 80, teal 90, brown 80, yellow 80, yellow 100, yellow 80', 'green 3, teal 90, brown 110, yellow 80, brown 110, yellow 80'], solution: [0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 1, 1, 0, 0, 1, 1, 1, 3, 3, 3, 3, 3, 3], traps: [[1, 2]], greedy: [10, 35], follow: [55, 71], undos: 3 },
  { name: 'Submarine', model: 'submarine', pads: 3, hidden: 2, lines: ['white 59, orange 74, teal 56, grey 68, teal 80, yellow 60, yellow 50, charcoal 3', 'orange 60, white 90, teal 70, yellow 50, teal 60, grey 50, yellow 59', 'orange 60, teal 60, ?orange 70, teal 60, yellow 80, ?yellow 60, grey 70'], solution: [0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 0, 1, 1, 1, 1, 0], traps: [[1, 1]], greedy: [50, 75], follow: [44, 60], undos: 3 },
  { name: 'Jellyfish', model: 'jellyfish', pads: 3, hidden: 2, lines: ['teal 110, pink 90, ?pink 120, pink 90', 'orange 63, lilac 140, lilac 151, lilac 130', 'teal 120, lilac 100, teal 90, ?pink 140, pink 100'], solution: [0, 0, 0, 0, 1, 1, 2, 1, 1, 2, 2, 2, 2], traps: [[5, 2]], greedy: [10, 35], follow: [41, 57], undos: 2 },
  { name: 'Hourglass', model: 'hourglass', pads: 3, hidden: 0, lines: ['orange 109, brown 60, brown 90, teal 100, teal 110', 'red 1, teal 80, yellow 90, yellow 80, brown 90, brown 60', 'teal 60, brown 64, teal 110, brown 60, brown 110'], solution: [2, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1], traps: [[9, 0], [10, 0], [11, 0]], greedy: [35, 60], follow: [42, 58], undos: 5 },
  { name: 'Space Station', model: 'station', pads: 3, hidden: 2, lines: ['yellow 50, orange 70, grey 90, white 60, ?blue 80, white 50', 'blue 67, yellow 52, charcoal 28, white 90, grey 80', 'orange 53, orange 50, white 70, ?white 80, grey 89, white 50'], solution: [1, 2, 1, 1, 1, 1, 2, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0], traps: [[2, 0], [3, 0], [3, 2]], greedy: [0, 25], follow: [45, 61], undos: 6 },
  { name: 'Windmill', model: 'windmill', pads: 3, hidden: 2, lines: ['brown 123, brown 90, charcoal 5, white 70, white 120', 'grey 67, orange 90, orange 80, ?orange 110, white 120', 'green 2, orange 112, red 137, ?white 70'], solution: [0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 2, 2], traps: [[5, 2]], greedy: [30, 50], follow: [32, 48], undos: 6 },
  { name: 'Pagoda', model: 'pagoda', pads: 4, hidden: 2, lines: ['orange 150, teal 130, teal 115, white 110, white 188, brown 121, red 130', 'yellow 113, ?yellow 160, charcoal 114, ?charcoal 110, red 150, red 170, charcoal 160', 'yellow 110, teal 120, orange 110, brown 120, red 114, charcoal 140, white 110'], solution: [1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2], traps: [[2, 0], [3, 0], [4, 2]], greedy: [10, 35], follow: [29, 45], undos: 6 },
  { name: 'Airship', model: 'airship', pads: 3, hidden: 2, lines: ['yellow 124, teal 100, teal 95, teal 120, red 80, brown 80', 'orange 110, orange 80, orange 148, white 90, white 157, brown 84', 'yellow 120, teal 140, ?red 110, red 95, red 110, ?charcoal 22'], solution: [2, 2, 2, 1, 0, 0, 2, 2, 0, 1, 1, 1, 1, 0, 1, 0, 0, 2], traps: [[0, 0]], greedy: [5, 30], follow: [27, 43], undos: 6 },
  { name: 'Lantern', model: 'lantern', pads: 3, hidden: 2, lines: ['green 9, ?white 90, charcoal 60, brown 60, charcoal 110, red 65, red 60', 'yellow 60, brown 110, orange 12, ?yellow 66, charcoal 65, brown 95, yellow 100', 'yellow 90, charcoal 80, charcoal 60, yellow 100, red 100, red 80, brown 60'], solution: [2, 2, 1, 1, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 2], traps: [[11, 2]], greedy: [85, 100], follow: [95, 100], undos: 2 },
  { name: 'Atom', model: 'atom', pads: 3, hidden: 2, lines: ['blue 50, yellow 43, yellow 60, ?orange 30, green 50', 'yellow 30, yellow 40, yellow 30, green 40, green 38, blue 40', 'teal 39, blue 40, blue 33, white 36, ?red 40', 'orange 51, teal 30, red 40, red 46, yellow 50'], solution: [0, 0, 2, 0, 0, 0, 2, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3], traps: [[4, 2], [5, 2]], greedy: [0, 25], follow: [19, 35], undos: 6 },
];

export const padsFor = def => def.pads || START_SLOTS;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seedOf = text => [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

// A sculpture, its bare board and how deep each cube sits, built once per sculpture.
const sculptures = new Map();
export function modelFor(def) {
  return sculpture(def.model).model;
}
function sculpture(name) {
  if (!sculptures.has(name)) {
    const model = MODELS[name]();
    const base = makeBoard(model);
    // depth[i]: how many rounds of "pop every cube that can be hit" it takes to reach cube i.
    const depth = new Int16Array(base.cells.length);
    const sim = cloneBoard(base);
    for (let round = 0; sim.cleared < sim.total; round++) {
      const open = sim.exposed.flatMap(set => [...set]);
      for (const i of open) depth[i] = round;
      for (const i of open) removeCube(sim, i);
    }
    sculptures.set(name, { model, base, depth });
  }
  return sculptures.get(name);
}

// Splits one colour's cubes into crew of round sizes within [lo, hi]; the last takes the rest.
function split(total, [lo, hi], rand) {
  const sizes = [];
  let left = total;
  while (left > hi) {
    const fits = [];
    for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) if (left - v >= lo) fits.push(v);
    if (!fits.length) break;
    const v = fits[Math.floor(rand() * fits.length)];
    sizes.push(v);
    left -= v;
  }
  sizes.push(left);
  return sizes;
}

// Reads crew written out by hand (a level's `lines`, see LEVELS above) into the lines of a board.
// Throws, naming the level, when a colour is not the sculpture's or its crew do not add up to its
// cubes.
export function readLines(def, model, remaining) {
  const where = `${def.name}: `;
  const sums = new Array(model.names.length).fill(0);
  let id = 0;
  const columns = def.lines.map((text, ci) => text.split(',').map(part => {
    const m = /^\s*(\?)?\s*([a-z]+)\s+(\d+)\s*$/.exec(part);
    if (!m) throw new Error(`${where}cannot read "${part.trim()}" in line ${ci + 1}`);
    const color = model.names.indexOf(m[2]);
    if (color < 0) throw new Error(`${where}${m[2]} is not a colour of the ${def.model}`);
    const count = Number(m[3]);
    if (!(count > 0)) throw new Error(`${where}a crew member of ${m[2]} pops no cubes`);
    sums[color] += count;
    return { id: id++, color, count, hidden: !!m[1], home: ci };
  }));
  model.names.forEach((name, c) => {
    if (sums[c] !== remaining[c]) throw new Error(`${where}the ${name} crew pop ${sums[c]} cubes, but the ${def.model} has ${remaining[c]}`);
  });
  columns.forEach((col, ci) => col.forEach((s, k) => {
    if (s.hidden && k === 0) throw new Error(`${where}the front of line ${ci + 1} is hidden`);
    if (s.hidden && col[k - 1].hidden) throw new Error(`${where}two hidden crew in a row in line ${ci + 1}`);
  }));
  return columns;
}

// Deals one level exactly as its settings and `deal` number say, with no search; a level whose
// crew are written out by hand (`lines`) is read as written.
export function dealLevel(def) {
  if (def.lines) {
    const { model, base } = sculpture(def.model);
    const columns = readLines(def, model, base.remaining);
    const board = cloneBoard(base);
    board.slots = Array(padsFor(def)).fill(null);
    board.columns = columns;
    revealLone(board);
    const crew = columns.reduce((n, col) => n + col.length, 0);
    return { def, model, board, shooters: crew, hidden: columns.flat().filter(s => s.hidden).length };
  }
  const { model, base, depth } = sculpture(def.model);
  const rand = rng(seedOf(`${def.model}:${def.deal}`));
  // The crew: each colour's cubes in the order they open up (shallow first, then the targeting
  // rule), cut into crew; a crew member's `open` is how deep its cubes sit on average, 0 to 1.
  const deepest = depth.reduce((a, b) => Math.max(a, b), 1);
  const crew = [];
  base.remaining.forEach((total, c) => {
    if (!total) return;
    const cubes = [];
    for (let i = 0; i < base.cells.length; i++) if (base.cells[i] === c + 1) cubes.push(i);
    cubes.sort((a, b) => depth[a] - depth[b] || base.order[a] - base.order[b]);
    let at = 0;
    for (const count of split(total, def.crew, rand)) {
      let sum = 0;
      for (let k = at; k < at + count; k++) sum += depth[cubes[k]];
      crew.push({ color: c, count, open: sum / count / deepest });
      at += count;
    }
  });
  // The lines: crew sorted by when their cubes open up, shuffled by `mix`, then dealt a row at a
  // time, each row across the lines in a random order.
  const mix = def.mix || 0, flip = def.flip || 0;
  crew.forEach(s => { s.key = (1 - mix) * (s.open + flip * (1 - 2 * s.open)) + mix * rand(); });
  crew.sort((a, b) => a.key - b.key);
  const columns = Array.from({ length: def.cols }, () => []);
  for (let r = 0; r < crew.length; r += def.cols) {
    const order = columns.map((_, i) => i);
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    crew.slice(r, r + def.cols).forEach((s, k) => columns[order[k]].push(s));
  }
  let id = 0;
  columns.forEach((col, ci) => col.forEach((s, k) => {
    col[k] = { id: id++, color: s.color, count: s.count, hidden: false, home: ci };
  }));
  // Hidden crew: never the front of a line, never two in a row. When they are all the same crew,
  // there is nothing to guess and they are shown from the start (revealLone in js/logic.js), so
  // a level with one hidden crew member has no "?" on screen.
  const spots = [];
  columns.forEach((col, ci) => col.forEach((_, k) => { if (k > 0) spots.push([ci, k]); }));
  let hidden = 0;
  while (hidden < (def.hidden || 0) && spots.length) {
    const [ci, k] = spots.splice(Math.floor(rand() * spots.length), 1)[0];
    const col = columns[ci];
    if (col[k - 1].hidden || (col[k + 1] && col[k + 1].hidden)) continue;
    col[k].hidden = true;
    hidden++;
  }
  const board = cloneBoard(base);
  board.slots = Array(padsFor(def)).fill(null);
  board.columns = columns;
  revealLone(board);
  return { def, model, board, shooters: crew.length, hidden };
}

// A short fingerprint of a level as dealt: its settings, its sculpture (size and cubes), its crew
// and lines, its pads and the rules' version. A saved attempt carries it (js/main.js), so a save made before
// any of those changed is turned down instead of replayed onto a different puzzle.
const prints = new Map();
export function levelPrint(n) {
  const L = buildLevel(n);
  if (!prints.has(L.def)) {
    const text = JSON.stringify([RULES, FLIGHT, L.def, [L.model.sx, L.model.sy, L.model.sz], Array.from(L.model.cells).join(''), L.model.palette,
      L.board.columns.map(col => col.map(s => [s.color, s.count, s.hidden ? 1 : 0])), L.board.slots.length]);
    let a = 0x811c9dc5, b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619);
      b = Math.imul(b ^ c, 2246822519) ^ (b >>> 13);
    }
    prints.set(L.def, `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${text.length}`);
  }
  return prints.get(L.def);
}

// The level as played. Built once per level line and kept, so a restart, the arrows and the
// tap after running out of room hand out a fresh copy instead of dealing it again.
const built = new Map();
export function buildLevel(n) {
  const def = LEVELS[n];
  if (!built.has(def)) built.set(def, dealLevel(def));
  const L = built.get(def);
  return { ...L, board: cloneBoard(L.board) };
}
