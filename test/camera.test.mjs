import test from 'node:test';
import assert from 'node:assert/strict';
import { camBack } from '../js/logic.js';

// The camera's framing helpers, on their own so they run in a second (the level suite takes about half an hour).

test('camBack stands the camera further back for a bigger sculpture and closer for a wider lens', () => {
  const at = (fov, aspect, reach) => camBack(fov, aspect, 6, reach, 0.3);
  const base = at(50, 0.6, 3);
  assert.ok(Number.isFinite(base) && base > 0, `a positive distance, got ${base}`);
  assert.ok(at(50, 0.6, 6) > base, 'a sculpture reaching further needs the camera further back');
  assert.ok(at(70, 0.6, 3) < base, 'a wider lens brings the camera closer');
  assert.ok(at(50, 1.2, 3) <= base, 'a wider picture never pushes the camera further back');
});
