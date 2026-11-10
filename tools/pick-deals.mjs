// Picks each level's deal offline, so the game never searches for one.
//
//   node tools/pick-deals.mjs            every level, several at once
//   node tools/pick-deals.mjs 12         level 12 only
//   node tools/pick-deals.mjs --write    ... and write the picks into js/levels.js
//
// For a level it tries deals of the level's own settings (mix, flip), then of nearby settings,
// and keeps a deal that the planning player wins (tools/players.mjs) and whose greedy win rate
// over 300 plays (the same plays the tests make) lands inside the level's `greedy` band, clear
// of its edges. When no
// deal lands in the band it keeps the nearest one the planning player wins and says so.
// It prints one line per level and, at the end, the level lines to copy into js/levels.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LEVELS, dealLevel, rng } from '../js/levels.js';
import { greedyRate, greedyCheck, plan } from './players.mjs';

const args = process.argv.slice(2);
const write = args.includes('--write');
const json = args.includes('--json');
const tries = Number((args.find(a => a.startsWith('--tries=')) || '--tries=40').slice(8));
const only = args.find(a => /^\d+$/.test(a));
// --set='{"crew":[40,70],"cols":4}' tries other settings for the level(s) without editing the file.
const set = JSON.parse((args.find(a => a.startsWith('--set=')) || '--set={}').slice(6));

const MIXES = [0, 0.1, 0.2, 0.3, 0.45, 0.6];
const FLIPS = [0, 0.2, 0.4, 0.5, 0.6, 0.8];

function pick(n) {
  const def0 = { ...LEVELS[n], ...set };
  const [lo, hi] = def0.greedy;
  // Far enough inside the band that the 300 plays are not near an edge by luck (two standard errors).
  const safe = r => { const m = 2 * Math.sqrt((r * (100 - r)) / 300); return (r - lo >= m || lo === 0) && (hi - r >= m || hi === 100); };
  // The level's own settings first, then the rest of the grid, nearest first.
  const grid = [];
  for (const mix of MIXES) for (const flip of FLIPS) grid.push({ mix, flip });
  const dist = g => Math.abs(g.mix - (def0.mix || 0)) + Math.abs(g.flip - (def0.flip || 0));
  grid.sort((a, b) => dist(a) - dist(b));
  let best = null; // in band, nearest the middle
  let near = null; // out of band, nearest the band
  const t0 = Date.now();
  for (const { mix, flip } of grid) {
    for (let deal = 0; deal < tries; deal++) {
      const def = { ...def0, mix, flip, deal };
      const L = dealLevel(def);
      if (L.shooters > 30) return { n, error: `${L.shooters} crew: more than 30 sends, use bigger crew` };
      const quick = greedyRate(L.board, rng(1000 + deal), 60);
      const off = quick < lo ? lo - quick : quick > hi ? quick - hi : 0;
      if (off > 12 && near && off >= near.off) continue; // far outside the band, and something nearer is known
      const p = plan(L.board, { budget: 30000 });
      if (p.win !== true) continue;
      const rate = greedyCheck(L.board);
      const out = rate < lo ? lo - rate : rate > hi ? rate - hi : 0;
      const found = { mix, flip, deal, rate, crew: L.shooters, boards: p.boards, off: out };
      if (!out && safe(rate)) return { n, ...found, ms: Date.now() - t0 };
      if (!out && !best) best = found;
      if (out && (!near || out < near.off)) near = found;
    }
  }
  return { n, ...(best || near || { error: 'no deal the planning player wins' }), ms: Date.now() - t0 };
}

const lineOf = (def, p) => {
  const keys = { ...def, mix: p.mix, flip: p.flip, deal: p.deal };
  const v = x => (Array.isArray(x) ? `[${x.join(', ')}]` : typeof x === 'string' ? `'${x}'` : x);
  return `  { ${['name', 'model', 'cols', 'pads', 'crew', 'hidden', 'mix', 'flip', 'greedy', 'deal'].map(k => `${k}: ${v(keys[k] ?? 0)}`).join(', ')} },`;
};

const say = (r) => {
  const d = LEVELS[r.n];
  if (r.error) return `L${r.n + 1} ${d.name}: ${r.error}`;
  return `L${r.n + 1} ${d.name}: deal ${r.deal} mix ${r.mix} flip ${r.flip}  greedy ${r.rate}% (band ${d.greedy.join('-')}%${r.off ? `, MISSED by ${r.off}` : ''})  ${r.crew} crew  ${(r.ms / 1000).toFixed(1)}s`;
};

if (only !== undefined) {
  const r = pick(Number(only) - 1);
  console.log(json ? JSON.stringify(r) : `${say(r)}\n${r.error ? '' : lineOf({ ...LEVELS[r.n], ...set }, r)}`);
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
  if (write) {
    const file = new URL('../js/levels.js', import.meta.url);
    let text = readFileSync(file, 'utf8');
    for (const r of results) {
      if (r.error) continue;
      const name = LEVELS[r.n].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`^  \\{ name: '${name}',.*$`, 'm'), lineOf({ ...LEVELS[r.n], ...set }, r));
    }
    writeFileSync(file, text);
    console.log('written to js/levels.js');
  }
}
