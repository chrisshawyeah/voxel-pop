// Writes a retuned level into js/levels.js (Work item 13nov): the last line of a
// tools/traps.mjs design --tune run gives its lines, solution and traps.
//   node tools/apply-tune.mjs 17 tune/L17-s1.jsonl
import { readFileSync, writeFileSync } from 'node:fs';
import { LEVELS } from '../js/levels.js';
const [n, file] = process.argv.slice(2);
const def = LEVELS[Number(n) - 1];
const out = JSON.parse(readFileSync(file, 'utf8').trim().split('\n').at(-1));
if (!out.done || !out.lines) { console.error(`${file}: not done, nothing written`); process.exit(1); }
const path = new URL('../js/levels.js', import.meta.url);
const src = readFileSync(path, 'utf8').split('\n');
const k = src.findIndex(l => l.includes(`name: '${def.name}'`) && l.includes(`model: '${def.model}'`));
if (k < 0) { console.error(`no line for ${def.name}`); process.exit(1); }
const json = v => JSON.stringify(v).replace(/,/g, ', ');
let line = src[k];
line = line.replace(/lines: \[[^\]]*\]/, `lines: [${out.lines.map(l => `'${l}'`).join(', ')}]`);
line = line.replace(/solution: \[[^\]]*\]/, `solution: ${json(out.solution)}`);
line = line.replace(/traps: \[\[.*?\]\]/, `traps: ${json(out.traps)}`);
if (out.pads && def.pads !== out.pads) line = line.replace(/pads: \d+/, `pads: ${out.pads}`);
src[k] = line;
writeFileSync(path, src.join('\n'));
console.log(`level ${n} (${def.name}): greedy ${out.greedy}, follow ${out.follow}, undos ${out.undos}, ${out.moments} trap moments`);
