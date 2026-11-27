// tools/traps.mjs as a command: what it refuses, and when tuning calls a board done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../js/levels.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const traps = (args, node = []) => spawnSync(process.execPath, [...node, 'tools/traps.mjs', ...args], { cwd: root, encoding: 'utf8' });

test('traps.mjs find, search and design refuse a level or a sculpture that does not exist, by name', () => {
  for (const n of ['0', `${LEVELS.length + 1}`, 'six']) {
    const r = traps(['find', n]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(`there is no level ${n}: the levels are 1 to ${LEVELS.length}`));
  }
  // No sculpture named, one that does not exist, and a level number written as a sculpture
  // (`--level 6` with a space is not --level=6).
  for (const [args, name] of [[['search'], 'undefined'], [['search', 'nosuch'], 'nosuch'], [['design', '--tune', '--steps=0'], 'undefined'],
    [['design', '6', '--steps=0'], '6'], [['design', '--level', '6', '--steps=0'], '6']]) {
    const r = traps(args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, new RegExp(`there is no sculpture ${name}: the sculptures are mushroom, `), args.join(' '));
  }
});

test('traps.mjs design --tune is not done when a full measure misses what the level tests want, though the quick looks pass', () => {
  // The penguin dealt on 2 pads (deal 4) has three trap moments and no unfair one; the greedy player
  // wins 3% of the quick look's 120 plays and 9% of the full 300. Made level 5 with a greedy band of
  // 0-6% (follow and undos left loose), the quick looks settle the tuning at once, 3 points inside the
  // band, and the full measure is outside it, so the level tests would fail the board. (It was the
  // duck's deal 0 until 14nov: that board has a crew member that parks a few cubes short, so design
  // no longer settles it.)
  const levels = new URL('../js/levels.js', import.meta.url).href;
  const asLevel5 = `data:text/javascript,import { LEVELS } from '${levels}'; LEVELS[4] = { name: 'Penguin', model: 'penguin', cols: 3, pads: 2, crew: [60, 110], hidden: 0, mix: 0.1, flip: 0.8, deal: 4, greedy: [0, 6], follow: [0, 100], undos: 6 };`;
  const r = traps(['design', '--level=5', '--tune', '--steps=0'], ['--import', asLevel5]);
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual([out.done, out.moments, out.greedy, out.misses], [false, 3, 9, ['greedy wins 9%, outside 0-6%']], r.stdout);
});
