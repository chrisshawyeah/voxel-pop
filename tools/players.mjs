// Test players for measuring a level, using the same rules and ticks as the game (js/logic.js).
// greedy and plan wait for the pads to stop before each send; playLine and hastyGreedy (below)
// send while shots are still in the air, with the game's landing pause, as a quick player does.
//
// greedy: sends the front of any line whose colour can be hit right now, picked at random
//   among those; when none can be hit, any front at random. This is "send whatever can shoot".
//   Its win rate over many plays is how hard a level is.
// plan: a real search over which line to send next (depth-first, best-looking send first,
//   remembering boards it has already judged). It knows only what the player can find on the
//   screen: every crew member in every line (a tap behind the front of a line shows the whole
//   line, js/main.js preview()), and of a "?" only which crew the "?"s are among (the preview
//   lists them), never which is where: when a send turns a "?" into the front of its line, the
//   plan has to win whichever of the still-hidden crew it turns out to be. So a level it wins
//   never needs a guess about a "?". It does see inside the sculpture, which the screen shows
//   only through the finishes-or-parks mark under each front (js/logic.js forecast()).
import { cloneBoard, deploy, settle, isWon, freeSlot, tickGame, isJammed, busy } from '../js/logic.js';
import { rng } from '../js/levels.js';

// The game's landing pause (LAND in js/main.js) and the gaps a quick player leaves between two
// sends, in ticks of 1/30 s: 0, 150, 300 and 600 ms.
export const LAND = 5;
export const GAPS = [0, 5, 9, 18];
export const HASTY_GAP = 5; // the hasty greedy player taps every 150 ms

// Plays `line` (which line to send, in order) with the game's ticks and landing pause, without
// waiting for the pads to stop: each send goes `gap` ticks after the one before, or as soon as a
// pad is free after that. True when it wins. A deal whose winning line loses at one of GAPS
// needs the player to wait at the right moments, which the screen does not ask for.
export function playLine(board, line, gap, land = LAND) {
  const st = cloneBoard(board);
  let k = 0, wait = 0;
  for (;;) {
    if (isWon(st)) return true;
    if (k < line.length && wait <= 0 && freeSlot(st) >= 0) {
      if (!deploy(st, line[k++], land)) return false;
      wait = gap;
      continue;
    }
    if (k < line.length ? isJammed(st) : !busy(st)) return isWon(st);
    tickGame(st);
    wait--;
  }
}

// greedy in a hurry: every `gap` ticks it sends a front whose colour can be hit right now (at
// random among those) into a free pad, with shots still in the air and crew still landing; only
// when nothing moves and nothing can be hit does it send any front. This is a player who taps
// whatever is ready as fast as it lights up.
export function hastyGreedy(board, rand, gap = HASTY_GAP, land = LAND) {
  const st = cloneBoard(board);
  let wait = 0;
  for (;;) {
    if (isWon(st)) return true;
    if (isJammed(st)) return false;
    if (wait <= 0 && freeSlot(st) >= 0) {
      const fronts = [];
      st.columns.forEach((c, i) => { if (c.length) fronts.push(i); });
      const open = fronts.filter(i => st.exposed[st.columns[i][0].color].size > 0);
      const pick = open.length ? open : busy(st) ? [] : fronts;
      if (pick.length) {
        deploy(st, pick[Math.floor(rand() * pick.length)], land);
        wait = gap;
        continue;
      }
    }
    tickGame(st);
    wait--;
  }
}

export function hastyRate(board, rand, plays = 200) {
  let wins = 0;
  for (let k = 0; k < plays; k++) wins += hastyGreedy(board, rand);
  return Math.round((100 * wins) / plays);
}

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
export const hastyCheck = board => hastyRate(board, rng(778), GREEDY_PLAYS);

// True when the planning player's winning line also wins at every gap in GAPS.
export const lineHolds = (board, line) => GAPS.every(gap => playLine(board, line, gap));

const OUT = Symbol('out of budget');

// Returns { win: true | false | null (gave up after `budget` boards), boards, line, holds },
// where line is a winning order of lines (0 = leftmost) with the hidden crew as actually dealt,
// and holds says whether it passed `holds(line)` (lineHolds: it also wins with sends that
// overlap in time). Without `holds` the line is the first one found and holds is true.
export function plan(board, { budget = 60000, holds = null, lines = 400 } = {}) {
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
  if (!win) return { win, boards, line: null, holds: false };

  // Follow the plan through the deal as it really is, for the record: the first winning send at
  // each step (every board on that path has been judged already, so this reads the memo). With
  // `holds`, a line it refuses sends the walk back to try the other winning sends, depth first,
  // until a line passes or `lines` lines have been tried; then the first line found is kept.
  let first = null, tried = 0;
  const follow = (st, p, line) => {
    if (isWon(st)) {
      if (!first) first = line.slice();
      tried++;
      return !holds || holds(line);
    }
    for (const kid of sends(st)) {
      if (tried >= lines) return false;
      if (!(kid.unknown ? everyReveal(kid.nx, kid.ci, p) : wins(kid.nx, p))) continue;
      let nx = kid.nx, rest = p;
      if (kid.unknown) ({ nx, rest } = reveal(kid.nx, kid.ci, p, p.indexOf(kid.nx.columns[kid.ci][0].truth)));
      line.push(kid.ci);
      if (follow(nx, rest, line)) return true;
      line.pop();
    }
    return false;
  };
  const line = [];
  let ok = false;
  budget += budget; // the walk may judge boards the search skipped
  try { ok = follow(st0, pool, line); } catch (e) { if (e !== OUT) throw e; }
  return { win, boards, line: ok ? line : first, holds: ok };
}
