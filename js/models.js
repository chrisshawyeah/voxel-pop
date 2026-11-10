// The sculptures, drawn in code as grids of cubes. x runs left to right, y is up, the front faces +z.
//
// To add your own: write a function like the ones below, add its name to MODELS at the bottom,
// then give it a line in LEVELS (js/levels.js).
//   const s = new Sculpt(width, height, depth);
//   s.fill((x, y, z) => true or false, 'red')    puts cubes wherever the test is true
//   s.paint((x, y, z, colour) => ..., 'white')   recolours cubes that are already there
//   s.set(x, y, z, 'blue')                       one cube; s.set(x, y, z, null) removes it
//   s.skin(x, y, z)                              true when that cube can be seen from outside
//   return s.done();
// Colours are the names in COLORS; add any you like. A colour buried inside another is what
// makes a level tricky: its crew have nothing to hit until the outside is opened.

export const COLORS = {
  red: '#ff4b5c', orange: '#ff9a2e', yellow: '#ffd23f', green: '#36c46f', teal: '#1fc6bd',
  blue: '#3f7cff', purple: '#9a5cf5', pink: '#ff6fb3', white: '#f7f2e8', brown: '#a2683f',
  charcoal: '#3a3e4b', cream: '#ffd7a3', grey: '#a7aec0', terracotta: '#e0714a', tan: '#c98a4b',
  lilac: '#c7a6ff',
};
// No two colours in one sculpture should be easy to mix up: a player tells crew apart by colour
// alone. Pale pairs (cream and white, cream and yellow), red and pink, blue and purple, and
// terracotta and brown are the ones to avoid together.

class Sculpt {
  constructor(sx, sy, sz) {
    Object.assign(this, { sx, sy, sz, cx: (sx - 1) / 2, cy: (sy - 1) / 2, cz: (sz - 1) / 2 });
    this.cells = new Uint8Array(sx * sy * sz);
    this.names = [];
  }
  id(name) {
    let k = this.names.indexOf(name);
    if (k < 0) { this.names.push(name); k = this.names.length - 1; }
    return k + 1;
  }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz; }
  get(x, y, z) {
    if (!this.inside(x, y, z)) return null;
    const v = this.cells[x + this.sx * (y + this.sy * z)];
    return v ? this.names[v - 1] : null;
  }
  set(x, y, z, name) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (!this.inside(x, y, z)) return;
    this.cells[x + this.sx * (y + this.sy * z)] = name ? this.id(name) : 0;
  }
  // fn(x, y, z, current) returns a colour name to set, null to clear, or undefined to leave.
  each(fn) {
    for (let z = 0; z < this.sz; z++) for (let y = 0; y < this.sy; y++) for (let x = 0; x < this.sx; x++) {
      const r = fn(x, y, z, this.get(x, y, z));
      if (r !== undefined) this.set(x, y, z, r);
    }
    return this;
  }
  skin(x, y, z) {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => !this.get(x + a, y + b, z + c));
  }
  fill(test, name) { return this.each((x, y, z) => (test(x, y, z) ? name : undefined)); }
  paint(test, name) { return this.each((x, y, z, cur) => (cur && test(x, y, z, cur) ? name : undefined)); }
  done() {
    // Re-number colours so the palette holds only the ones still used.
    const used = [...new Set(this.cells)].filter(Boolean).sort((a, b) => a - b);
    const map = new Map(used.map((v, k) => [v, k + 1]));
    const cells = this.cells.map(v => (v ? map.get(v) : 0));
    const names = used.map(v => this.names[v - 1]);
    return { sx: this.sx, sy: this.sy, sz: this.sz, cells, names, palette: names.map(n => COLORS[n]) };
  }
}

const sq = v => v * v;
const hash = (x, y, z) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function mushroom() {
  const s = new Sculpt(11, 10, 11);
  const { cx, cz } = s;
  s.fill((x, y, z) => y <= 4 && sq(x - cx) + sq(z - cz) <= sq(1.9), 'tan'); // the stem, darker than the white spots
  s.fill((x, y, z) => y >= 4 && sq(x - cx) / sq(5.1) + sq(y - 4) / sq(4.4) + sq(z - cz) / sq(5.1) <= 1, 'red');
  const spots = [[cx, 8.3, cz]];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.4;
    spots.push([cx + 4.3 * Math.cos(a), 6.3, cz + 4.3 * Math.sin(a)]);
  }
  s.paint((x, y, z) => spots.some(([a, b, c]) => sq(x - a) + sq(y - b) + sq(z - c) <= sq(1.35)), 'white');
  return s.done();
}

function duck() {
  const s = new Sculpt(17, 14, 13);
  const cz = s.cz;
  s.fill((x, y, z) => y === 0 && sq(x - 8) / sq(8.4) + sq(z - cz) / sq(6.4) <= 1, 'blue');
  s.fill((x, y, z) => y >= 1 && sq(x - 7) / sq(5.6) + sq(y - 4) / sq(3.2) + sq(z - cz) / sq(4.1) <= 1, 'yellow');
  s.fill((x, y, z) => sq(x - 2) + sq(y - 6) + sq(z - cz) <= sq(1.6), 'yellow');
  const head = [11, 9, cz];
  s.fill((x, y, z) => sq(x - head[0]) + sq(y - head[1]) + sq(z - head[2]) <= sq(3.0), 'yellow');
  s.fill((x, y, z) => x >= 13 && x <= 16 && y >= 8 && y <= 9 && Math.abs(z - cz) <= 1.2, 'orange');
  for (const side of [-1, 1]) {
    const e = [head[0] + 1.9, head[1] + 1.3, head[2] + side * 2.3];
    s.paint((x, y, z) => sq(x - e[0]) + sq(y - e[1]) + sq(z - e[2]) <= sq(0.95), 'charcoal');
  }
  s.paint((x, y, z) => Math.abs(z - cz) >= 3.2 && y >= 3 && y <= 5 && x >= 4 && x <= 9, 'orange');
  return s.done();
}

function cactus() {
  const s = new Sculpt(13, 21, 13);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  s.fill((x, y, z) => y <= 5 && r2(x, z) <= sq(3.4 + y * 0.28), 'terracotta');
  s.fill((x, y, z) => y >= 5 && y <= 6 && r2(x, z) <= sq(5.2), 'terracotta');
  s.fill((x, y, z) => y === 6 && r2(x, z) <= sq(4.1), 'charcoal'); // the soil
  s.fill((x, y, z) => y >= 7 && y <= 16 && r2(x, z) <= sq(2.3), 'green');
  s.fill((x, y, z) => y >= 16 && sq(x - cx) + sq(y - 16) * 1.6 + sq(z - cz) <= sq(2.3), 'green');
  // left arm
  s.fill((x, y, z) => x >= 2 && x <= cx && sq(y - 10) + sq(z - cz) <= sq(1.3), 'green');
  s.fill((x, y, z) => y >= 10 && y <= 14 && sq(x - 2) + sq(z - cz) <= sq(1.4), 'green');
  // right arm
  s.fill((x, y, z) => x >= cx && x <= 10 && sq(y - 12) + sq(z - cz) <= sq(1.3), 'green');
  s.fill((x, y, z) => y >= 12 && y <= 15 && sq(x - 10) + sq(z - cz) <= sq(1.4), 'green');
  s.fill((x, y, z) => y >= 18 && y <= 19 && r2(x, z) <= sq(y === 18 ? 1.6 : 0.8), 'pink');
  s.fill((x, y, z) => y === 15 && sq(x - 2) + sq(z - cz) <= sq(0.6), 'pink');
  return s.done();
}

function rocket() {
  const s = new Sculpt(13, 25, 13);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  s.fill((x, y, z) => y <= 1 && r2(x, z) <= sq(y === 0 ? 1.2 : 2.1), 'orange');
  s.paint((x, y, z) => r2(x, z) <= sq(0.8), 'yellow');
  s.fill((x, y, z) => y >= 2 && y <= 3 && r2(x, z) <= sq(2.6), 'charcoal');
  s.fill((x, y, z) => y >= 4 && y <= 16 && r2(x, z) <= sq(3.6), 'white');
  s.fill((x, y, z) => y >= 17 && y <= 23 && r2(x, z) <= sq(3.6 * (1 - (y - 16.5) / 7.5)), 'red');
  s.fill((x, y, z) => y >= 4 && y <= 9 && (Math.abs(x - cx) < 0.6 || Math.abs(z - cz) < 0.6) && r2(x, z) <= sq(6 - (y - 4) * 0.45), 'red');
  s.paint((x, y, z) => z >= cz + 2 && sq(x - cx) + sq(y - 13) <= sq(1.9), 'charcoal');
  s.paint((x, y, z) => z >= cz + 2 && sq(x - cx) + sq(y - 13) <= sq(1.2), 'blue');
  s.paint((x, y, z) => y === 16, 'red');
  s.paint((x, y, z) => y >= 5 && y <= 15 && r2(x, z) <= sq(1.9), 'grey'); // the engine inside
  return s.done();
}

function penguin() {
  const s = new Sculpt(13, 18, 13);
  const { cx, cz } = s;
  s.fill((x, y, z) => y >= 1 && sq(x - cx) / sq(5) + sq(y - 7.5) / sq(7) + sq(z - cz) / sq(4.6) <= 1, 'charcoal');
  s.paint((x, y, z) => z >= cz + 1.5 && sq(x - cx) / sq(3.6) + sq(y - 6) / sq(5.4) <= 1, 'white');
  for (const side of [-1, 1]) {
    s.paint((x, y, z) => z >= cz + 1.5 && sq(x - cx - side * 1.7) + sq(y - 11.2) <= sq(1.2), 'white');
    s.paint((x, y, z) => z >= cz + 3 && sq(x - cx - side * 1.7) + sq(y - 11.2) <= sq(0.5), 'charcoal');
    s.fill((x, y, z) => y >= 4 && y <= 9 && sq(x - cx - side * 5.2) + sq(z - cz) <= sq(1.2) && Math.abs(x - cx) > 4.4, 'charcoal');
    s.fill((x, y, z) => y === 0 && sq(x - cx - side * 1.8) + sq(z - cz - 1.8) <= sq(1.6), 'orange');
  }
  s.fill((x, y, z) => y >= 9 && y <= 10 && Math.abs(x - cx) <= 0.6 && z > cz + 3 && z <= cz + 6, 'orange');
  // a big heart inside
  s.paint((x, y, z) => {
    const u = (x - cx) / 3.1, v = (y - 6.4) / 3.1;
    return Math.abs(z - cz) <= 1.6 && (u * u + v * v - 1) ** 3 - u * u * v ** 3 <= 0;
  }, 'pink');
  return s.done();
}

function balloon() {
  const s = new Sculpt(17, 26, 17);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  const outer = y => (y >= 16 ? 7.4 * Math.sqrt(Math.max(0, 1 - sq((y - 16) / 8.6))) : 7.4 * Math.pow(Math.max(0, (y - 8) / 8), 0.62));
  const gores = ['red', 'yellow', 'blue', 'yellow'];
  s.fill((x, y, z) => {
    const r = Math.sqrt(r2(x, z)), R = outer(y);
    return y >= 9 && r <= R && r >= R - 2.4;
  }, 'red');
  s.each((x, y, z, cur) => {
    if (!cur) return undefined;
    if (y >= 23) return 'red';
    const a = Math.atan2(z - cz, x - cx) + Math.PI;
    return gores[Math.floor((a / (Math.PI * 2)) * 8) % 4];
  });
  s.fill((x, y, z) => y >= 8 && y <= 9 && r2(x, z) <= sq(2.2), 'charcoal');
  s.fill((x, y, z) => y >= 10 && y <= 14 && r2(x, z) <= sq(2.2 - (y - 10) * 0.4), 'orange'); // the flame inside
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    s.fill((x, y, z) => y >= 4 && y <= 8 && x === cx + dx && z === cz + dz, 'charcoal');
  }
  s.fill((x, y, z) => y <= 3 && Math.abs(x - cx) <= 2.5 && Math.abs(z - cz) <= 2.5, 'brown');
  return s.done();
}

function lighthouse() {
  const s = new Sculpt(15, 26, 15);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  s.fill((x, y, z) => y <= 3 && r2(x, z) <= sq(6.6 - y * 0.6 + hash(x, 0, z) * 1.4), 'grey');
  s.each((x, y, z, cur) => (y >= 4 && y <= 17 && r2(x, z) <= sq(3.9 - (y - 4) * 0.08) ? (Math.floor((y - 4) / 3) % 2 ? 'white' : 'red') : undefined));
  s.paint((x, y, z) => y >= 4 && y <= 6 && z >= cz + 2.8 && Math.abs(x - cx) <= 0.6, 'blue');
  s.paint((x, y, z) => (y === 10 || y === 14) && z >= cz + 2.6 && Math.abs(x - cx) <= 0.6, 'blue');
  s.paint((x, y, z) => y >= 5 && y <= 17 && r2(x, z) <= sq(1.7), 'brown'); // the stairs inside
  s.fill((x, y, z) => y === 18 && r2(x, z) <= sq(4.6), 'charcoal');
  s.fill((x, y, z) => y >= 19 && y <= 21 && r2(x, z) <= sq(2.5), 'yellow');
  s.paint((x, y, z) => y >= 19 && y <= 21 && (Math.abs(x - cx) < 0.6 || Math.abs(z - cz) < 0.6) && r2(x, z) > sq(1.6), 'charcoal');
  s.fill((x, y, z) => y >= 22 && y <= 24 && r2(x, z) <= sq(3.2 - (y - 22) * 1.15), 'red');
  s.fill((x, y, z) => y === 25 && r2(x, z) <= 0.3, 'charcoal');
  return s.done();
}

function robot() {
  const s = new Sculpt(17, 23, 11);
  const box = (x0, x1, y0, y1, z0, z1, c) => s.fill((x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1, c);
  box(3, 6, 0, 1, 2, 8, 'charcoal'); box(10, 13, 0, 1, 2, 8, 'charcoal');
  box(4, 6, 2, 5, 3, 7, 'grey'); box(10, 12, 2, 5, 3, 7, 'grey');
  box(3, 13, 6, 13, 2, 8, 'blue');
  box(5, 11, 8, 11, 8, 8, 'white');
  s.set(6, 10, 8, 'red'); s.set(8, 10, 8, 'yellow'); s.set(10, 10, 8, 'red');
  box(6, 10, 9, 9, 8, 8, 'charcoal');
  box(0, 2, 7, 12, 4, 6, 'grey'); box(14, 16, 7, 12, 4, 6, 'grey');
  box(0, 2, 5, 6, 4, 6, 'yellow'); box(14, 16, 5, 6, 4, 6, 'yellow');
  box(7, 9, 14, 14, 4, 6, 'charcoal');
  box(4, 12, 15, 20, 2, 8, 'blue');
  box(5, 11, 17, 18, 8, 8, 'teal');
  s.set(6, 17, 8, 'yellow'); s.set(10, 17, 8, 'yellow'); s.set(6, 18, 8, 'yellow'); s.set(10, 18, 8, 'yellow');
  box(8, 8, 21, 21, 5, 5, 'charcoal');
  box(7, 9, 22, 22, 4, 6, 'red'); s.set(8, 22, 5, 'red');
  box(3, 3, 17, 18, 4, 6, 'grey'); box(13, 13, 17, 18, 4, 6, 'grey');
  box(4, 12, 7, 12, 3, 7, 'green'); // circuits inside
  box(5, 11, 16, 19, 3, 7, 'orange');
  return s.done();
}

function planet() {
  const s = new Sculpt(23, 15, 23);
  const c = [11, 7, 11];
  const n = [0.28, 1, 0.12]; const nl = Math.hypot(...n); n.forEach((v, i) => (n[i] = v / nl));
  s.each((x, y, z) => {
    const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
    if (d <= 2.6) return 'purple';
    if (d <= 4.0) return 'teal';
    if (d <= 5.3) return 'yellow';
    if (d <= 6.6) return 'pink';
    const h = (x - c[0]) * n[0] + (y - c[1]) * n[1] + (z - c[2]) * n[2];
    const pr = Math.sqrt(Math.max(0, d * d - h * h));
    if (Math.abs(h) <= 0.6 && pr >= 8.2 && pr <= 10.6) return 'orange';
    return undefined;
  });
  return s.done();
}

function castle() {
  const s = new Sculpt(25, 20, 21);
  const box = (x0, x1, y0, y1, z0, z1, c) => s.fill((x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1, c);
  s.fill((x, y, z) => y === 0 && sq(x - 12) / sq(12.4) + sq(z - 10) / sq(10.4) <= 1, 'green');
  s.fill((x, y, z) => y === 1 && sq(x - 12) / sq(12.4) + sq(z - 10) / sq(10.4) <= 1 && !(x >= 3 && x <= 21 && z >= 2 && z <= 18), 'blue');
  box(5, 19, 1, 7, 4, 4, 'grey'); box(5, 19, 1, 7, 16, 16, 'grey');
  box(5, 5, 1, 7, 4, 16, 'grey'); box(19, 19, 1, 7, 4, 16, 'grey');
  s.each((x, y, z, cur) => (y === 8 && (x === 5 || x === 19 || z === 4 || z === 16) && x >= 5 && x <= 19 && z >= 4 && z <= 16 && (x + z) % 2 === 0 ? 'white' : undefined));
  box(11, 13, 1, 4, 16, 16, 'brown');
  for (const [tx, tz] of [[5, 4], [19, 4], [5, 16], [19, 16]]) {
    s.fill((x, y, z) => y >= 1 && y <= 10 && sq(x - tx) + sq(z - tz) <= sq(2.2), 'grey');
    s.fill((x, y, z) => y >= 11 && y <= 14 && sq(x - tx) + sq(z - tz) <= sq(2.8 - (y - 11) * 0.85), 'red');
  }
  box(9, 15, 1, 11, 8, 12, 'white');
  s.paint((x, y, z) => (y === 6 || y === 9) && (x === 11 || x === 13) && z === 12, 'blue');
  s.fill((x, y, z) => y >= 12 && y <= 15 && Math.abs(x - 12) <= 3.4 - (y - 12) && Math.abs(z - 10) <= 2.4 - (y - 12) * 0.7, 'red');
  box(10, 14, 2, 10, 9, 11, 'yellow'); // the gold inside the keep
  box(12, 12, 16, 18, 10, 10, 'charcoal');
  box(13, 15, 17, 18, 10, 10, 'yellow');
  return s.done();
}

function dolls() {
  const s = new Sculpt(17, 24, 13);
  const { cx, cz } = s;
  const B = 0.9;
  const inside = (x, y, z, k) => {
    const b = sq(x - cx) / sq(6.6 * k * B) + sq(y - 7.6 * k * B) / sq(8 * k * B) + sq(z - cz) / sq(5.6 * k * B) <= 1;
    const h = sq(x - cx) + sq(y - 17.8 * k * B) + sq(z - cz) <= sq(4.9 * k * B);
    return b || h;
  };
  const layers = [[1, 'red'], [0.8, 'teal'], [0.6, 'yellow'], [0.4, 'purple']];
  for (const [k, c] of layers) s.fill((x, y, z) => inside(x, y, z, k), c);
  layers.forEach(([k], li) => {
    const next = layers[li + 1]?.[0] ?? 0;
    const shell = (x, y, z) => inside(x, y, z, k) && !(next && inside(x, y, z, next));
    const hy = 17.8 * k * B;
    s.paint((x, y, z) => shell(x, y, z) && z > cz + 1 && sq(x - cx) / sq(3.1 * k) + sq(y - hy) / sq(3.4 * k) <= 1, 'white');
    for (const side of [-1, 1]) {
      s.paint((x, y, z) => shell(x, y, z) && z > cz + 1 && sq(x - cx - side * 1.3 * k) + sq(y - hy - 0.6 * k) <= sq(Math.max(0.55, 0.7 * k)), 'charcoal');
    }
  });
  // flowers on the outer doll's belly
  for (const [fx, fy] of [[-2.6, 6], [2.6, 6], [0, 3.6], [0, 8.6]]) {
    s.paint((x, y, z) => z > cz + 3.3 && sq(x - cx - fx) + sq(y - fy) <= sq(1.2), 'orange');
  }
  return s.done();
}

// ---- nine more ----

function cupcake() {
  const s = new Sculpt(13, 15, 13);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  // the paper cup, wider at the top, in stripes
  s.each((x, y, z) => {
    if (y > 5 || r2(x, z) > sq(3.6 + y * 0.35)) return undefined;
    const a = Math.atan2(z - cz, x - cx) + Math.PI;
    return Math.floor((a / (Math.PI * 2)) * 10) % 2 ? 'teal' : 'white';
  });
  s.paint((x, y, z) => y <= 5 && r2(x, z) <= sq(2.2 + y * 0.3), 'brown'); // the cake inside
  s.fill((x, y, z) => y >= 6 && y <= 7 && r2(x, z) <= sq(5.9), 'lilac'); // three rings of frosting
  s.fill((x, y, z) => y >= 8 && y <= 9 && r2(x, z) <= sq(4.4), 'lilac');
  s.fill((x, y, z) => y >= 10 && y <= 11 && r2(x, z) <= sq(2.9), 'lilac');
  s.paint((x, y, z, cur) => cur === 'lilac' && s.skin(x, y, z) && hash(x, y, z) < 0.12, 'yellow'); // sprinkles
  s.fill((x, y, z) => sq(x - cx) + sq(y - 13) + sq(z - cz) <= sq(1.5), 'red'); // the cherry
  return s.done();
}

function burger() {
  const s = new Sculpt(15, 13, 15);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  const disc = (y0, y1, r, c) => s.fill((x, y, z) => y >= y0 && y <= y1 && r2(x, z) <= sq(r), c);
  disc(0, 2, 6.2, 'tan'); // bottom bun
  disc(3, 3, 7.0, 'green'); // lettuce
  disc(4, 6, 6.4, 'charcoal'); // patty
  s.fill((x, y, z) => y === 7 && Math.abs(x - cx) <= 6 && Math.abs(z - cz) <= 6, 'yellow'); // cheese, square so its corners poke out
  disc(8, 8, 6.0, 'red'); // tomato
  s.fill((x, y, z) => y >= 9 && sq(x - cx) / sq(6.4) + sq(y - 9) / sq(3.6) + sq(z - cz) / sq(6.4) <= 1, 'tan'); // top bun
  s.paint((x, y, z, cur) => cur === 'tan' && y >= 10 && !s.get(x, y + 1, z) && hash(x, y, z) < 0.22, 'white'); // sesame seeds
  return s.done();
}

function fish() {
  const s = new Sculpt(19, 13, 9);
  const cy = 6, cz = s.cz;
  s.fill((x, y, z) => sq(x - 11) / sq(6.4) + sq(y - cy) / sq(4.6) + sq(z - cz) / sq(3.4) <= 1, 'orange');
  s.paint(x => x === 8 || x === 9 || x === 13, 'white'); // stripes, right through the body
  s.paint(x => x === 7 || x === 10 || x === 12 || x === 14, 'charcoal');
  s.fill((x, y, z) => x <= 5 && Math.abs(z - cz) <= 0.6 && Math.abs(y - cy) <= 1 + (5 - x) * 0.9, 'orange'); // tail
  s.paint((x, y, z) => x <= 1 && Math.abs(z - cz) <= 0.6, 'charcoal');
  s.fill((x, y, z) => y >= 10 && y <= 12 && x >= 9 && x <= 13 - (y - 10) && Math.abs(z - cz) <= 0.6, 'orange'); // top fin
  for (const side of [-1, 1]) {
    s.paint((x, y, z) => sq(x - 15) + sq(y - 7) <= sq(1.1) && (z - cz) * side >= 1.5, 'white');
    s.paint((x, y, z) => x === 15 && y === 7 && (z - cz) * side >= 1.5, 'charcoal');
  }
  return s.done();
}

function gift() {
  const s = new Sculpt(11, 13, 11);
  const { cx, cz } = s;
  s.fill((x, y, z) => y <= 8 && x >= 1 && x <= 9 && z >= 1 && z <= 9, 'blue');
  s.fill((x, y) => y >= 9 && y <= 10, 'teal'); // the lid, a little wider than the box
  s.paint((x, y, z) => Math.abs(x - cx) < 0.6 || Math.abs(z - cz) < 0.6, 'yellow'); // ribbon
  s.paint((x, y, z) => y >= 2 && y <= 7 && Math.abs(x - cx) <= 2 && Math.abs(z - cz) <= 2, 'pink'); // the present inside
  s.paint((x, y, z) => y >= 3 && y <= 6 && Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1, 'white');
  for (const side of [-1, 1]) {
    s.fill((x, y, z) => y >= 11 && y <= 12 && Math.abs(z - cz) < 0.6 && (x - cx) * side >= 1 && (x - cx) * side <= 3, 'yellow'); // bow
  }
  s.set(cx, 11, cz, 'yellow');
  return s.done();
}

function tree() {
  const s = new Sculpt(13, 22, 13);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  s.fill((x, y, z) => y <= 2 && r2(x, z) <= sq(1.6), 'brown');
  for (const [y0, h, r] of [[3, 6, 6], [8, 6, 4.8], [13, 6, 3.6]]) { // three tiers, each a cone
    s.fill((x, y, z) => y >= y0 && y < y0 + h && r2(x, z) <= sq(r * (1 - (y - y0) / h) + 0.6), 'green');
  }
  s.paint((x, y, z) => y >= 3 && y <= 16 && r2(x, z) <= sq(1.2), 'brown'); // the trunk runs up inside
  s.each((x, y, z, cur) => { // baubles on the outside
    if (cur !== 'green' || !s.skin(x, y, z)) return undefined;
    const h = hash(x, y, z);
    return h < 0.07 ? 'red' : h < 0.14 ? 'yellow' : h < 0.19 ? 'blue' : undefined;
  });
  s.fill((x, y, z) => y >= 19 && y <= 21 && Math.abs(x - cx) + Math.abs(y - 20) <= 1 && Math.abs(z - cz) < 0.6, 'yellow'); // star
  return s.done();
}

function melon() {
  const s = new Sculpt(15, 15, 15);
  const c = 7;
  s.each((x, y, z) => {
    const d = Math.hypot(x - c, y - c, z - c);
    if (d > 7.2) return undefined;
    if (x > c && y > c && z > c) return undefined; // one slice is already cut out, so the inside shows
    if (d > 6.2) return 'green';
    if (d > 5.3) return 'white';
    return hash(x, y, z) < 0.07 ? 'charcoal' : 'red';
  });
  return s.done();
}

function snowman() {
  const s = new Sculpt(13, 23, 13);
  const { cx, cz } = s;
  const r2 = (x, z) => sq(x - cx) + sq(z - cz);
  const ball = (cy, r, c) => s.fill((x, y, z) => r2(x, z) + sq(y - cy) <= sq(r), c);
  ball(5, 5.6, 'white'); ball(12, 4.2, 'white'); ball(17, 3.1, 'white');
  ball(5, 2.6, 'blue'); // a lump of ice in the middle
  s.fill((x, y, z) => y === 15 && r2(x, z) <= sq(3.6), 'red'); // scarf
  s.fill((x, y, z) => y === 13 && Math.abs(z - cz) < 0.6 && Math.abs(x - cx) >= 4, 'brown'); // stick arms
  s.paint((x, y, z) => z >= cz + 3 && x === cx && (y === 10 || y === 12 || y === 14), 'charcoal'); // buttons
  s.paint((x, y, z) => z >= cz + 2 && y === 18 && Math.abs(x - cx) === 1, 'charcoal'); // eyes
  s.fill((x, y, z) => y === 17 && x === cx && z > cz + 2 && z <= cz + 5, 'orange'); // carrot nose
  s.fill((x, y, z) => y === 20 && r2(x, z) <= sq(3.4), 'charcoal'); // hat
  s.fill((x, y, z) => y >= 21 && y <= 22 && r2(x, z) <= sq(2.2), 'charcoal');
  s.paint((x, y, z) => y === 21 && r2(x, z) > sq(1.2), 'red');
  return s.done();
}

function house() {
  const s = new Sculpt(15, 16, 13);
  const box = (x0, x1, y0, y1, z0, z1, c) => s.fill((x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1, c);
  box(0, 14, 0, 0, 0, 12, 'green'); // lawn
  box(2, 12, 1, 8, 2, 10, 'white'); // walls
  s.fill((x, y, z) => y >= 9 && y <= 14 && x >= 1 && x <= 13 && Math.abs(z - 6) <= 5.6 - (y - 9), 'red'); // roof
  box(7, 8, 1, 4, 10, 10, 'brown'); // door
  for (const x0 of [4, 10]) { box(x0, x0 + 1, 5, 6, 10, 10, 'blue'); box(x0, x0 + 1, 5, 6, 2, 2, 'blue'); } // windows
  box(10, 11, 12, 15, 3, 4, 'grey'); // chimney
  box(4, 10, 2, 7, 4, 8, 'yellow'); // the light inside
  return s.done();
}

function patchwork() {
  const s = new Sculpt(9, 9, 9);
  const names = ['red', 'yellow', 'blue', 'green', 'white', 'orange'];
  s.each((x, y, z) => names[(Math.floor(x / 3) + 2 * Math.floor(y / 3) + 3 * Math.floor(z / 3)) % 6]); // 27 blocks of 27 cubes
  return s.done();
}

export const MODELS = {
  mushroom, duck, cactus, rocket, penguin, balloon, lighthouse, robot, planet, castle, dolls,
  cupcake, burger, fish, gift, tree, melon, snowman, house, patchwork,
};
