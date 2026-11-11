// Picks each level's deal offline, so the game never searches for one.
//
//   node tools/pick-deals.mjs            every level, several at once
//   node tools/pick-deals.mjs 12         level 12 only
//   node tools/pick-deals.mjs --write    ... and write the picks into js/levels.js
//   node tools/pick-deals.mjs 12 --write level 12 only, written into js/levels.js
//
// For a level it tries deals of the level's own settings (mix, flip), then of nearby settings,
// and keeps a deal that
//   - the planning player wins (tools/players.mjs) with a line that also wins when the sends
//     overlap in time (lineHolds: sends 0, 150, 300 and 600 ms apart, on the game's clock), and
//     that line fires in at most 30 seconds;
//   - the greedy player wins inside the level's `greedy` band (300 plays, the tests' own),
//     clear of its edges, and the hasty greedy player at most 10 points more often (and, from
//     level 2, not always);
//   - the forecast follower wins inside the level's `follow` band (2 points clear of its edges
//     when a deal can be found that is), the backtracking player needs at most `undos` undos in
//     its median won play, and both fit the curve beside the levels next to it as they are stored
//     now (tools/players.mjs curveMisses: at most 20 points easier than the level before, the
//     median undos at most 3 over the level before's and at most 1 under);
//   - on a level with `opening: 'park'`, most greedy plays (PARK_MIN %) park a crew member in
//     their first three sends.
// When no deal passes everything it keeps the one that misses least and says what it misses.
// Deals with more than 30 crew are skipped. It prints one line per level and at the end the level
// lines to copy into js/levels.js; --write writes them there, for one level or all of them. Picking
// every level at once compares each with its neighbours as stored before this run, so run the
// levels whose neighbours changed once more on their own (npm test says which).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LEVELS, dealLevel, buildLevel, rng } from '../js/levels.js';
import { greedyRate, greedyCheck, hastyCheck, forecastCheck, backtrackCheck, forecastFirst, measure, lineHolds, earlyParks, plan, firingTime, curveMisses, PARK_MIN } from './players.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const json = args.includes('--json');
const tries = Number((args.find(a => a.startsWith('--tries=')) || '--tries=40').slice(8));
const only = args.find(a => /^\d+$/.test(a));
// --list prints every deal that passes the planning player and the greedy band, with its measures,
// instead of stopping at the first that passes everything (to choose by hand).
const list = args.includes('--list');
// --set='{"crew":[40,70],"cols":4}' tries other settings for the level(s) without editing the file.
const set = JSON.parse((args.find(a => a.startsWith('--set=')) || '--set={}').slice(6));

const MIXES = [0, 0.1, 0.2, 0.3, 0.45, 0.6];
const FLIPS = [0, 0.2, 0.4, 0.5, 0.6, 0.8];
const off = (v, [lo, hi]) => (v < lo ? lo - v : v > hi ? v - hi : 0);

function pick(n) {
  const def0 = { ...LEVELS[n], ...set };
  const defs = LEVELS.map((d, k) => (k === n ? def0 : d));
  const [lo, hi] = def0.greedy;
  // Far enough inside the band that the 300 plays are not near an edge by luck (two standard errors).
  const safe = r => { const m = 2 * Math.sqrt((r * (100 - r)) / 300); return (r - lo >= m || lo === 0) && (hi - r >= m || hi === 100); };
  // The forecast follower a little inside its band too, so the curve does not sit on its edges.
  const snug = r => (r - def0.follow[0] >= 2 || def0.follow[0] === 0) && (def0.follow[1] - r >= 2 || def0.follow[1] === 100);
  // The levels beside it, as stored: the curve compares with them.
  const m = [];
  for (let k = n - 2; k <= n + 2; k++) {
    if (k < 0 || k >= LEVELS.length || k === n) continue;
    const b = buildLevel(k).board;
    m[k] = { fc: forecastCheck(b).rate, undos: backtrackCheck(b).undos };
  }
  // The level's own settings first, then the rest of the grid, nearest first.
  const grid = [];
  for (const mix of MIXES) for (const flip of FLIPS) grid.push({ mix, flip });
  const dist = g => Math.abs(g.mix - (def0.mix || 0)) + Math.abs(g.flip - (def0.flip || 0));
  grid.sort((a, b) => dist(a) - dist(b));
  let best = null; // passes everything; kept while the greedy rate is near an edge of its band
  let near = null; // misses something, by the least so far
  let big = 0;     // deals skipped for having more than 30 crew
  let easy = 0;    // deals skipped because rushing never loses (the hasty greedy player wins them all)
  let listed = 0;  // deals printed by --list
  const park = def0.opening === 'park';
  const t0 = Date.now();
  const done = found => ({ n, ...found, ms: Date.now() - t0 });
  for (const { mix, flip } of grid) {
    for (let deal = 0; deal < tries; deal++) {
      const def = { ...def0, mix, flip, deal };
      const L = dealLevel(def);
      if (L.shooters > 30) { big++; continue; } // crew sizes change with the deal: another may fit
      // Quick looks first, from the cheapest: far outside a band, with something nearer known, is skipped.
      const quick = greedyRate(L.board, rng(1000 + deal), 60);
      if (off(quick, def0.greedy) > 12 && (near || list)) continue;
      if (park && earlyParks(L.board, 40) < PARK_MIN) continue;
      const quickFc = measure(forecastFirst, L.board, 2000 + deal, 30).rate;
      if (off(quickFc, def0.follow) > 15 && (near || list)) continue;
      const p = plan(L.board, { budget: 30000, holds: line => lineHolds(L.board, line) });
      if (p.win !== true || !p.holds) continue;
      if (firingTime(L.board, p.line) > 30) continue;
      if (park && earlyParks(L.board) < PARK_MIN) continue;
      const rate = greedyCheck(L.board);
      const hasty = hastyCheck(L.board);
      if (hasty > rate + 10 || (n >= 1 && hasty >= 100)) { easy += hasty >= 100; continue; }
      const fc = forecastCheck(L.board).rate;
      const miss = { greedy: off(rate, def0.greedy), fc: off(fc, def0.follow) };
      if (near && !list && miss.greedy + miss.fc >= near.miss) continue; // the slowest measure only for a real contender
      const back = backtrackCheck(L.board);
      m[n] = { fc, undos: back.undos };
      const curve = curveMisses(defs, m).filter(x => x.n === n || x.k === n);
      const undoOff = back.undos === null ? 50 : Math.max(0, back.undos - def0.undos);
      const total = miss.greedy + miss.fc + undoOff + 5 * curve.filter(x => x.k !== x.n).length; // a step against a neighbour counts 5
      const found = { mix, flip, deal, rate, hasty, fc, undos: back.undos, crew: L.shooters, boards: p.boards, misses: curve.map(x => x.text), off: miss.greedy };
      if (list) { if (!miss.greedy) { listed++; console.error(say({ n, ...found, ms: Date.now() - t0 })); } continue; }
      if (!miss.greedy && !curve.length) {
        if (safe(rate) && snug(fc)) return done(found);
        if (!best) best = found;
        continue;
      }
      if (!near || total < near.miss) near = { ...found, miss: total };
    }
  }
  if (listed) return done({ listed }); // --list: the deals are printed above, none is picked
  if (best || near) return done(best || near);
  const why = (big ? `, ${big} deals skipped for more than 30 crew (use bigger crew)` : '') + (easy ? `, ${easy} skipped as too easy (rushing always won)` : '');
  return { n, error: `no deal the planning player wins with a line that holds when sends overlap${park ? ' (and that opens with a parked crew member)' : ''}${why}`, ms: Date.now() - t0 };
}

const lineOf = (def, p) => {
  const keys = { ...def, mix: p.mix, flip: p.flip, deal: p.deal };
  const v = x => (Array.isArray(x) ? `[${x.join(', ')}]` : typeof x === 'string' ? `'${x}'` : x);
  const names = ['name', 'model', 'cols', 'pads', 'crew', 'hidden', 'mix', 'flip', 'greedy', 'follow', 'undos', ...(keys.opening ? ['opening'] : []), 'deal'];
  return `  { ${names.map(k => `${k}: ${v(keys[k] ?? 0)}`).join(', ')} },`;
};

const say = (r) => {
  const d = { ...LEVELS[r.n], ...set };
  if (r.error) return `L${r.n + 1} ${d.name}: ${r.error}`;
  if (r.listed) return `L${r.n + 1} ${d.name}: ${r.listed} deal${r.listed === 1 ? '' : 's'} listed above  ${(r.ms / 1000).toFixed(1)}s`;
  const missed = [r.off && `greedy MISSED by ${r.off}`, ...(r.misses || [])].filter(Boolean);
  return `L${r.n + 1} ${d.name}: deal ${r.deal} mix ${r.mix} flip ${r.flip}  greedy ${r.rate}% (band ${d.greedy.join('-')}%)  hasty ${r.hasty}%  follower ${r.fc}% (band ${d.follow.join('-')}%)  undos ${r.undos ?? '-'} (at most ${d.undos})  ${r.crew} crew  ${(r.ms / 1000).toFixed(1)}s${missed.length ? `\n    MISSED: ${missed.join('; ')}` : ''}`;
};

// Writes the picked lines into js/levels.js, in place of each level's line.
function writePicks(results) {
  const file = new URL('../js/levels.js', import.meta.url);
  let text = readFileSync(file, 'utf8');
  let wrote = 0;
  for (const r of results) {
    if (!r || r.error || r.listed) continue;
    const name = LEVELS[r.n].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^  \\{ name: '${name}',.*$`, 'm');
    if (!re.test(text)) { console.log(`L${r.n + 1}: its line was not found in js/levels.js, not written`); continue; }
    text = text.replace(re, lineOf({ ...LEVELS[r.n], ...set }, r));
    wrote++;
  }
  writeFileSync(file, text);
  console.log(`${wrote} level line${wrote === 1 ? '' : 's'} written to js/levels.js`);
}

if (only !== undefined) {
  const r = pick(Number(only) - 1);
  console.log(json ? JSON.stringify(r) : `${say(r)}\n${r.error || r.listed ? '' : lineOf({ ...LEVELS[r.n], ...set }, r)}`);
  if (write && !json) writePicks([r]);
} else {
  // Every level, one child process per level, as many at once as there are processors.
  const self = fileURLToPath(import.meta.url);
  const results = [];
  let next = 0;
  const run = () => new Promise(done => {
    const go = () => {
      if (next >= LEVELS.length) return done();
      const n = next++;
      const child = spawn(process.execPath, [self, String(n + 1), '--json', `--tries=${tries}`, `--set=${JSON.stringify(set)}`]);
      let out = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => process.stderr.write(d));
      child.on('close', () => {
        const r = JSON.parse(out.trim().split('\n').pop());
        results[n] = r;
        console.log(say(r));
        go();
      });
    };
    go();
  });
  await Promise.all(Array.from({ length: Math.max(1, cpus().length - 1) }, run));
  console.log('\n// the level lines, picked:');
  for (const r of results) console.log(r.error ? `  // L${r.n + 1}: ${r.error}` : lineOf({ ...LEVELS[r.n], ...set }, r));
  if (write) writePicks(results);
}
