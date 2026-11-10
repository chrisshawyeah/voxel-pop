// Simple players for measuring difficulty.
// patient: lets every pad fire out before adding the next crew member, and prefers a front
//   whose colour can be hit now (avoiding "?" crew while it has a better choice).
// hasty: the same choice, but taps about once a second (each pad fires `burst` shots
//   between taps), so it parks crew while others are still busy, like a quick human.
import { cloneBoard, canFire, fire, release, purgeCleared, isWon, freeSlot, deploy, isJammed } from '../js/logic.js';

function choose(st, rand) {
  const fronts = st.columns.map((c, i) => (c.length ? i : -1)).filter(i => i >= 0);
  if (!fronts.length) return -1;
  const good = fronts.filter(i => !st.columns[i][0].hidden && st.exposed[st.columns[i][0].color].size > 0);
  const pick = good.length ? good : fronts;
  return pick[Math.floor(rand() * pick.length)];
}

export function play(board, rand, { burst = Infinity, slots = 5 } = {}) {
  const st = cloneBoard(board);
  st.slots = Array(slots).fill(null);
  for (let guard = 0; guard < 20000; guard++) {
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < st.slots.length; i++) {
        for (let k = 0; k < burst && canFire(st, i); k++) { fire(st, i); progress = burst === Infinity; }
        if (st.slots[i] && st.slots[i].count <= 0) { release(st, i); progress = burst === Infinity; }
      }
      if (purgeCleared(st).length && burst === Infinity) progress = true;
    }
    if (isWon(st)) return true;
    if (isJammed(st)) return false;
    if (freeSlot(st) >= 0) {
      const c = choose(st, rand);
      if (c >= 0) deploy(st, c);
    }
  }
  return false;
}

export function rates(board, rand, N = 60) {
  let patient = 0, hasty = 0;
  for (let k = 0; k < N; k++) {
    patient += play(board, rand);
    hasty += play(board, rand, { burst: 14 });
  }
  return { patient: Math.round((100 * patient) / N), hasty: Math.round((100 * hasty) / N) };
}
