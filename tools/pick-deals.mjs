// For each level, tries deals at several flip values and prints the one whose hasty win
// rate is closest to the level's target, among deals the solver wins with the level's pads and a
// patient player wins at least 90% of the time. Copy deal and flip into LEVELS.
import { LEVELS, dealLevel, rng, padsFor } from '../js/levels.js';
import { solve } from '../js/logic.js';
import { rates } from './players.mjs';

const only = process.argv[2] ? [Number(process.argv[2]) - 1] : LEVELS.map((_, i) => i);
const flips = [0, 0.2, 0.4, 0.6, 0.8, 1];
for (const n of only) {
  let best = null;
  for (const mix of [0.25, 0.5, 1]) for (const flip of flips) for (let d = 0; d < (process.argv[3] ? Number(process.argv[3]) : 6); d++) {
    const L = dealLevel(n, d, flip, mix);
    if (!solve(L.board, s => s.rank, padsFor(L.def))) continue;
    const r = rates(L.board, rng(99 + d), 40, padsFor(L.def));
    if (r.patient < 85) continue;
    const score = Math.abs(r.hasty - L.def.target);
    if (!best || score < best.score) best = { d, flip, mix, score, ...r };
  }
  console.log(`PICK ${JSON.stringify({ n, deal: best?.d, flip: best?.flip, mix: best?.mix })}`);
  console.log(`L${n + 1} ${LEVELS[n].name}: deal ${best?.d} flip ${best?.flip} mix ${best?.mix} hasty ${best?.hasty}% patient ${best?.patient}% (target ${LEVELS[n].target}%)`);
}
