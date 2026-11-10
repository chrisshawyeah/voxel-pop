// Two test players for measuring a level. Both wait for the pads to stop before each send,
// using the same rules and ticks as the game (js/logic.js).
//
// greedy: sends the front of any line whose colour can be hit right now, picked at random
//   among those; when none can be hit, any front at random. This is "send whatever can shoot".
//   Its win rate over many plays is how hard a level is.
// plan: a real search over which line to send next (depth-first, best-looking send first,
//   remembering boards it has already judged). It treats every "?" crew member as unknown
//   until the screen would show it: when a send turns a "?" into the front of its line, the
//   plan has to win whichever of the still-hidden crew it turns out to be. So a level it wins
//   never needs a guess about a "?".
import { cloneBoard, deploy, settle, isWon, freeSlot } from '../js/logic.js';
import { rng } from '../js/levels.js';

export function greedy(board, rand) {
  const st = cloneBoard(board);
  for (;;) {
    settle(st);
    if (isWon(st)) return true;
    if (freeSlot(st) < 0) return false; // every pad full and none can fire: out of room
    const fronts = [];
    st.columns.forEach((c, i) => { if (c.length) fronts.push(i); });
    if (!fronts.length) return false;
    const open = fronts.filter(i => st.exposed[st.columns[i][0].color].size > 0);
    const pick = open.length ? open : fronts;
    deploy(st, pick[Math.floor(rand() * pick.length)]);
  }
}

export function greedyRate(board, rand, plays = 200) {
  let wins = 0;
  for (let k = 0; k < plays; k++) wins += greedy(board, rand);
  return Math.round((100 * wins) / plays);
}

// The measure the tests and tools/pick-deals.mjs both use: 300 greedy plays from a fixed seed,
// so a level's rate is the same number wherever it is measured.
export const GREEDY_PLAYS = 300;
export const greedyCheck = board => greedyRate(board, rng(777), GREEDY_PLAYS);

const OUT = Symbol('out of budget');

// Returns { win: true | false | null (gave up after `budget` boards), boards, line }, where
// line is the winning order of lines (0 = leftmost) with the hidden crew as actually dealt.
export function plan(board, { budget = 60000 } = {}) {
  const st0 = cloneBoard(board);
  const pool = []; // the crew behind a "?", as colour:count; s.truth keeps where each really sits
  st0.columns.forEach(col => col.forEach(s => {
    if (!s.hidden) return;
    s.truth = `${s.color}:${s.count}`;
    pool.push(s.truth);
    s.color = -1; s.count = 0; s.unknown = true;
  }));
  settle(st0);
  const memo = new Map();
  let boards = 0;

  const keyOf = (st, pool) => {
    let k = `${st.h1},${st.h2}|`;
    for (const c of st.columns) k += c.length ? `${c.length}.${c[0].color}.${c[0].count},` : '0,';
    k += '|';
    for (const s of st.slots) k += s ? `${s.color}.${s.count},` : '_,';
    return k + '|' + pool.slice().sort().join(' ');
  };
  const free = st => st.slots.reduce((n, s) => n + !s, 0);

  // Every send from a settled board, settled again, best-looking first (most free pads, then
  // most cubes gone). `unknown` marks a send that turns a "?" into a front.
  const sends = st => {
    const kids = [];
    st.columns.forEach((c, ci) => {
      if (!c.length) return;
      const nx = cloneBoard(st);
      const d = deploy(nx, ci);
      settle(nx);
      kids.push({ nx, ci, unknown: !!(d.revealed && d.revealed.unknown), score: free(nx) * 1e6 + nx.cleared });
    });
    return kids.sort((a, b) => b.score - a.score || a.ci - b.ci);
  };
  const reveal = (st, ci, pool, j) => {
    const nx = cloneBoard(st);
    const [color, count] = pool[j].split(':').map(Number);
    Object.assign(nx.columns[ci][0], { color, count, unknown: false });
    return { nx, rest: pool.slice(0, j).concat(pool.slice(j + 1)) };
  };

  // st is settled. True when some send from here wins whatever the hidden crew turn out to be.
  function wins(st, pool) {
    if (isWon(st)) return true;
    if (freeSlot(st) < 0 || !st.columns.some(c => c.length)) return false;
    const key = keyOf(st, pool);
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (++boards > budget) throw OUT;
    let ok = false;
    for (const kid of sends(st)) {
      if (kid.unknown ? everyReveal(kid.nx, kid.ci, pool) : wins(kid.nx, pool)) { ok = true; break; }
    }
    memo.set(key, ok);
    return ok;
  }

  // The front of line ci has just turned from "?" into one of the crew still hidden; win for each.
  function everyReveal(st, ci, pool) {
    const tried = new Set();
    for (let j = 0; j < pool.length; j++) {
      if (tried.has(pool[j])) continue;
      tried.add(pool[j]);
      const { nx, rest } = reveal(st, ci, pool, j);
      if (!wins(nx, rest)) return false;
    }
    return true;
  }

  let win;
  try { win = wins(st0, pool); } catch (e) { if (e !== OUT) throw e; win = null; }
  if (!win) return { win, boards, line: null };

  // Follow the plan through the deal as it really is, for the record (every board on this path
  // has been judged already, so this reads the memo).
  const line = [];
  let st = st0, p = pool;
  while (!isWon(st)) {
    const kid = sends(st).find(k => (k.unknown ? everyReveal(k.nx, k.ci, p) : wins(k.nx, p)));
    if (!kid) break;
    line.push(kid.ci);
    if (kid.unknown) ({ nx: st, rest: p } = reveal(kid.nx, kid.ci, p, p.indexOf(kid.nx.columns[kid.ci][0].truth)));
    else st = kid.nx;
  }
  return { win, boards, line };
}
