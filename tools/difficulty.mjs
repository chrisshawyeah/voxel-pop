// Prints each level as stored (tools/players.mjs has every player):
//   cubes, crew, pads, "?" on screen at the start
//   plan    the planning player wins it with a line that also wins with the sends overlapping
//   greedy  how often the simple player (sends any crew that can shoot) wins, against the band
//   hasty   the simple player tapping whatever is ready every 150 ms, shots still in the air
//   fc      the player who follows the finishes-or-parks mark and waits for the pads to stop
//   fc-h    the same player tapping a ticked front every 150 ms
//   back    the mark-following player that undoes when out of room (at most 50 undos): how often
//           it wins, and the median undos of its wins
//   sends   median sends per play of fc and of back (back's include the sends it took back)
//   fire    seconds a winning line takes to fire for a player who sends the moment a pad frees
//           (the game runs at 3x while there is nothing to send)
//   node tools/difficulty.mjs        every level
//   node tools/difficulty.mjs 17     level 17 only
import { LEVELS, buildLevel } from '../js/levels.js';
import { plan, greedyCheck, hastyCheck, lineHolds, forecastCheck, hastyForecastCheck, backtrackCheck, firingTime, GREEDY_PLAYS } from './players.mjs';

const only = process.argv.slice(2).find(a => /^\d+$/.test(a));
const pad = (v, n) => String(v).padStart(n);
console.log(`level             cubes  crew  pads  ?  plan  greedy (of ${GREEDY_PLAYS})  hasty   fc  fc-h  back undos  sends  fire`);
for (let n = 0; n < LEVELS.length; n++) {
  if (only !== undefined && n !== Number(only) - 1) continue;
  const L = buildLevel(n);
  const p = plan(L.board, { holds: line => lineHolds(L.board, line) });
  const rate = greedyCheck(L.board);
  const hasty = hastyCheck(L.board);
  const fc = forecastCheck(L.board), fch = hastyForecastCheck(L.board), back = backtrackCheck(L.board);
  const [lo, hi] = L.def.greedy;
  const hidden = L.board.columns.flat().filter(s => s.hidden).length;
  const verdict = p.win === true ? (p.holds ? 'yes' : 'NOT HELD') : p.win === null ? 'gave up' : 'NO';
  const fire = p.line ? firingTime(L.board, p.line) : NaN;
  console.log(`${pad(n + 1, 2)} ${L.def.name.padEnd(14)} ${pad(L.board.total, 5)}  ${pad(L.shooters, 4)}  ${pad(L.board.slots.length, 4)}  ${hidden}  ${verdict.padEnd(4)}  ${pad(rate, 4)}% ${`${lo}-${hi}%`.padEnd(8)}${rate < lo || rate > hi ? 'MISS' : '    '}  ${pad(hasty, 4)}%  ${pad(fc.rate, 3)}%  ${pad(fch.rate, 3)}%  ${pad(back.rate, 3)}% ${pad(back.undos ?? '-', 5)}  ${pad(fc.sends, 2)}/${pad(back.sends, 2)}  ${fire.toFixed(1)}s`);
}
