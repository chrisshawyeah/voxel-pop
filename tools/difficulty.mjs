// Prints each level as stored (tools/players.mjs has every player):
//   cubes, crew, pads, "?" on screen at the start
//   hid     colours hidden at the start, fully+partly: waiting on cubes of another colour
//           (tools/players.mjs hiddenColours); the layers are what make crew wait on a pad
//   plan    the planning player wins it with a line that also wins with the sends overlapping
//   greedy  how often the simple player (sends any crew that can shoot) wins, against the band
//   hasty   the simple player tapping whatever is ready every 150 ms, shots still in the air
//   fc      the player who follows the forecast and waits for the pads to stop, against `follow`
//   fc-h    the same player tapping a ticked front every 150 ms
//   back    the forecast follower that undoes when out of room (at most 50 undos): how often it
//           wins, and the median undos of its wins, against `undos`
//   sends   median sends per play of fc and of back (back's include the sends it took back)
//   fire    seconds a winning line takes to fire for a player who sends the moment a pad frees
//           (the game's clock: 3x only while there is nothing to send)
// and at the end every place the levels break the curve (tools/players.mjs curveMisses).
//   node tools/difficulty.mjs        every level
//   node tools/difficulty.mjs 17     level 17 only
import { LEVELS, buildLevel } from '../js/levels.js';
import { plan, greedyCheck, hastyCheck, lineHolds, forecastCheck, hastyForecastCheck, backtrackCheck, firingTime, curveMisses, hiddenColours, GREEDY_PLAYS } from './players.mjs';

const only = process.argv.slice(2).find(a => /^\d+$/.test(a));
const pad = (v, n) => String(v).padStart(n);
const band = ([lo, hi], v) => `${`${lo}-${hi}`.padEnd(6)}${v < lo || v > hi ? 'MISS' : '    '}`;
console.log(`level             cubes  crew  pads  ?  hid  plan  greedy (of ${GREEDY_PLAYS})    hasty   fc            fc-h  back undos       sends  fire`);
const m = [];
for (let n = 0; n < LEVELS.length; n++) {
  if (only !== undefined && n !== Number(only) - 1) continue;
  const L = buildLevel(n);
  const p = plan(L.board, { holds: line => lineHolds(L.board, line) });
  const rate = greedyCheck(L.board);
  const hasty = hastyCheck(L.board);
  const fc = forecastCheck(L.board), fch = hastyForecastCheck(L.board), back = backtrackCheck(L.board);
  m[n] = { fc: fc.rate, undos: back.undos };
  const hidden = L.board.columns.flat().filter(s => s.hidden).length;
  const hid = hiddenColours(L.board);
  const verdict = p.win === true ? (p.holds ? 'yes' : 'NOT HELD') : p.win === null ? 'gave up' : 'NO';
  const fire = p.line ? firingTime(L.board, p.line) : NaN;
  const undoMiss = back.undos === null || back.undos > L.def.undos ? 'MISS' : '    ';
  console.log(`${pad(n + 1, 2)} ${L.def.name.padEnd(14)} ${pad(L.board.total, 5)}  ${pad(L.shooters, 4)}  ${pad(L.board.slots.length, 4)}  ${hidden}  ${`${hid.full}+${hid.part}`.padEnd(3)}  ${verdict.padEnd(4)}  ${pad(rate, 4)}% ${band(L.def.greedy, rate)}  ${pad(hasty, 4)}%  ${pad(fc.rate, 3)}% ${band(L.def.follow, fc.rate)}  ${pad(fch.rate, 3)}%  ${pad(back.rate, 3)}% ${pad(back.undos ?? '-', 3)} (<=${L.def.undos}) ${undoMiss}  ${pad(fc.sends, 2)}/${pad(back.sends, 2)}  ${fire.toFixed(1)}s`);
}
if (only === undefined) {
  const misses = curveMisses(LEVELS, m);
  console.log(misses.length ? `\nthe curve:\n${misses.map(x => `  ${x.text}`).join('\n')}` : '\nthe curve holds');
}
