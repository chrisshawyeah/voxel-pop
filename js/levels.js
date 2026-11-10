// The levels, and the dealer that hands each sculpture's cubes out to the crew.
// This is the file to edit. Change a number, save, reload the page; then run
// `node tools/pick-deals.mjs <level>` to pick a deal for the new settings (see README.md).
import { MODELS } from './models.js';
import { makeBoard, cloneBoard, removeCube, START_SLOTS } from './logic.js';

// One line per level, played top to bottom. Reorder, delete or copy lines freely.
//   name    what the level is called on screen
//   model   which sculpture from js/models.js
//   cols    how many lines of crew wait at the bottom (2 to 5 fit a phone)
//   pads    how many launch pads (3 to 5 fit a phone). Fewer pads is much harder.
//   crew    [smallest, largest] number one crew member carries. Each colour is split into crew
//           of round sizes (steps of ten) in that range; the last of a colour takes what is left,
//           so the numbers add up to the cubes exactly. Bigger crew means fewer sends, and more
//           crew left waiting on a pad while their colour is still buried.
//   hidden  how many crew wait as a "?" until they reach the front (never two in a row in a line)
//   mix     how shuffled the lines are, 0 to 1. 0 deals crew in the order their cubes open up
//           (top first), 1 deals them at random.
//   flip    how far crew whose cubes sit deep are pulled to the front of the lines, 0 to 1.
//           0 keeps them at the back, 0.5 ignores depth, 1 puts the deepest first. Higher is harder.
//   greedy  [lowest, highest] share of plays, in %, that a player who sends any crew that can
//           shoot right now should win. The tests check it (tools/players.mjs).
//   deal    which deal of these settings is played. Picked by `node tools/pick-deals.mjs`, which
//           tries deals until a careful player wins and the greedy share lands in `greedy`.
export const LEVELS = [
  { name: 'Toadstool', model: 'mushroom', cols: 3, pads: 5, crew: [40, 60], hidden: 0, mix: 0, flip: 0, greedy: [95, 100], deal: 0 },
  { name: 'Bath Duck', model: 'duck', cols: 3, pads: 5, crew: [40, 60], hidden: 0, mix: 0, flip: 0, greedy: [95, 100], deal: 0 },
  { name: 'Penguin', model: 'penguin', cols: 3, pads: 5, crew: [40, 60], hidden: 0, mix: 0, flip: 0, greedy: [95, 100], deal: 0 },
  { name: 'Hot-Air Balloon', model: 'balloon', cols: 4, pads: 5, crew: [40, 70], hidden: 0, mix: 0.1, flip: 0.8, greedy: [70, 90], deal: 18 },
  { name: 'Robot', model: 'robot', cols: 5, pads: 5, crew: [50, 70], hidden: 0, mix: 0, flip: 0, greedy: [70, 90], deal: 2 },
  { name: 'Fish', model: 'fish', cols: 4, pads: 5, crew: [30, 50], hidden: 1, mix: 0.2, flip: 0, greedy: [70, 90], deal: 0 },
  { name: 'Cactus', model: 'cactus', cols: 4, pads: 5, crew: [40, 60], hidden: 1, mix: 0, flip: 0, greedy: [70, 90], deal: 1 },
  { name: 'Burger', model: 'burger', cols: 4, pads: 5, crew: [50, 80], hidden: 1, mix: 0.3, flip: 0, greedy: [70, 90], deal: 7 },
  { name: 'Lighthouse', model: 'lighthouse', cols: 5, pads: 5, crew: [50, 70], hidden: 1, mix: 0.3, flip: 0, greedy: [40, 70], deal: 5 },
  { name: 'Gift Box', model: 'gift', cols: 5, pads: 5, crew: [40, 70], hidden: 2, mix: 0.3, flip: 0.4, greedy: [40, 70], deal: 5 },
  { name: 'Rocket', model: 'rocket', cols: 5, pads: 5, crew: [30, 50], hidden: 2, mix: 0.3, flip: 0.4, greedy: [40, 70], deal: 17 },
  { name: 'Snowman', model: 'snowman', cols: 5, pads: 5, crew: [50, 80], hidden: 2, mix: 0.3, flip: 0.4, greedy: [40, 70], deal: 2 },
  { name: 'Cupcake', model: 'cupcake', cols: 5, pads: 5, crew: [40, 60], hidden: 2, mix: 0.3, flip: 0.4, greedy: [40, 70], deal: 9 },
  { name: 'Tree', model: 'tree', cols: 5, pads: 4, crew: [40, 60], hidden: 2, mix: 0, flip: 0, greedy: [40, 70], deal: 0 },
  { name: 'House', model: 'house', cols: 4, pads: 4, crew: [60, 90], hidden: 2, mix: 0.45, flip: 0, greedy: [15, 45], deal: 11 },
  { name: 'Nesting Dolls', model: 'dolls', cols: 5, pads: 5, crew: [60, 100], hidden: 2, mix: 0, flip: 0.5, greedy: [15, 45], deal: 3 },
  { name: 'Melon', model: 'melon', cols: 3, pads: 5, crew: [60, 100], hidden: 2, mix: 0, flip: 0.5, greedy: [15, 45], deal: 6 },
  { name: 'Castle', model: 'castle', cols: 5, pads: 4, crew: [60, 100], hidden: 3, mix: 0.3, flip: 0.4, greedy: [15, 45], deal: 3 },
  { name: 'Patchwork', model: 'patchwork', cols: 5, pads: 3, crew: [40, 60], hidden: 2, mix: 0.3, flip: 0.4, greedy: [15, 45], deal: 2 },
  { name: 'Ringed Planet', model: 'planet', cols: 4, pads: 5, crew: [60, 100], hidden: 3, mix: 0.45, flip: 0.4, greedy: [15, 45], deal: 17 },
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

// Deals one level exactly as its settings and `deal` number say, with no search.
export function dealLevel(def) {
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
  // Hidden crew: never the front of a line, never two in a row.
  const spots = [];
  columns.forEach((col, ci) => col.forEach((_, k) => { if (k > 0) spots.push([ci, k]); }));
  for (let n = 0; n < (def.hidden || 0) && spots.length; ) {
    const [ci, k] = spots.splice(Math.floor(rand() * spots.length), 1)[0];
    const col = columns[ci];
    if (col[k - 1].hidden || (col[k + 1] && col[k + 1].hidden)) continue;
    col[k].hidden = true;
    n++;
  }
  const board = cloneBoard(base);
  board.slots = Array(padsFor(def)).fill(null);
  board.columns = columns;
  return { def, model, board, shooters: crew.length };
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
