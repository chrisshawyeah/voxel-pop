// The ten levels and the generator that deals each sculpture's cubes out to the crew.
import { MODELS } from './models.js';
import { makeBoard, cloneBoard, removeCube, solve } from './logic.js';

// cols: queue columns · chunk: shots per crew member · mix: how far the deal strays from a
// safe outside-in order (0 to 1) · hidden: share of "?" crew · target: share of games a
// sensible player should win · deal: which deal tools/pick-deals.mjs chose for that target.
export const LEVELS = [
  { name: 'Toadstool', model: 'mushroom', seed: 11, cols: 3, chunk: [16, 28], mix: 0.25, hidden: 0, target: 100, deal: 0, flip: 0 },
  { name: 'Bath Duck', model: 'duck', seed: 23, cols: 3, chunk: [16, 30], mix: 0.25, hidden: 0, target: 100, deal: 0, flip: 0 },
  { name: 'Up & Away', model: 'balloon', seed: 67, cols: 4, chunk: [26, 44], mix: 0.25, hidden: 0, target: 100, deal: 0, flip: 0 },
  { name: 'Bolt', model: 'robot', seed: 83, cols: 4, chunk: [28, 48], mix: 0.25, hidden: 0.1, target: 100, deal: 0, flip: 0 },
  { name: 'Prickles', model: 'cactus', seed: 37, cols: 4, chunk: [18, 34], mix: 0.25, hidden: 0.15, target: 95, deal: 0, flip: 0 },
  { name: 'Night Light', model: 'lighthouse', seed: 71, cols: 5, chunk: [26, 44], mix: 0.5, hidden: 0.2, target: 90, deal: 9, flip: 0 },
  { name: 'Lift-off', model: 'rocket', seed: 41, cols: 5, chunk: [20, 36], mix: 1, hidden: 0.2, target: 85, deal: 8, flip: 0.2 },
  { name: 'Waddles', model: 'penguin', seed: 53, cols: 5, chunk: [20, 38], mix: 1, hidden: 0.25, target: 80, deal: 2, flip: 1 },
  { name: 'Nesting Dolls', model: 'dolls', seed: 101, cols: 5, chunk: [26, 46], mix: 0.25, hidden: 0.3, target: 70, deal: 1, flip: 0.8 },
  { name: 'Jawbreaker', model: 'planet', seed: 97, cols: 5, chunk: [26, 44], mix: 0.25, hidden: 0.3, target: 50, deal: 7, flip: 0.8 },
];

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const modelCache = new Map();
export function modelFor(def) {
  if (!modelCache.has(def.model)) modelCache.set(def.model, MODELS[def.model]());
  return modelCache.get(def.model);
}

// A safe order: peel the sculpture from the outside in, one crew member at a time.
export function peelOrder(board, def, rand) {
  const sim = cloneBoard(board);
  const seq = [];
  let last = -1;
  while (sim.cleared < sim.total) {
    const open = [];
    sim.exposed.forEach((set, c) => { if (set.size) open.push(c); });
    let c;
    if (last >= 0 && sim.exposed[last].size && rand() < 0.35) c = last;
    else {
      const w = open.map(k => Math.sqrt(sim.exposed[k].size));
      let r = rand() * w.reduce((a, b) => a + b, 0);
      c = open[open.length - 1];
      for (let k = 0; k < open.length; k++) { r -= w[k]; if (r <= 0) { c = open[k]; break; } }
    }
    const want = def.chunk[0] + Math.floor(rand() * (def.chunk[1] - def.chunk[0] + 1));
    let n = 0;
    while (n < want && sim.exposed[c].size) {
      const arr = [...sim.exposed[c]];
      removeCube(sim, arr[Math.floor(rand() * arr.length)]);
      n++;
    }
    const prev = seq[seq.length - 1];
    if (prev && prev.color === c && (n < def.chunk[0] / 2 || prev.count < def.chunk[0] / 2)) prev.count += n;
    else seq.push({ color: c, count: n });
    last = c;
  }
  return seq;
}

// Deals the crew into columns. A crew member's place is its peel rank, pulled towards the
// reverse order by `flip` (0 keeps the safe order, 1 reverses it) plus a random jitter of
// `mix` of the list. Higher values put buried colours up front.
export function deal(def, seq, rand, flip = 0) {
  const len = seq.length;
  const order = seq.map((s, i) => ({ ...s, rank: i, key: i + flip * (len - 1 - 2 * i) + rand() * def.mix * len }))
    .sort((a, b) => a.key - b.key);
  const columns = Array.from({ length: def.cols }, () => []);
  order.forEach((s, i) => {
    const col = i < def.cols ? i : Math.floor(rand() * def.cols);
    columns[col].push({ id: i, color: s.color, count: s.count, hidden: false, home: col, rank: s.rank });
  });
  for (const col of columns) col.forEach((s, k) => { if (k > 0 && rand() < def.hidden) s.hidden = true; });
  return columns;
}

const baseCache = new Map();
export function dealLevel(n, dealIndex, flip = LEVELS[n].flip || 0, mix = LEVELS[n].mix) {
  const def = { ...LEVELS[n], mix };
  const model = modelFor(def);
  if (!baseCache.has(n)) baseCache.set(n, makeBoard(model));
  const base = baseCache.get(n);
  const rand = rng(def.seed * 1000 + dealIndex);
  const seq = peelOrder(base, def, rand);
  const board = cloneBoard(base);
  board.columns = deal(def, seq, rand, flip);
  return { def, model, board, shooters: seq.length };
}

// The level as played: the chosen deal, checked once more by the solver with 5 pads.
export function buildLevel(n) {
  for (let k = 0; k < 50; k++) {
    const L = dealLevel(n, LEVELS[n].deal + k);
    if (solve(L.board, s => s.rank, 5)) return { ...L, dealIndex: LEVELS[n].deal + k };
  }
  throw new Error(`level ${n + 1} could not be dealt`);
}
