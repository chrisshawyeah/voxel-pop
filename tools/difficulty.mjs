// Prints each level as stored: its size, its crew, whether the planning player wins it with a line
// that also wins when the sends overlap in time (0, 150, 300 and 600 ms apart), how often the
// greedy player wins it against the level's `greedy` band, and how often the hasty greedy player
// (tapping whatever is ready every 150 ms, shots still in the air) wins it (tools/players.mjs).
import { LEVELS, buildLevel } from '../js/levels.js';
import { plan, greedyCheck, hastyCheck, lineHolds, GREEDY_PLAYS } from './players.mjs';

console.log(`level            cubes  crew  pads  ?  plan wins  holds  greedy (of ${GREEDY_PLAYS})  hasty  band`);
for (let n = 0; n < LEVELS.length; n++) {
  const L = buildLevel(n);
  const p = plan(L.board, { holds: line => lineHolds(L.board, line) });
  const rate = greedyCheck(L.board);
  const hasty = hastyCheck(L.board);
  const [lo, hi] = L.def.greedy;
  const hidden = L.board.columns.flat().filter(s => s.hidden).length;
  const verdict = p.win === true ? 'yes' : p.win === null ? 'gave up' : 'NO';
  console.log(`${String(n + 1).padStart(2)} ${L.def.name.padEnd(14)} ${String(L.board.total).padStart(5)}  ${String(L.shooters).padStart(4)}  ${String(L.board.slots.length).padStart(4)}  ${hidden}  ${verdict.padEnd(9)}  ${(p.holds ? 'yes' : 'NO').padEnd(5)}  ${String(rate).padStart(4)}%          ${String(hasty).padStart(4)}%  ${lo}-${hi}%${rate < lo || rate > hi ? '  MISS' : ''}`);
}
