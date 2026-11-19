// Plays levels with random sends under the current rules and checks each shot against a picture
// of the screen at the exact moment it leaves and when it lands.
import { buildLevel, LEVELS } from '../js/levels.js';
import * as R from '../js/logic.js';
import { pixels, facePixels } from './sight.mjs';
import { rng } from '../js/levels.js';

const FOV = 14;
function cam(st, yawU, pitchU, aspect) {
  const p = R.pitchRad(pitchU), sp = Math.sin(p), cp = Math.cos(p);
  const a = R.yawRad(yawU);
  const top = st.topY, rad = st.tableR, reachR = st.reachR;
  const ty = -0.6 + (top + 0.6) * 0.46;
  const tan = Math.tan((FOV * Math.PI) / 360), tanUp = tan * 0.92, tanDown = tan * 0.74, tanH = tan * aspect * 0.9;
  let d = 0;
  const fit = (x, y, z) => { const dy = y - ty, depth = dy * sp + z * cp, up = dy * cp - z * sp; d = Math.max(d, depth + Math.abs(x) / tanH, depth + Math.abs(up) / (up > 0 ? tanUp : tanDown)); };
  for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); fit(c * rad, -0.6, s * rad); fit(c * rad, 0, s * rad); fit(c * reachR, top, s * reachR); }
  return { pos: [st.sx / 2 - cp * d * Math.sin(a), ty + sp * d, st.sz / 2 + cp * d * Math.cos(a)], at: [st.sx / 2, ty, st.sz / 2] };
}

const levels = process.argv[2] ? process.argv[2].split(',').map(Number) : LEVELS.map((_, k) => k);
const ASPECTS = { phone: [0.66, 390, 590], laptop: [1.4, 700, 500] };
for (const n of levels) {
  const tally = { shots: 0, phone0: 0, laptop0: 0, land0: 0, sliver: 0, stall: 0, stall0: 0, step0: 0, won: 0, stuck: 0, plays: 0 };
  for (let play = 0; play < 3; play++) {
    const L = buildLevel(n);
    const st = L.board;
    const rand = rng(1000 + play);
    let guard = 0, quiet = 0;
    tally.plays++;
    while (!R.isWon(st) && !R.isJammed(st) && guard++ < 200000) {
      if (R.freeSlot(st) >= 0 && !R.busy(st)) {
        const cols = st.columns.map((c, i) => i).filter(i => st.columns[i].length);
        if (!cols.length) break;
        R.deploy(st, cols[Math.floor(rand() * cols.length)]);
      }
      const wasStall = st.quiet > R.STALL;
      const r = R.tickGame(st);
      if (r.shots.length || r.landed.length) quiet = 0; else if (++quiet > 2 * R.STALL && R.busy(st)) { tally.stuck++; break; }
      for (const s of r.shots) {
        tally.shots++;
        if (wasStall) tally.stall++;
        { const vs = R.VIEW_STEP; const vy = st.spin ? Math.floor(st.yaw / vs) * vs + vs / 2 : st.yaw; const c = cam(st, vy, st.pitch, 0.66); const px = pixels(st, c.pos, c.at, FOV, 0.66, 390, 590).get(s.cell) || 0; if (!px) { if (wasStall) tally.stall0++; else tally.step0++; } }
        // the board as the shot leaves: the cube is still there (taken, not removed)
        for (const [name, [asp, W, H]] of Object.entries(ASPECTS)) {
          const c = cam(st, st.yaw, st.pitch, asp);
          const px = pixels(st, c.pos, c.at, FOV, asp, W, H).get(s.cell) || 0;
          const full = facePixels(c.pos, c.at, FOV, H);
          if (px === 0) tally[name + '0']++;
          if (name === 'phone' && px > 0 && px < full * 0.1) tally.sliver++;
        }
        const yl = R.turned(st.yaw, st.spin * R.FLIGHT);
        const c = cam(st, yl, st.pitch, 0.66);
        if (!(pixels(st, c.pos, c.at, FOV, 0.66, 390, 590).get(s.cell) || 0)) tally.land0++;
      }
    }
  }
  const won = ' won ' + tally.won + '/' + tally.plays + ', stuck ' + tally.stuck;
  const pc = k => ((100 * tally[k]) / Math.max(1, tally.shots)).toFixed(1) + '%';
  console.log(`${n + 1} ${LEVELS[n].name}: shots ${tally.shots}, hidden on phone at launch ${pc('phone0')}, on laptop ${pc('laptop0')}, by landing ${pc('land0')}, sliver ${pc('sliver')}; stall shots ${pc('stall')}, hidden at the rules' own view: from stall ${pc('stall0')}, not stall ${pc('step0')};${won}`);
}
