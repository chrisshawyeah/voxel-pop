// A picture of the screen, worked out in plain JavaScript: the sculpture drawn from a camera
// with a depth buffer, one number per pixel naming the cube that shows there. The checks use it
// to prove the crew hit only cubes the player can see (test/logic.test.mjs and
// node tools/sight.mjs, which plays levels and counts hits on cubes with too little of them
// on screen).
//
// Coordinates are the rules' own (js/logic.js): cell (x, y, z) spans [x, x + 1) on each axis.

// counts[i]: how many pixels of cube i show in a W x H picture from camera position `cam`,
// looking at `at`, with a lens `fov` degrees high and a picture `aspect` wide for its height.
export function pixels(st, cam, at, fov, aspect, W, H) {
  const { sx, sy, sz, cells } = st;
  const fx0 = at[0] - cam[0], fy0 = at[1] - cam[1], fz0 = at[2] - cam[2];
  const fl = Math.hypot(fx0, fy0, fz0);
  const f = [fx0 / fl, fy0 / fl, fz0 / fl];
  // right = f x up, up = (0, 1, 0)
  let r = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[2]) || 1;
  r = [r[0] / rl, 0, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const t = Math.tan((fov * Math.PI) / 360);
  const depth = new Float32Array(W * H).fill(Infinity);
  const owner = new Int32Array(W * H).fill(-1);
  const P = [new Float64Array(3), new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const proj = (x, y, z, out) => {
    const vx = x - cam[0], vy = y - cam[1], vz = z - cam[2];
    const zc = vx * f[0] + vy * f[1] + vz * f[2];
    const xc = vx * r[0] + vy * r[1] + vz * r[2];
    const yc = vx * u[0] + vy * u[1] + vz * u[2];
    out[0] = ((xc / (zc * t * aspect)) + 1) * 0.5 * W;
    out[1] = (1 - yc / (zc * t)) * 0.5 * H;
    out[2] = 1 / zc;
  };
  const tri = (a, b, c, id) => {
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (!area) return;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const x = px + 0.5, y = py + 0.5;
        let w0 = (b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x);
        let w1 = (c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x);
        let w2 = (a[0] - x) * (b[1] - y) - (a[1] - y) * (b[0] - x);
        if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const A = Math.abs(area);
        const iz = (w0 * a[2] + w1 * b[2] + w2 * c[2]) / A; // 1/depth, linear on screen
        const k = py * W + px;
        const d = 1 / iz;
        if (d < depth[k] - 1e-6) { depth[k] = d; owner[k] = id; }
      }
    }
  };
  const has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && cells[x + sx * (y + sy * z)] > 0;
  // The six faces: normal, and the corner offsets of the face from the cube's low corner.
  const FACES = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [n, corners] of FACES) {
      if (has(x + n[0], y + n[1], z + n[2])) continue;
      const mx = x + 0.5 + n[0] * 0.5, my = y + 0.5 + n[1] * 0.5, mz = z + 0.5 + n[2] * 0.5;
      if (n[0] * (cam[0] - mx) + n[1] * (cam[1] - my) + n[2] * (cam[2] - mz) <= 0) continue;
      corners.forEach((c, k) => proj(x + c[0], y + c[1], z + c[2], P[k]));
      tri(P[0], P[1], P[2], i);
      tri(P[0], P[2], P[3], i);
    }
  }
  const counts = new Map();
  for (const id of owner) if (id >= 0) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

// How big a whole face of one cube looks, in pixels, seen square on from the camera: the
// yardstick a share of a cube on screen is measured against.
export function facePixels(cam, at, fov, H) {
  const d = Math.hypot(at[0] - cam[0], at[1] - cam[1], at[2] - cam[2]);
  const side = H / (2 * d * Math.tan((fov * Math.PI) / 360));
  return side * side;
}
