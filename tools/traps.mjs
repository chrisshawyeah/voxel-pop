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
//                                         into js/levels.js; with --measure, only deals whose
//                                         planned line holds and fires within 30 s, and those
//                                         with traps measured as tools/difficulty.mjs does
//   node tools/traps.mjs design globe --cols=3 --pads=3 --crew=70,110 --hidden=1 --deal=4
//        [--seed=1 --steps=200]
//                                         starts from that deal and moves crew between and along
//                                         the lines, one change at a time, keeping a change that
//                                         leaves the level won with at least as many trap moments,
//                                         until one to three moments have a trap; then prints it
//                                         as `lines`, measured, like search --measure
//
// A trap [k, j]: after the first k sends of the solution (each followed by waiting until the pads
// stop, as the planning player plays), sending line j instead loses whatever comes after, and
// line j's front crew member has cubes of its colour on the outside, so it looks ready. The checks
// look with every hidden crew member known, so a trap loses even for a player who could see them.
import { pathToFileURL } from 'node:url';
import { LEVELS, buildLevel, dealLevel, modelFor, rng } from '../js/levels.js';
import { cloneBoard, deploy, settle, revealLone } from '../js/logic.js';
import { plan, lineHolds, firingTime, greedyCheck, hastyCheck, forecastCheck, backtrackCheck } from './players.mjs';

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
const [cmd, arg, ...rest] = main ? process.argv.slice(2) : [];
const opt = (name, dflt) => { const a = rest.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
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
  const n = Number(arg) - 1, L = buildLevel(n);
  const line = L.def.solution || plan(L.board).line;
  console.log(JSON.stringify({ level: n + 1, solution: line, traps: line ? findTraps(L.board, line) : null }));
} else if (cmd === 'search') {
  const def = {
    name: arg, model: arg, cols: Number(opt('cols', 4)), pads: Number(opt('pads', 4)),
    crew: opt('crew', '40,70').split(',').map(Number), hidden: Number(opt('hidden', 0)),
    mix: Number(opt('mix', 0.2)), flip: Number(opt('flip', 0.6)),
  };
  const from = Number(opt('from', 0)), tries = Number(opt('tries', 30));
  const measure = rest.includes('--measure');
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
    const out = { deal, win: true, moments, traps, solution: p.line, lines: linesOf(L.board, names), pads: def.pads, crew: L.shooters, fire };
    if (measure && moments >= 1 && moments <= 3) {
      const fc = forecastCheck(L.board), back = backtrackCheck(L.board);
      Object.assign(out, { greedy: greedyCheck(L.board), hasty: hastyCheck(L.board), follow: fc.rate, undos: back.undos, backRate: back.rate });
    }
    console.log(JSON.stringify(out));
  }
} else if (cmd === 'design') {
  const def = {
    name: arg, model: arg, cols: Number(opt('cols', 3)), pads: Number(opt('pads', 3)),
    crew: opt('crew', '60,100').split(',').map(Number), hidden: Number(opt('hidden', 0)),
    mix: Number(opt('mix', 0.1)), flip: Number(opt('flip', 0.8)), deal: Number(opt('deal', 0)),
  };
  const rand = rng(Number(opt('seed', 1))), steps = Number(opt('steps', 200));
  const names = modelFor(def).names;
  const L0 = dealLevel(def);
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
  // A change is judged by its trap moments first, then by how close a tempting send comes to one:
  // how many pads it leaves taken once the pads stop, and how many shots are left parked on them.
  const judge = cs => {
    const st = boardOf(cs);
    const p = plan(st, { budget: 60000 });
    if (!p.win) return { score: -1 };
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
    return { score: (moments > 3 ? 3 - moments / 10 : moments) * 10 + near, moments, traps, line: p.line, st };
  };
  let best = judge(cols);
  for (let step = 0; step < steps && !(best.moments >= 1 && best.moments <= 3); step++) {
    const next = cols.map(col => col.map(s => ({ ...s })));
    const at = () => { const ci = Math.floor(rand() * next.length); return [ci, Math.floor(rand() * next[ci].length)]; };
    const [a, i] = at(), [b, j] = at();
    if (rand() < 0.5) [next[a][i], next[b][j]] = [next[b][j], next[a][i]]; // two crew swap places
    else { const [s] = next[a].splice(i, 1); next[b].splice(Math.floor(rand() * (next[b].length + 1)), 0, s); } // one moves to another place
    if (!playable(next) || JSON.stringify(next) === JSON.stringify(cols)) continue;
    const r = judge(next);
    if (r.score >= best.score) { cols = next; best = r; console.log(JSON.stringify({ step, moments: r.moments, score: r.score })); }
  }
  if (!(best.moments >= 1 && best.moments <= 3)) { console.log(JSON.stringify({ done: false, moments: best.moments })); process.exit(1); }
  const st = best.st;
  const holds = lineHolds(st, best.line), fire = firingTime(st, best.line);
  // Done only for a line the level tests take: it holds with the sends overlapping, and fires within 30 s.
  if (!holds || !(fire <= 30)) { console.log(JSON.stringify({ done: false, moments: best.moments, holds, fire })); process.exit(1); }
  const fc = forecastCheck(st), back = backtrackCheck(st);
  console.log(JSON.stringify({ done: true, moments: best.moments, traps: best.traps, solution: best.line, lines: linesOf(st, names), pads: def.pads, crew: st.columns.flat().length, holds, fire,
    greedy: greedyCheck(st), hasty: hastyCheck(st), follow: fc.rate, undos: back.undos, backRate: back.rate }));
}
