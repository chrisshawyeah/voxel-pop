// Prints each level as stored: its size, its crew, whether the planning player wins it, and how
// often the greedy player wins it against the level's `greedy` band (tools/players.mjs).
import { LEVELS, buildLevel } from '../js/levels.js';
import { plan, greedyCheck, GREEDY_PLAYS } from './players.mjs';

console.log(`level            cubes  crew  pads  ?  plan wins   greedy (of ${GREEDY_PLAYS})  band`);
for (let n = 0; n < LEVELS.length; n++) {
  const L = buildLevel(n);
  const p = plan(L.board);
  const rate = greedyCheck(L.board);
  const [lo, hi] = L.def.greedy;
  const hidden = L.board.columns.flat().filter(s => s.hidden).length;
  const verdict = p.win === true ? 'yes' : p.win === null ? 'gave up' : 'NO';
  console.log(`${String(n + 1).padStart(2)} ${L.def.name.padEnd(14)} ${String(L.board.total).padStart(5)}  ${String(L.shooters).padStart(4)}  ${String(L.board.slots.length).padStart(4)}  ${hidden}  ${verdict.padEnd(9)}  ${String(rate).padStart(4)}%          ${lo}-${hi}%${rate < lo || rate > hi ? '  MISS' : ''}`);
}
