// Prints each level's size and how often the two simple players win it.
import { LEVELS, buildLevel, rng } from '../js/levels.js';
import { rates } from './players.mjs';

for (let n = 0; n < LEVELS.length; n++) {
  const L = buildLevel(n);
  const r = rates(L.board, rng(777 + n), 200, L.board.slots.length);
  console.log(`L${String(n + 1).padEnd(2)} ${L.def.name.padEnd(12)} ${String(L.board.total).padStart(5)} cubes ${L.model.palette.length} colours ${String(L.shooters).padStart(3)} crew  hasty ${String(r.hasty).padStart(3)}%  patient ${String(r.patient).padStart(3)}%  (target ${L.def.target}%)`);
}
