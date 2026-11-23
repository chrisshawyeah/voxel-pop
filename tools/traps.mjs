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
//                                         into js/levels.js
//
// A trap [k, j]: after the first k sends of the solution (each followed by waiting until the pads
// stop, as the planning player plays), sending line j instead loses whatever comes after, and
// line j's front crew member has cubes of its colour on the outside, so it looks ready. The checks
// look with every hidden crew member known, so a trap loses even for a player who could see them.
import { LEVELS, buildLevel, dealLevel, modelFor } from '../js/levels.js';
import { cloneBoard, deploy, settle } from '../js/logic.js';
import { plan } from './players.mjs';

const BUDGET = 30000;

// The board with every hidden crew member shown.
function known(board) {
  const st = cloneBoard(board);
  st.columns.forEach(col => col.forEach(s => { s.hidden = false; }));
  return st;
}

// The board after the first k sends of `line`, waiting for the pads to stop after each.
export function after(board, line, k) {
  const st = known(board);
  settle(st);
  for (let i = 0; i < k; i++) { deploy(st, line[i]); settle(st); }
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
  if (st.cleared !== st.total) misses.push(`the solution leaves ${st.total - st.cleared} cubes`);
  for (const [k, j] of def.traps) {
    const at = after(L.board, def.solution, k);
    if (!tempting(at, j)) misses.push(`trap [${k}, ${j}]: line ${j + 1}'s front crew member has nothing to shoot`);
    else if (loses(at, j) !== true) misses.push(`trap [${k}, ${j}]: sending line ${j + 1} does not lose`);
  }
  return misses;
}

// A board's lines as `lines` strings for js/levels.js.
export function linesOf(board, names) {
  return board.columns.map(col => col.map(s => `${s.hidden ? '?' : ''}${names[s.color]} ${s.count}`).join(', '));
}

const [cmd, arg, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => { const a = rest.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
if (cmd === 'check') {
  let bad = 0;
  LEVELS.forEach((def, n) => {
    if (!def.traps) return;
    const misses = checkTraps(n);
    console.log(`${n + 1} ${def.name}: ${misses.length ? misses.join('; ') : `${def.traps.length} traps hold`}`);
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
  const names = modelFor(def).names;
  for (let deal = from; deal < from + tries; deal++) {
    const L = dealLevel({ ...def, deal });
    const p = plan(L.board, { budget: 60000 });
    if (!p.win) { console.log(JSON.stringify({ deal, win: p.win })); continue; }
    const traps = findTraps(L.board, p.line);
    const moments = new Set(traps.map(t => t[0])).size;
    console.log(JSON.stringify({ deal, win: true, moments, traps, solution: p.line, lines: linesOf(L.board, names), pads: def.pads, crew: L.shooters }));
  }
}
