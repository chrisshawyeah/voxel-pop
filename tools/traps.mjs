// The planned hard moments of a level (Work item 9nov): sends that look right, because the front
// crew member could shoot at once, but lose, though the level is still won by another send.
//
//   node tools/traps.mjs check            every level with `traps`: the solution still wins and
//                                         each trap still loses (the tests run the same check)
//   node tools/traps.mjs find 14          the traps along level 14's solution, as they are now
//   node tools/traps.mjs search birdcage --cols=4 --pads=4 --crew=40,70 --hidden=1 --mix=0.2
//        --flip=0.6 [--from=0 --tries=30]
//                                         deals the sculpture with those settings, deal after deal,
//                                         and prints each one whose solution has one to three
//                                         moments with a trap, written out as `lines` to copy
//                                         into js/levels.js, with how many unfair moments it has;
//                                         with --measure, only deals whose planned line holds and
//                                         fires within 30 s, and those with traps and no unfair
//                                         moment measured as tools/difficulty.mjs does
//   node tools/traps.mjs design globe --cols=3 --pads=3 --crew=70,110 --hidden=1 --deal=4
//        [--seed=1 --steps=200]
//                                         starts from that deal and moves crew between and along
//                                         the lines, one change at a time, keeping a change that
//                                         leaves the level won with no more unfair moments and at
//                                         least as many trap moments, until none is unfair and one
//                                         to three moments have a trap; then prints it
//                                         as `lines`, measured, like search --measure
//   node tools/traps.mjs design --level=6 [--seed=1 --steps=200 --tune --undos=0]
//                                         the same, starting from level 6's own lines; with
//                                         --tune it keeps going until rushing (the hasty greedy
//                                         player) wins no more than 6 points above waiting and the
//                                         greedy player is inside the level's band, by quick
//                                         looks of 120 plays each, then until the forecast
//                                         follower is inside the level's follow band and the
//                                         backtracking player's median undos are at most the
//                                         level's (or --undos), keeping one to three moments;
//                                         done only when the full measures pass as the level tests
//                                         want them, or it prints done: false and the misses
//   node tools/traps.mjs fair [14]        every level's unfair moments along its solution (levels
//                                         without one, along the planning player's line), or
//                                         "fair"; exit 1 when any level has one
//
// A trap [k, j]: after the first k sends of the solution (each followed by waiting until the pads
// stop, as the planning player plays), sending line j instead loses whatever comes after, and
// line j's front crew member has cubes of its colour on the outside, so it looks ready. The checks
// look with every hidden crew member known, so a trap loses even for a player who could see them.
//
// An unfair moment (Work item 14nov): a front crew member that looks ready, parks if it is sent,
// though more than three quarters of what it carries shows on the screen. Search, design and
// tools/pick-deals.mjs keep no deal or change with one.
import { pathToFileURL } from 'node:url';
import { LEVELS, buildLevel, dealLevel, modelFor, rng } from '../js/levels.js';
import { MODELS } from '../js/models.js';
import { cloneBoard, deploy, settle, revealLone, forecast, seen, pitchUnits, START_PITCH, TURN, VIEW_STEP, YAW_STEPS } from '../js/logic.js';
import { plan, lineHolds, firingTime, greedyCheck, hastyCheck, forecastCheck, backtrackCheck, greedyRate, hastyRate } from './players.mjs';

const BUDGET = 30000;

// The board with every hidden crew member shown.
function known(board) {
  const st = cloneBoard(board);
  st.columns.forEach(col => col.forEach(s => { s.hidden = false; }));
  return st;
}

// The board after the first k sends of `line`, waiting for the pads to stop after each; null when
// one of them cannot be sent (its line is empty, or no pad is free).
export function after(board, line, k) {
  const st = known(board);
  settle(st);
  for (let i = 0; i < k; i++) { if (!deploy(st, line[i])) return null; settle(st); }
  return st;
}

// Sending line j on settled board st loses: true when proved, false when it wins, null when the
// search ran out of budget.
export function loses(st, j, budget = BUDGET) {
  if (!st.columns[j].length) return null;
  const nx = cloneBoard(st);
  deploy(nx, j);
  settle(nx);
  const r = plan(nx, { budget });
  return r.win === false ? true : r.win ? false : null;
}

// Line j's front crew member looks ready on settled board st: cubes of its colour are on the outside.
export const tempting = (st, j) => st.columns[j].length > 0 && st.exposed[st.columns[j][0].color].size > 0;

// ---------- fair counts (Work item 14nov) ----------
// Chris, November 27th: "just leaving one hidden is really feels kind of cruel". A person sees
// about how many cubes of a colour show, not the exact number, so a crew member that looks ready
// and then parks has to look short: what shows of its colour is at most FAIR of what it carries.
// 75 showing against 100 carried is a comparison a person makes; 90 against 100 is not.
export const FAIR = 0.75;
// The heights the count is taken from: from below, the height a level starts at, and from above.
const LOOKS = [pitchUnits(-0.8), START_PITCH, pitchUnits(1.2)];

// How many cubes of colour c the screen shows over one turn of the sculpture at each of those
// heights: the cubes on the outside that seen() finds from some step of a turn. Worked out on a
// copy, so the board's own view stays as it is.
export function inSight(st, c) {
  const sim = cloneBoard(st), shown = new Set();
  sim.spin = TURN;
  for (const pitch of LOOKS) {
    sim.pitch = pitch;
    for (let v = 0; v < YAW_STEPS / VIEW_STEP; v++) {
      sim.yaw = v * VIEW_STEP;
      for (const i of st.exposed[c]) if (!shown.has(i) && seen(sim, i)) shown.add(i);
    }
  }
  return shown.size;
}

// The fronts on settled board st that look ready, park if sent alone, and show more than FAIR of
// what they carry: [{ j, color, count, shows, left }]. The cheap test goes first: a colour with no
// more than FAIR of the crew member's number on the outside cannot show more than that.
export function unfairFronts(st) {
  const out = [];
  st.columns.forEach((col, j) => {
    const s = col[0];
    if (!s || st.exposed[s.color].size <= FAIR * s.count) return;
    const f = forecast(st, j);
    if (!f || f.finishes) return;
    const shows = inSight(st, s.color);
    if (shows > FAIR * s.count) out.push({ j, color: s.color, count: s.count, shows, left: f.left });
  });
  return out;
}

// Every unfair moment along `line` (a winning order of sends), on the boards the planning player
// sends from, the pads stopped after each send: [{ k, j, color, count, shows, left }], k the sends
// made before it. The line's own sends count too: a crew member left a few cubes short is as
// cruel when it is the right send.
export function unfairMoments(board, line) {
  const st = known(board), out = [];
  settle(st);
  for (let k = 0; k < line.length; k++) {
    for (const u of unfairFronts(st)) out.push({ k, ...u });
    if (!deploy(st, line[k])) throw new Error(`send ${k + 1} of the line cannot happen`);
    settle(st);
  }
  return out;
}

// One unfair moment in words.
export const sayUnfair = (u, names) =>
  `after ${u.k} send${u.k === 1 ? '' : 's'}, line ${u.j + 1}'s ${names[u.color]} ${u.count} shows ${u.shows} and parks with ${u.left}`;

// Every trap along `line` (a winning order of sends): [[k, j], ...].
export function findTraps(board, line, budget = BUDGET) {
  const out = [];
  for (let k = 0; k < line.length; k++) {
    const st = after(board, line, k);
    if (!st) throw new Error(`send ${k} of the line cannot happen`);
    for (let j = 0; j < st.columns.length; j++) {
      if (j === line[k] || !tempting(st, j)) continue;
      if (loses(st, j, budget) === true) out.push([k, j]);
    }
  }
  return out;
}

// The level's own check: its solution wins, and each of its traps is tempting and loses.
export function checkTraps(n) {
  const L = buildLevel(n), def = L.def, misses = [];
  const st = after(L.board, def.solution, def.solution.length);
  if (!st) return [`send ${def.solution.findIndex((_, i) => !after(L.board, def.solution, i + 1)) + 1} of the solution cannot happen`];
  if (st.cleared !== st.total) misses.push(`the solution leaves ${st.total - st.cleared} cubes`);
  for (const [k, j] of def.traps) {
    const at = after(L.board, def.solution, k);
    if (!at || !tempting(at, j)) misses.push(`trap [${k}, ${j}]: line ${j + 1}'s front crew member has nothing to shoot`);
    else if (loses(at, j) !== true) misses.push(`trap [${k}, ${j}]: sending line ${j + 1} does not lose`);
  }
  return misses;
}

// A board's lines as `lines` strings for js/levels.js.
export function linesOf(board, names) {
  return board.columns.map(col => col.map(s => `${s.hidden ? '?' : ''}${names[s.color]} ${s.count}`).join(', '));
}

// The commands run only when this file is run, not when the tests import checkTraps.
const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
// The command and its level or model are the words that are not flags; the flags may come anywhere.
const args = main ? process.argv.slice(2) : [];
const [cmd, arg] = args.filter(x => !x.startsWith('--'));
const opt = (name, dflt) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
// A level by its number (its index from 0), or a sculpture by its name; one that does not exist is refused by name.
const levelAt = s => { const n = Number(s) - 1; if (!LEVELS[n]) throw new Error(`there is no level ${s}: the levels are 1 to ${LEVELS.length}`); return n; };
const sculptureNamed = s => { if (!Object.hasOwn(MODELS, s)) throw new Error(`there is no sculpture ${s}: the sculptures are ${Object.keys(MODELS).join(', ')}`); return s; };
if (cmd === 'check') {
  let bad = 0;
  LEVELS.forEach((def, n) => {
    if (!def.traps) return;
    const misses = checkTraps(n);
    console.log(`${n + 1} ${def.name}: ${misses.length ? misses.join('; ') : `${def.traps.length} ${def.traps.length === 1 ? "trap holds" : "traps hold"}`}`);
    bad += misses.length;
  });
  process.exitCode = bad ? 1 : 0;
} else if (cmd === 'find') {
  const n = levelAt(arg), L = buildLevel(n);
  const line = L.def.solution || plan(L.board).line;
  console.log(JSON.stringify({ level: n + 1, solution: line, traps: line ? findTraps(L.board, line) : null }));
} else if (cmd === 'fair') {
  let bad = 0;
  for (const n of arg ? [levelAt(arg)] : LEVELS.map((_, k) => k)) {
    const L = buildLevel(n), line = L.def.solution || plan(L.board).line;
    const u = line ? unfairMoments(L.board, line) : null;
    console.log(`${n + 1} ${L.def.name}: ${!u ? 'no winning line found' : u.length ? u.map(x => sayUnfair(x, L.model.names)).join('; ') : 'fair'}`);
    bad += u ? u.length : 1;
  }
  process.exitCode = bad ? 1 : 0;
} else if (cmd === 'search') {
  const def = {
    name: arg, model: sculptureNamed(arg), cols: Number(opt('cols', 4)), pads: Number(opt('pads', 4)),
    crew: opt('crew', '40,70').split(',').map(Number), hidden: Number(opt('hidden', 0)),
    mix: Number(opt('mix', 0.2)), flip: Number(opt('flip', 0.6)),
  };
  const from = Number(opt('from', 0)), tries = Number(opt('tries', 30));
  const measure = args.includes('--measure');
  const names = modelFor(def).names;
  for (let deal = from; deal < from + tries; deal++) {
    const L = dealLevel({ ...def, deal });
    // With --measure, only a deal the level tests would take: the planning player's line holds with
    // the sends overlapping, and fires within 30 seconds; then, with one to three trap moments,
    // the measures tools/difficulty.mjs prints.
    const p = plan(L.board, measure ? { holds: line => lineHolds(L.board, line) } : { budget: 60000 });
    if (!p.win || (measure && !p.holds)) { console.log(JSON.stringify({ deal, win: p.win, holds: p.holds })); continue; }
    const fire = measure ? firingTime(L.board, p.line) : null;
    if (measure && !(fire <= 30)) { console.log(JSON.stringify({ deal, win: true, fire })); continue; }
    const traps = findTraps(L.board, p.line);
    const moments = new Set(traps.map(t => t[0])).size;
    // A deal with an unfair moment is printed with how many, and not measured: it is not one to take.
    const unfair = unfairMoments(L.board, p.line).length;
    const out = { deal, win: true, moments, unfair, traps, solution: p.line, lines: linesOf(L.board, names), pads: def.pads, crew: L.shooters, fire };
    if (measure && moments >= 1 && moments <= 3 && !unfair) {
      const fc = forecastCheck(L.board), back = backtrackCheck(L.board);
      Object.assign(out, { greedy: greedyCheck(L.board), hasty: hastyCheck(L.board), follow: fc.rate, undos: back.undos, backRate: back.rate });
    }
    console.log(JSON.stringify(out));
  }
} else if (cmd === 'design') {
  const level = opt('level', null) === null ? -1 : levelAt(opt('level'));
  const tune = args.includes('--tune');
  const def = level >= 0 ? LEVELS[level] : {
    name: arg, model: sculptureNamed(arg), cols: Number(opt('cols', 3)), pads: Number(opt('pads', 3)),
    crew: opt('crew', '60,100').split(',').map(Number), hidden: Number(opt('hidden', 0)),
    mix: Number(opt('mix', 0.1)), flip: Number(opt('flip', 0.8)), deal: Number(opt('deal', 0)),
  };
  const rand = rng(Number(opt('seed', 1))), steps = Number(opt('steps', 200));
  const names = modelFor(def).names;
  const L0 = level >= 0 ? buildLevel(level) : dealLevel(def);
  // The lines as plain crew, and the board they make.
  let cols = L0.board.columns.map(col => col.map(s => ({ color: s.color, count: s.count, hidden: s.hidden })));
  const boardOf = cs => {
    const st = cloneBoard(L0.board);
    let id = 0;
    st.columns = cs.map((col, ci) => col.map(s => ({ id: id++, color: s.color, count: s.count, hidden: s.hidden, home: ci })));
    revealLone(st);
    return st;
  };
  const playable = cs => cs.every(col => col.length && !col[0].hidden && col.every((s, k) => !(s.hidden && col[k - 1]?.hidden)));
  // A change is judged by its unfair moments first (each costs 100 points, so a board with fewer
  // ranks above every board with more, and a lost board below them all), then by its trap moments,
  // then by how close a tempting send comes to one: how many pads it leaves taken once the pads
  // stop, and how many shots are left parked on them.
  const judge = cs => {
    const st = boardOf(cs);
    // Tuning plans as the level tests do, for a line that also wins with the sends overlapping.
    const p = plan(st, tune ? { holds: line => lineHolds(st, line) } : { budget: 60000 });
    if (!p.win) return { score: -Infinity };
    const traps = [];
    let near = 0;
    for (let k = 0; k < p.line.length; k++) {
      const at = after(st, p.line, k);
      for (let j = 0; j < at.columns.length; j++) {
        if (j === p.line[k] || !tempting(at, j)) continue;
        const nx = cloneBoard(at);
        deploy(nx, j);
        settle(nx);
        const taken = nx.slots.filter(Boolean);
        near = Math.max(near, taken.length + taken.reduce((a, s) => a + s.count, 0) / 1000);
        if (taken.length && loses(at, j, 20000) === true) traps.push([k, j]);
      }
    }
    const moments = new Set(traps.map(t => t[0])).size;
    const unfair = unfairMoments(st, p.line).length;
    const r = { score: (moments > 3 ? 3 - moments / 10 : moments) * 10 + near - 100 * unfair, moments, unfair, traps, line: p.line, st };
    // Tuning: with its moments in place, a change is judged by how far rushing wins above waiting
    // and the greedy player sits outside the level's band (quick looks; the full measures follow),
    // 3 points inside it except at 0 or 100, as tools/pick-deals.mjs keeps it; and a win every time
    // misses where the level tests want a loss sometimes (greedy from level 4, rushing from level 2,
    // as tools/pick-deals.mjs refuses rushing at 100). With those in place, a level's forecast
    // follower is judged against its follow band (2 points inside it except at 0 or 100), and
    // then the backtracking player's median undos against the level's `undos`, or
    // --undos= when the curve needs fewer; both by the level tests' own measures. Each stage counts
    // only once the one before it is met, and a miss counts a ten-thousandth of a point, so a board
    // with its moments in place still ranks above every board without them.
    // A line that does not hold, or takes over 30 s to fire, misses most of all. The firing time and
    // the follower's and undo player's measures are kept on the result, for the end not to run them again.
    // A board with an unfair moment is not measured: it has to lose its unfair moments first.
    if (unfair) return r;
    if (tune && moments >= 1 && moments <= 3 && (!p.holds || !((r.fire = firingTime(st, p.line)) <= 30))) r.score = 40 - 0.3;
    else if (tune && moments >= 1 && moments <= 3) {
      const g = greedyRate(st, rng(1777), 120), h = hastyRate(st, rng(1778), 120);
      const [lo, hi] = def.greedy || [0, 100];
      r.quick = { greedy: g, hasty: h };
      r.miss = Math.max(0, h - g - 6) + (lo > 0 ? Math.max(0, lo + 3 - g) : 0) + (hi < 100 ? Math.max(0, g - hi + 3) : 0)
        + (level >= 3 ? Math.max(0, g - 99) : 0) + (level >= 1 ? Math.max(0, h - 99) : 0);
      if (def.follow) {
        if (r.miss) r.miss += 2000;
        else {
          const f = r.quick.follow = (r.fc = forecastCheck(st)).rate, [flo, fhi] = def.follow;
          r.miss = (flo > 0 ? Math.max(0, flo + 2 - f) : 0) + (fhi < 100 ? Math.max(0, f - fhi + 2) : 0);
          if (r.miss) r.miss += 1000;
          else {
            const u = r.quick.undos = (r.back = backtrackCheck(st)).undos;
            r.miss = u === null ? 100 : Math.max(0, u - Number(opt('undos', def.undos)));
          }
        }
      }
      r.score = 40 - r.miss / 10000;
    }
    return r;
  };
  const settled = b => b.moments >= 1 && b.moments <= 3 && !b.unfair && (!tune || b.miss === 0);
  let best = judge(cols);
  for (let step = 0; step < steps && !settled(best); step++) {
    const next = cols.map(col => col.map(s => ({ ...s })));
    const at = () => { const ci = Math.floor(rand() * next.length); return [ci, Math.floor(rand() * next[ci].length)]; };
    const [a, i] = at(), [b, j] = at();
    if (rand() < 0.5) [next[a][i], next[b][j]] = [next[b][j], next[a][i]]; // two crew swap places
    else { const [s] = next[a].splice(i, 1); next[b].splice(Math.floor(rand() * (next[b].length + 1)), 0, s); } // one moves to another place
    if (!playable(next) || JSON.stringify(next) === JSON.stringify(cols)) continue;
    const r = judge(next);
    if (r.score >= best.score) { cols = next; best = r; console.log(JSON.stringify({ step, moments: r.moments, unfair: r.unfair, score: r.score, quick: r.quick, lines: r.st && linesOf(r.st, names) })); }
  }
  if (!settled(best)) { console.log(JSON.stringify({ done: false, moments: best.moments, ...best.unfair && { unfair: best.unfair }, quick: best.quick })); process.exit(1); }
  const st = best.st;
  // Tuning settles only on a line that holds and fires within 30 s, and on a level with its follower
  // and undos measured, all on this board with fixed seeds as it was judged: those are not run again.
  const holds = tune || lineHolds(st, best.line), fire = tune ? best.fire : firingTime(st, best.line);
  // Done only for a line the level tests take: it holds with the sends overlapping, and fires within 30 s.
  if (!holds || !(fire <= 30)) { console.log(JSON.stringify({ done: false, moments: best.moments, holds, fire })); process.exit(1); }
  const fc = best.fc ?? forecastCheck(st), back = best.back ?? backtrackCheck(st), greedy = greedyCheck(st), hasty = hastyCheck(st);
  // Tuned, done only when the full measures pass the level tests too, which the quick looks only estimate.
  const [lo, hi] = def.greedy || [0, 100], undos = Number(opt('undos', def.undos));
  const misses = !tune ? [] : [
    (greedy < lo || greedy > hi) && `greedy wins ${greedy}%, outside ${lo}-${hi}%`,
    level >= 3 && greedy === 100 && 'greedy wins every time',
    hasty > greedy + 10 && `rushing wins ${hasty}%, more than 10 points over waiting`,
    level >= 1 && hasty === 100 && 'rushing wins every time',
    def.follow && (fc.rate < def.follow[0] || fc.rate > def.follow[1]) && `the forecast follower wins ${fc.rate}%, outside ${def.follow.join('-')}%`,
    def.follow && (back.undos === null || back.undos > undos) && `the backtracking player's median is ${back.undos ?? 'no win'} undos, more than ${undos}`,
    back.rate < fc.rate && 'undo makes the forecast follower worse',
  ].filter(Boolean);
  console.log(JSON.stringify({ done: !misses.length, ...misses.length && { misses }, moments: best.moments, traps: best.traps, solution: best.line, lines: linesOf(st, names), pads: def.pads, crew: st.columns.flat().length, holds, fire,
    greedy, hasty, follow: fc.rate, undos: back.undos, backRate: back.rate }));
  if (misses.length) process.exit(1);
}
