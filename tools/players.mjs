// Test players for measuring a level, using the same rules and ticks as the game (js/logic.js).
// greedy and plan wait for the pads to stop before each send; playLine, hastyGreedy and
// hastyForecast (below) send while shots are still in the air, with the game's landing pause and
// the game's own clock (pace() in js/logic.js: a tick runs three times as fast while there is
// nothing to send), as a quick player does.
//
// greedy: sends the front of any line whose colour can be hit right now, picked at random
//   among those; when none can be hit, any front at random. This is "send whatever can shoot".
//   Its win rate over many plays is how hard a level is for a player who does not plan.
// plan: a real search over which line to send next (depth-first, best-looking send first,
//   remembering boards it has already judged). It knows only what the player can find on the
//   screen: every crew member in every line (a tap behind the front of a line shows the whole
//   line, js/main.js preview()), and of a "?" only which crew the "?"s are among (the preview
//   lists them), never which is where: when a send turns a "?" into the front of its line, the
//   plan has to win whichever of the still-hidden crew it turns out to be. So a level it wins
//   never needs a guess about a "?". It does see inside the sculpture, which the screen shows
//   only through the forecast on each front (js/logic.js forecast()).
// forecastFirst, hastyForecast and backtrack (further down) play by that forecast, the way a
// player who reads it does: they measure how much of a level the forecast plays for you.
import { cloneBoard, deploy, settle, isWon, freeSlot, tickGame, isJammed, busy, forecast, fates, pace, removeCube } from '../js/logic.js';
import { rng } from '../js/levels.js';

// The game's landing pause (LAND in js/main.js) in ticks, and the gaps a quick player leaves
// between two taps, in milliseconds.
export const LAND = 5;
export const GAPS = [0, 150, 300, 600];
export const HASTY_GAP = 150; // the hasty players tap every 150 ms

// The game's clock for the timed players, as js/main.js tick() keeps it. Time is kept in
// ninetieths of a second: a tick at normal speed takes 3 of them, at 3x one (pace() in js/logic.js,
// asked as the game asks it; the players' taps are instant, so no finger is ever down). A tap
// lands at its real time, between two ticks when that is when it falls, and the tick under way
// keeps the part of it already run, as in the game: 150 ms after a tap on a tick is 4.5 ticks
// at normal speed, so the next tap comes after the fourth tick, the one after that after the ninth.
// A tap and a tick due at the same moment: the tick goes first.
const units = ms => (ms * 90) / 1000;

// Plays a board on the game's clock, with the game's ticks and landing pause, without waiting for
// the pads to stop: once `gap` ms have passed since the last tap and a pad is free, it asks
// `choose(st)` for a line to send (-1: none now) and sends it at once; when nothing is chosen it
// asks again just after the next tick, or, `patient`, `gap` ms later (a player reading the
// forecast looks again at the same pace it taps). It ends when the board is won or out of room, or
// when nothing is chosen and nothing moves. { win, sends, seconds, ticks } (seconds of the game's
// clock, and rule ticks, until it ended).
export function onClock(board, gap, choose, land = LAND, patient = false) {
  const st = cloneBoard(board);
  const g = units(gap);
  let sends = 0, t = 0;
  let ask = 0;  // when the player may tap (or look) next
  let part = 0; // how much of the tick under way has run, of its 3 at normal speed
  const end = win => ({ win, sends, seconds: t / 90, ticks: st.tick });
  for (;;) {
    if (isWon(st)) return end(true);
    if (isJammed(st)) return end(false);
    const speed = pace(st);
    const due = t + (3 - part) / speed; // when the next tick runs
    if (t >= ask && freeSlot(st) >= 0) {
      const ci = choose(st);
      if (ci >= 0) {
        if (!deploy(st, ci, land)) return end(false);
        sends++;
        ask = t + g;
        continue;
      }
      if (!busy(st)) return end(false); // nothing to send and nothing moving: nothing will change
      ask = patient && g > 0 ? t + g : due;
    }
    if (ask < due && freeSlot(st) >= 0) { part += (ask - t) * speed; t = ask; continue; } // the tap falls before the next tick
    tickGame(st);
    t = due; part = 0;
  }
}

// Plays `line` (which line to send, in order) on the game's clock: each send goes `gap` ms after
// the one before, or as soon as a pad is free after that. True when it wins. A deal whose winning
// line loses at one of GAPS needs the player to wait at the right moments, which the screen does
// not ask for.
export function playLine(board, line, gap, land = LAND) {
  let k = 0;
  return onClock(board, gap, () => (k < line.length ? line[k++] : -1), land).win;
}

// greedy in a hurry: every `gap` ms it sends a front whose colour can be hit right now (at
// random among those) into a free pad, with shots still in the air and crew still landing; only
// when nothing moves and nothing can be hit does it send any front. This is a player who taps
// whatever is ready as fast as it lights up.
export function hastyGreedy(board, rand, gap = HASTY_GAP, land = LAND) {
  return onClock(board, gap, st => {
    const fronts = [];
    st.columns.forEach((c, i) => { if (c.length) fronts.push(i); });
    const open = fronts.filter(i => st.exposed[st.columns[i][0].color].size > 0);
    const pick = open.length ? open : busy(st) ? [] : fronts;
    return pick.length ? pick[Math.floor(rand() * pick.length)] : -1;
  }, land).win;
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

// ---------- players who follow the forecast (js/logic.js forecast()) ----------
// The order such a player tries the fronts in: those forecast to finish and strand nobody (a tick),
// in random order; then those that leave crew parked but finish or are ready, fewest crew left
// parked first (the sent one if it parks, and those it strands), then fewest shots left with them;
// then the rest, in random order. A front already tried from this board (`skip`) is left out. The
// forecast is what the screen shows: on levels 1 to 3 always, from level 4 a press and hold away
// once the player has learned the hold (js/main.js marksShown()).
export function byForecast(st, rand, land = LAND, skip = null) {
  const base = st.slots.some(Boolean) ? fates(st) : new Map(); // where the crew on the pads are going
  const seen = new Map(); // crew of the same colour and number fare the same
  const ticks = [], others = [], rest = [];
  st.columns.forEach((c, ci) => {
    if (!c.length || (skip && skip.has(ci))) return;
    const k = `${c[0].color}:${c[0].count}`;
    if (!seen.has(k)) seen.set(k, forecast(st, ci, land, base));
    const f = seen.get(k);
    if (f && f.finishes && !f.strands.length) ticks.push(ci);
    else if (f && (f.finishes || st.exposed[c[0].color].size)) {
      const parked = (f.finishes ? 0 : 1) + f.strands.length;
      const left = (f.finishes ? 0 : f.left) + f.strands.reduce((n, s) => n + s.left, 0);
      others.push([parked, left, rand(), ci]);
    } else rest.push(ci);
  });
  const shuffle = a => { for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a; };
  return { ticks: shuffle(ticks), others: others.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(p => p[3]), rest: shuffle(rest) };
}
const order = o => [...o.ticks, ...o.others, ...o.rest];

// Waits for the pads to stop, then sends by the forecast: a clean tick if there is one, else the
// front that leaves the least parked, else any front. Never undoes. { win, sends }.
export function forecastFirst(board, rand, land = LAND) {
  const st = cloneBoard(board);
  let sends = 0;
  for (;;) {
    settle(st);
    if (isWon(st)) return { win: true, sends };
    if (isJammed(st)) return { win: false, sends };
    deploy(st, order(byForecast(st, rand, land))[0], land);
    sends++;
  }
}

// The same player in a hurry, on the game's clock: every `gap` ms, with shots in the air, it looks
// at the forecasts and sends a front forecast to finish and strand nobody into a free pad; only
// when none is and nothing moves does it send the best of the rest. Never undoes. { win, sends }.
export function hastyForecast(board, rand, gap = HASTY_GAP, land = LAND) {
  return onClock(board, gap, st => {
    const o = byForecast(st, rand, land);
    return (o.ticks.length ? o.ticks[0] : busy(st) ? -1 : order(o)[0]) ?? -1;
  }, land, true);
}

// The forecast-first player with undo: when it runs out of room it takes back its last send and
// tries the next front in its order from that board; when every front from a board has been tried
// it takes back the send before, and it never tries a board it already lost from again. It gives up
// after `cap` undos. { win, sends (every send, those taken back too), undos }.
export function backtrack(board, rand, cap = 50, land = LAND) {
  const keyOf = st => {
    let k = `${st.h1},${st.h2}|`;
    for (const c of st.columns) k += `${c.length},`;
    for (const s of st.slots) k += s ? `${s.id}.${s.count},` : '_,';
    return k;
  };
  const lost = new Set();
  const path = [];
  let cur = { st: settle(cloneBoard(board)), tried: new Set() };
  let sends = 0, undos = 0;
  for (;;) {
    const st = cur.st;
    if (isWon(st)) return { win: true, sends, undos };
    let ci;
    if (!isJammed(st) && !lost.has(keyOf(st))) ci = order(byForecast(st, rand, land, cur.tried))[0];
    if (ci === undefined) {
      lost.add(keyOf(st));
      if (!path.length || undos >= cap) return { win: false, sends, undos };
      cur = path.pop();
      undos++;
      continue;
    }
    cur.tried.add(ci);
    const nx = cloneBoard(st);
    deploy(nx, ci, land);
    settle(nx);
    sends++;
    path.push(cur);
    cur = { st: nx, tried: new Set() };
  }
}

// ---------- the curve: how much the forecast plays for you, level by level ----------
// Each level's `follow` band (js/levels.js) is the share of plays, in %, that the forecast
// follower (forecastCheck: forecastFirst, never undoing) must win, and its `undos` the most undos
// the median won play of the follower with undo (backtrackCheck) may take. Then, from one level to
// the next: the forecast follower may win at most STEP_MAX points more than on the level before,
// unless the level's band sits wholly above the band before it (a breather, like the melon); and
// the median undos may rise by at most UNDO_RISE over the level before's and fall by at most
// UNDO_FALL, so they climb in small steps (a breather is left out: the level after it is compared
// with the level before it). The median jumps from 0 to a level's full depth once the follower
// wins less than half the time, so the first hard level may rise by 3. curveMisses() lists what a set of measures
// breaks; the tests, tools/difficulty.mjs and tools/pick-deals.mjs all use it.
export const STEP_MAX = 20;
export const UNDO_RISE = 3;
export const UNDO_FALL = 1;
export const isBreather = (defs, n) => n > 0 && defs[n].follow[0] > defs[n - 1].follow[1];
// m[n] = { fc, undos } for level n (undos null when it never won; a level with no m[n] is not
// checked). Each miss is { n, k, text }: level n breaks it, against level k (k = n for its own
// band and undos).
export function curveMisses(defs, m) {
  const out = [];
  for (let n = 0; n < defs.length; n++) {
    if (!m[n]) continue;
    const [lo, hi] = defs[n].follow;
    const where = `level ${n + 1} (${defs[n].name})`;
    if (m[n].fc < lo || m[n].fc > hi) out.push({ n, k: n, text: `${where}: the forecast follower wins ${m[n].fc}%, outside ${lo}-${hi}%` });
    if (m[n].undos === null || m[n].undos > defs[n].undos) out.push({ n, k: n, text: `${where}: the backtracking player's median is ${m[n].undos ?? 'no win'} undos, more than ${defs[n].undos}` });
    const p = n - 1;
    if (p >= 0 && m[p] && !isBreather(defs, n) && m[n].fc > m[p].fc + STEP_MAX) out.push({ n, k: p, text: `${where}: the forecast follower wins ${m[n].fc}%, more than ${STEP_MAX} points over level ${n}'s ${m[p].fc}%` });
    const q = p >= 1 && isBreather(defs, p) ? p - 1 : p; // the level after a breather is compared with the one before it
    if (q >= 0 && m[q] && !isBreather(defs, n) && m[n].undos !== null && m[q].undos !== null) {
      if (m[n].undos > m[q].undos + UNDO_RISE) out.push({ n, k: q, text: `${where}: ${m[n].undos} median undos, more than ${UNDO_RISE} over level ${q + 1}'s ${m[q].undos}` });
      if (m[n].undos < m[q].undos - UNDO_FALL) out.push({ n, k: q, text: `${where}: ${m[n].undos} median undos, more than ${UNDO_FALL} under level ${q + 1}'s ${m[q].undos}` });
    }
  }
  return out;
}

// How often, in %, the greedy player (waiting for the pads to stop before each send) leaves a crew
// member parked on a pad after one of its first three sends, over `plays` plays from a fixed seed.
// A level with `opening: 'park'` must open like that at least PARK_MIN % of the time: most players
// park someone early and then have to free them.
export const PARK_MIN = 50;
export function earlyParks(board, plays = 100) {
  const rand = rng(782);
  let parked = 0;
  for (let p = 0; p < plays; p++) {
    const st = cloneBoard(board);
    for (let k = 0; k < 3; k++) {
      settle(st);
      if (isWon(st) || freeSlot(st) < 0) break;
      const fronts = [];
      st.columns.forEach((c, i) => { if (c.length) fronts.push(i); });
      const open = fronts.filter(i => st.exposed[st.columns[i][0].color].size > 0);
      const pick = open.length ? open : fronts;
      deploy(st, pick[Math.floor(rand() * pick.length)]);
      settle(st);
      if (st.slots.some(Boolean) && !isWon(st)) { parked++; break; }
    }
  }
  return Math.round((100 * parked) / plays);
}

// The layers of a sculpture: how many of its colours are hidden at the start, fully (not one cube
// of it can be hit until cubes of another colour go) and partly (a crew of that colour, eating
// only its own colour as far as it reaches, leaves some of it that waits on another colour).
// A sculpture with neither is no puzzle under the outside rule: every crew could finish at once.
export function hiddenColours(board) {
  let full = 0, part = 0;
  board.remaining.forEach((total, c) => {
    if (!total) return;
    const sim = cloneBoard(board);
    let alone = 0;
    while (sim.exposed[c].size) for (const i of [...sim.exposed[c]]) { removeCube(sim, i); alone++; }
    if (!alone) full++; else if (alone < total) part++;
  });
  return { full, part };
}

const median = xs => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

// Plays `player` `plays` times from a fixed seed: { rate (% won), sends (median per play),
// undos (median per won play, when the player undoes) }.
export function measure(player, board, seed, plays) {
  const rand = rng(seed);
  let wins = 0;
  const sends = [], undos = [];
  for (let k = 0; k < plays; k++) {
    const r = player(board, rand);
    wins += r.win;
    sends.push(r.sends);
    if (r.win && r.undos !== undefined) undos.push(r.undos);
  }
  return { rate: Math.round((100 * wins) / plays), sends: median(sends), undos: median(undos) };
}

// The measures the tests, tools/difficulty.mjs and tools/pick-deals.mjs share, from fixed seeds.
// Fewer plays than the greedy check: each decision runs a forecast per front.
export const FORECAST_PLAYS = 120;
export const forecastCheck = board => measure(forecastFirst, board, 779, FORECAST_PLAYS);
export const hastyForecastCheck = board => measure(hastyForecast, board, 780, FORECAST_PLAYS);
export const BACKTRACK_PLAYS = 40;
export const backtrackCheck = board => measure(backtrack, board, 781, BACKTRACK_PLAYS);

// How long a winning line takes to fire, in seconds of the game's clock (onClock, the same speed
// rule as the game), for a player who sends the moment a pad is free (no thinking); Infinity when
// it does not win.
export function firingTime(board, line, land = LAND) {
  let k = 0;
  const r = onClock(board, 0, () => (k < line.length ? line[k++] : -1), land);
  return r.win ? r.seconds : Infinity;
}

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
