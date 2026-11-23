// The sculptures, drawn in code as grids of cubes. x runs left to right, y is up, the front faces +z.
//
// To add your own: write a function like the ones below, add its name to MODELS at the bottom,
// then give it a line in LEVELS (js/levels.js).
//   const s = new Sculpt(width, height, depth);
//   s.fill((x, y, z) => true or false, 'red')    puts cubes wherever the test is true
//   s.paint((x, y, z, colour) => ..., 'white')   recolours cubes that are already there
//   s.set(x, y, z, 'blue')                       one cube; s.set(x, y, z, null) removes it
//   s.skin(x, y, z)                              true when that cube can be seen from outside
//   s.depth(x, y, z)                             0 on the outside, 1 just under it, and so on
//   return s.done();
// Colours are the names in COLORS; add any you like. Any cube on the outside can be hit, from
// any side, so a sculpture is a puzzle only through its layers: a colour hidden inside others
// has nothing to hit until the cubes covering it are popped, and its crew wait on a pad. Paint
// inner layers on cubes of depth 1 or more (s.paint with s.depth) and the sculpture looks the
// same from outside; a layer of one colour all round a core keeps that core sealed until the
// layer is broken.

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
    const i = x + this.sx * (y + this.sy * z);
    if (!this.cells[i] !== !name) this.depths = null; // a cube added or removed: depths change
    this.cells[i] = name ? this.id(name) : 0;
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
  // How many cubes lie between this one and the outside: 0 for a cube with a face on the air (the
  // underside too: the sculpture floats, as in the game), 1 for one touching only those, and so on
  // (null where there is no cube). Kept until a cube is added or removed; recolouring keeps it.
  depth(x, y, z) {
    if (!this.depths) {
      const { sx, sy, sz } = this;
      const d = new Int16Array(this.cells.length).fill(-1);
      const open = (x, y, z) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => !this.get(x + a, y + b, z + c));
      let ring = [];
      this.each((x, y, z, cur) => { if (cur && open(x, y, z)) { d[x + sx * (y + sy * z)] = 0; ring.push([x, y, z]); } });
      for (let k = 1; ring.length; k++) {
        const next = [];
        for (const [x, y, z] of ring) {
          for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const X = x + a, Y = y + b, Z = z + c;
            if (!this.get(X, Y, Z)) continue;
            const i = X + sx * (Y + sy * Z);
            if (d[i] < 0) { d[i] = k; next.push([X, Y, Z]); }
          }
        }
        ring = next;
      }
      this.depths = d;
    }
    const v = this.inside(x, y, z) ? this.depths[x + this.sx * (y + this.sy * z)] : -1;
    return v < 0 ? null : v;
  }
  fill(test, name) { return this.each((x, y, z) => (test(x, y, z) ? name : undefined)); }
  // Paints the cubes inside the skin by how deep they sit: depth 1 in names[0], depth 2 in names[1]
  // and so on, the last name for everything deeper (only cubes `test` picks, all by default). The
  // skin keeps its colours, so the sculpture looks the same from outside, and each layer seals in
  // the ones under it.
  bands(names, test = () => true) {
    return this.paint((x, y, z, cur) => this.depth(x, y, z) >= 1 && test(x, y, z, cur), (x, y, z) => names[Math.min(this.depth(x, y, z), names.length) - 1]);
  }
  // Recolours about `share` of the cubes `test` picks with one of `names`, by a hash of the place
  // (the same every time): single cubes scattered through a layer, each sealed in by the layer.
  speckle(test, names, share, seed = 0) {
    return this.each((x, y, z, cur) => {
      if (!cur || !test(x, y, z, cur)) return undefined;
      const h = hash(x + 31 * seed, y, z);
      return h < share ? names[Math.floor((h / share) * names.length)] : undefined;
    });
  }
  // name may be a function of (x, y, z, current) giving the colour.
  paint(test, name) { return this.each((x, y, z, cur) => (cur && test(x, y, z, cur) ? (typeof name === 'function' ? name(x, y, z, cur) : name) : undefined)); }
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
  // Bath foam over its back. Inside, under a layer of pink rubber, more foam at the back, an orange
  // squeaker in the middle and a black weight in the head: the foam, orange and black crew pop
  // what shows of their colour, then sleep until the pink round the rest is popped (level 2
  // teaches that).
  const back = (x, z) => sq(x - 6.6) / sq(5.4) + sq(z - cz) / sq(4.0) <= 1 && x <= 8.5;
  s.paint((x, y, z) => y >= 2 && back(x, z) && !s.get(x, y + 1, z), 'white');
  s.bands(['pink', 'white']);
  s.paint((x, y, z) => s.depth(x, y, z) >= 2 && x > 6 && x <= 9, 'orange');
  s.paint((x, y, z) => s.depth(x, y, z) >= 2 && x > 9, 'charcoal');
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
  s.bands(['white', 'grey']); // inside: pale flesh and sand, with grey stones in the middle
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
  s.bands(['green', 'grey', 'yellow']); // inside: green fuel tanks round a grey engine with a yellow core
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
  // A red scarf round its neck.
  const ring = (x, z, a, b) => sq(x - cx) / sq(a) + sq(z - cz) / sq(b) <= 1;
  s.fill((x, y, z) => y >= 8 && y <= 9 && ring(x, z, 5.6, 5.2) && !ring(x, z, 3.0, 2.6), 'red');
  s.fill((x, y, z) => y >= 9 && y <= 10 && Math.abs(x - cx) <= 0.6 && z > cz + 3 && z <= cz + 6, 'orange');
  // Inside, under a layer of blue ice: green seaweed round the orange fish it ate, more red under the
  // scarf and more white behind the belly. The orange, red and white crew pop what shows of their
  // colour, then sleep until the blue round the rest is popped (level 3 teaches that).
  s.bands(['blue', 'green', 'orange']);
  s.paint((x, y, z) => s.depth(x, y, z) >= 2 && y >= 8 && y <= 10, 'red');
  s.paint((x, y, z) => s.depth(x, y, z) >= 2 && z > cz + 0.5 && y < 8, 'white');
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
  // Inside, where nobody sees it: the envelope full of orange hot air round the flame, under a white
  // lining.
  s.fill((x, y, z) => y >= 10 && y <= 22 && Math.sqrt(r2(x, z)) < outer(y) - 2.4, 'orange');
  s.bands(['white', 'orange']);
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
  s.bands(['orange', 'green', 'brown']); // inside: orange brick, green moss, the brown stairs
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
  s.bands(['green', 'orange', 'brown']); // inside: green circuits, orange wiring, a brown power core
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
  s.bands(['teal', 'orange']); // inside: teal stairs in the towers, orange treasure in the keep
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
  // Wood between the dolls, where nobody sees it: green, grey and tan round the little purple one.
  s.bands(['green', 'grey', 'tan'], (x, y, z, cur) => cur !== 'purple');
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
  s.bands(['orange', 'brown', 'grey']); // inside: orange jam, brown cake, a grey middle
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
  s.bands(['orange', 'purple', 'teal']); // inside: orange sauce, purple onion, teal pickle
  return s.done();
}

function fish() {
  const s = new Sculpt(19, 13, 9);
  const cy = 6, cz = s.cz;
  s.fill((x, y, z) => sq(x - 11) / sq(6.4) + sq(y - cy) / sq(4.6) + sq(z - cz) / sq(3.4) <= 1, 'orange');
  // A white band and a charcoal band round the body.
  s.paint((x, y) => y === 8, 'white');
  s.paint((x, y) => y === 5, 'charcoal');
  s.fill((x, y, z) => x <= 5 && Math.abs(z - cz) <= 0.6 && Math.abs(y - cy) <= 1 + (5 - x) * 0.9, 'orange'); // tail
  s.paint((x, y, z) => x <= 1 && Math.abs(z - cz) <= 0.6, 'charcoal');
  s.fill((x, y, z) => y >= 10 && y <= 12 && x >= 9 && x <= 13 - (y - 10) && Math.abs(z - cz) <= 0.6, 'orange'); // top fin
  for (const side of [-1, 1]) {
    s.paint((x, y, z) => sq(x - 15) + sq(y - 7) <= sq(1.1) && (z - cz) * side >= 1.5, 'white');
    s.paint((x, y, z) => x === 15 && y === 7 && (z - cz) * side >= 1.5, 'charcoal');
  }
  s.bands(['red', 'grey']); // inside: red flesh round grey bones
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
  s.bands(['orange', 'pink', 'white']); // inside: orange tissue paper round a pink present
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
  s.each((x, y, z, cur) => { // baubles on the outside
    if (cur !== 'green' || !s.skin(x, y, z)) return undefined;
    const h = hash(x, y, z);
    return h < 0.07 ? 'red' : h < 0.14 ? 'yellow' : h < 0.19 ? 'blue' : undefined;
  });
  s.fill((x, y, z) => y >= 19 && y <= 21 && Math.abs(x - cx) + Math.abs(y - 20) <= 1 && Math.abs(z - cz) < 0.6, 'yellow'); // star
  s.bands(['white', 'green', 'orange']); // inside, where the trunk was: snow, more branches, orange lights
  return s.done();
}

function melon() {
  const s = new Sculpt(11, 11, 11); // a small one: level 17 is a breather between two big ones
  const c = 5;
  s.each((x, y, z) => {
    const d = Math.hypot(x - c, y - c, z - c);
    if (d > 5.3) return undefined;
    if (x > c && y > c && z > c) return undefined; // one slice is already cut out, so the inside shows
    if (d > 4.3) return 'green';
    if (d > 3.5) return 'white';
    return hash(x, y, z) < 0.07 ? 'charcoal' : 'red';
  });
  s.bands(['yellow', 'orange']); // inside, behind the cut: a yellow layer and an orange heart
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
  s.bands(['grey', 'blue', 'green']); // inside each ball: packed grey snow, blue ice, a green middle
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
  s.bands(['teal', 'orange', 'yellow']); // inside: teal plaster, the orange attic and the light
  return s.done();
}

function patchwork() {
  const s = new Sculpt(9, 9, 9);
  const names = ['red', 'yellow', 'blue', 'green', 'white', 'orange'];
  s.each((x, y, z) => names[(Math.floor(x / 3) + 2 * Math.floor(y / 3) + 3 * Math.floor(z / 3)) % 6]); // 27 blocks of 27 cubes
  s.bands(['charcoal', 'brown', 'grey']); // under the skin: charcoal, brown, a grey middle
  return s.done();
}

// ---------- the floating sculptures (Work item 9nov) ----------
// Built to float, with nothing under them, and to be seen from every side and from below: cages
// whose bars hide what is inside from some angles and not others, windows that show an inside
// only at a slant, and parts that stick out, whose undersides show only from below.

// Shapes the sculptures below are built from; each fills the cells whose middle falls inside.
const box = (s, x0, x1, y0, y1, z0, z1, c) => s.fill((x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1, c);
const ball = (s, cx, cy, cz, rx, ry, rz, c, keep = () => true) =>
  s.fill((x, y, z) => sq(x - cx) / sq(rx) + sq(y - cy) / sq(ry) + sq(z - cz) / sq(rz) <= 1 && keep(x, y, z), c);
// A rod of radius r from point a to point b, round at both ends.
const rod = (s, a, b, r, c) => {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = sq(d[0]) + sq(d[1]) + sq(d[2]) || 1;
  s.fill((x, y, z) => {
    const t = Math.max(0, Math.min(1, ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / L2));
    return sq(x - a[0] - t * d[0]) + sq(y - a[1] - t * d[1]) + sq(z - a[2] - t * d[2]) <= sq(r);
  }, c);
};
// Rods through the points in turn; r may be a function of the rod's number (1, 2, ...).
const path = (s, pts, r, c) => { for (let k = 1; k < pts.length; k++) rod(s, pts[k - 1], pts[k], typeof r === 'function' ? r(k) : r, c); };
// A hoop round the axis ('x', 'y' or 'z') through (cx, cy, cz): radius R, its rod radius r.
const hoop = (s, cx, cy, cz, axis, R, r, c, keep = () => true) => s.fill((x, y, z) => {
  const [u, v, w] = axis === 'y' ? [x - cx, z - cz, y - cy] : axis === 'x' ? [y - cy, z - cz, x - cx] : [x - cx, y - cy, z - cz];
  return sq(Math.hypot(u, v) - R) + sq(w) <= sq(r) && keep(x, y, z);
}, c);
const ring2 = (x, z, cx, cz) => Math.max(Math.abs(x - cx), Math.abs(z - cz)); // square rings round a middle

// A gold birdcage: a thick drum for a floor, twelve bars over a dome, a bird on its perch inside.
// The drum is teal inside, then blue: the colours of the bird's tail and body, so their crew look
// ready from the start though most of their cubes are sealed in the drum.
function birdcage() {
  const s = new Sculpt(19, 26, 19), C = 9, R = 7.6;
  s.fill((x, y, z) => y <= 5 && Math.hypot(x - C, z - C) <= R + 0.4, 'brown');
  for (const y0 of [0, 8, 15]) hoop(s, C, y0, C, 'y', R, 0.6, 'yellow');
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    rod(s, [C + R * ca, 0, C + R * sa], [C + R * ca, 15, C + R * sa], 0.55, 'yellow');
    const pts = [];
    for (let t = 0; t <= 8; t++) { const b = (t / 8) * (Math.PI / 2); pts.push([C + R * Math.cos(b) * ca, 15 + R * 0.8 * Math.sin(b), C + R * Math.cos(b) * sa]); }
    path(s, pts, 0.55, 'yellow');
  }
  hoop(s, C, 23, C, 'z', 1.4, 0.55, 'charcoal', (x, y) => y >= 22);
  rod(s, [C, 21, C], [C, 22, C], 0.6, 'charcoal');
  rod(s, [C - R, 7, C], [C + R, 7, C], 0.8, 'brown'); // the perch
  ball(s, C, 11, C - 0.5, 3.2, 3.4, 4, 'blue');
  ball(s, C, 15.5, C + 2.5, 2.5, 2.5, 2.5, 'blue');
  s.paint((x, y, z, cur) => cur === 'blue' && y <= 12 && z >= C + 1, 'white'); // the breast
  rod(s, [C, 15.5, C + 4.5], [C, 15, C + 6.5], 0.7, 'orange');
  for (const ex of [C - 1.5, C + 1.5]) s.set(ex, 16, C + 4.5, 'charcoal');
  rod(s, [C, 11, C - 4], [C, 8, C - 7], 1.2, 'teal'); // the tail
  box(s, C + 3, C + 5, 6, 7, C - 5, C - 3, 'red'); // a seed cup
  s.bands(['yellow', 'red', 'green'], (x, y, z, cur) => cur === 'blue' || cur === 'white');
  s.bands(['teal', 'blue'], (x, y, z, cur) => cur === 'brown');
  return s.done();
}

// A lantern: glass walls in a dark frame, open panes high up, a candle inside, a roof with eaves.
function lantern() {
  const s = new Sculpt(15, 25, 15), lo = 2, hi = 12, M = 7;
  box(s, 1, 13, 0, 2, 1, 13, 'brown');
  const wall = (x, z) => x >= lo && x <= hi && z >= lo && z <= hi && (x === lo || x === hi || z === lo || z === hi);
  s.fill((x, y, z) => y >= 3 && y <= 14 && wall(x, z), 'yellow');
  s.paint((x, y, z) => y >= 3 && y <= 14 && wall(x, z) && (((x === lo || x === hi) && (z === lo || z === hi)) || y === 3 || y === 9 || y === 14 || x === M || z === M), 'charcoal');
  const pane = v => (v >= 4 && v <= 5) || (v >= 9 && v <= 10);
  s.fill((x, y, z) => y >= 10 && y <= 13 && (((z === lo || z === hi) && pane(x)) || ((x === lo || x === hi) && pane(z))), null);
  s.fill((x, y, z) => y >= 3 && y <= 8 && Math.hypot(x - M, z - M) <= 2.6, 'white'); // the candle
  ball(s, M, 10.5, M, 1.2, 2, 1.2, 'orange'); // its flame
  s.fill((x, y, z) => y >= 15 && y <= 19 && ring2(x, z, M, M) <= 7 - (y - 15) * 1.5, 'red');
  s.set(M, 20, M, 'charcoal');
  hoop(s, M, 22, M, 'z', 2, 0.55, 'charcoal', (x, y) => y >= 21);
  s.bands(['red', 'yellow'], (x, y, z, cur) => cur === 'white');
  s.bands(['charcoal', 'green'], (x, y, z, cur) => cur === 'brown');
  s.bands(['yellow', 'white'], (x, y, z, cur) => cur === 'red');
  return s.done();
}

// A jellyfish: a thick pink bell with a small hollow underneath, a stomach glowing in it, frilly
// arms and long tentacles hanging below. Inside the bell, lilac (the arms' colour), then teal (the
// tentacles'), then orange (the stomach's): crew of those colours look ready from the start, but
// most of their cubes are sealed in the bell.
function jellyfish() {
  const s = new Sculpt(19, 20, 19), C = 9;
  s.fill((x, y, z) => { const d = Math.hypot(x - C, (y - 9) * 1.15, z - C); return y >= 9 && d <= 8.6 && d >= 3.2; }, 'pink');
  s.fill((x, y, z) => y === 8 && Math.abs(Math.hypot(x - C, z - C) - 7) <= 0.9 && Math.floor((Math.atan2(z - C, x - C) + Math.PI) / (Math.PI / 8)) % 2 === 0, 'pink');
  rod(s, [C, 10, C], [C, 12, C], 0.8, 'orange');
  hoop(s, C, 10, C, 'y', 2, 0.9, 'orange');
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4, pts = [];
    for (let y = 9; y >= 0; y--) pts.push([C + 1.8 * Math.cos(a) + Math.sin(y * 0.9 + k) * 0.8, y, C + 1.8 * Math.sin(a) + Math.cos(y * 0.9 + k) * 0.8]);
    path(s, pts, 0.9, 'lilac');
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, pts = [];
    for (let y = 8; y >= 1; y--) { const r = 6.8 - (8 - y) * 0.2 + Math.sin(y + k) * 0.5; pts.push([C + r * Math.cos(a), y, C + r * Math.sin(a)]); }
    path(s, pts, 0.55, 'teal');
  }
  s.bands(['lilac', 'teal', 'orange', 'blue'], (x, y, z, cur) => cur === 'pink');
  return s.done();
}

// An airship: a striped envelope with fins, a cabin with windows hanging under it on struts.
function airship() {
  const s = new Sculpt(29, 17, 15), Z = 7;
  ball(s, 15, 11, Z, 13, 5, 6, 'red');
  s.paint((x, y, z, cur) => cur === 'red' && (x % 4 === 0 || x >= 26), 'white');
  s.fill((x, y, z) => z === Z && x <= 5 && Math.abs(y - 11) <= 5.5 - x * 0.5 && Math.abs(y - 11) >= 1, 'white');
  s.fill((x, y, z) => y === 11 && x <= 5 && Math.abs(z - Z) <= 6.5 - x * 0.7, 'white');
  box(s, 11, 19, 1, 4, 4, 10, 'brown');
  box(s, 12, 18, 2, 3, 5, 9, null);
  s.fill((x, y, z) => (z === 4 || z === 10) && y >= 2 && y <= 3 && x >= 12 && x <= 18 && x % 2 === 0, null);
  box(s, 13, 14, 2, 2, 6, 8, 'yellow'); // the pilot's seats
  for (const px of [12, 18]) rod(s, [px, 4, Z], [px, 6.5, Z], 0.6, 'charcoal');
  rod(s, [10, 2.5, 4.5], [10, 2.5, 9.5], 0.5, 'charcoal');
  rod(s, [10, 0.5, Z], [10, 4.5, Z], 0.5, 'charcoal');
  s.bands(['teal', 'orange', 'yellow'], (x, y, z, cur) => cur === 'red' || cur === 'white');
  return s.done();
}

// A pagoda: three solid storeys with dark window niches on every side, under thin roofs whose eaves
// stick far out, a teal bell hanging under each eave's corner. Inside, a charcoal layer (the colour
// of the spire and the window backs), then teal (the bells' colour), then an orange core: crew of
// those colours look ready from the start, but most of their cubes are sealed deep.
function pagoda() {
  const s = new Sculpt(21, 25, 21), C = 10;
  for (let k = 0; k < 3; k++) {
    const w = 6 - k, y0 = k * 7, e = w + 2;
    s.fill((x, y, z) => y === y0 && ring2(x, z, C, C) <= w, 'brown');
    s.fill((x, y, z) => y > y0 && y <= y0 + 4 && ring2(x, z, C, C) <= w, 'white');
    s.fill((x, y, z) => y === y0 + 5 && ring2(x, z, C, C) <= e, 'red');
    s.fill((x, y, z) => y === y0 + 6 && ring2(x, z, C, C) <= w - 1, 'red');
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      s.set(C + dx * e, y0 + 6, C + dz * e, 'red');
      s.set(C + dx * e, y0 + 4, C + dz * e, 'teal');
    }
  }
  rod(s, [C, 21, C], [C, 23, C], 0.7, 'charcoal');
  s.set(C, 24, C, 'yellow');
  s.bands(['charcoal', 'teal', 'orange'], (x, y, z, cur) => cur === 'white' || cur === 'brown');
  s.bands(['yellow'], (x, y, z, cur) => cur === 'red');
  // the window niches, cut after the layers so each shows the charcoal behind the wall
  for (let k = 0; k < 3; k++) {
    const w = 6 - k, y0 = k * 7;
    s.fill((x, y, z) => y >= y0 + 2 && y <= y0 + 3 && ring2(x, z, C, C) === w && Math.min(Math.abs(x - C), Math.abs(z - C)) <= 1, null);
  }
  return s.done();
}

// A teapot: a round body with a white band, a spout, a handle you can see through, a lid and knob.
function teapot() {
  const s = new Sculpt(23, 15, 15), cx = 11, cz = 7;
  ball(s, cx, 6, cz, 5.6, 5.5, 5.6, 'blue');
  s.paint((x, y) => y === 6 || y === 7, 'white');
  ball(s, cx, 11, cz, 3.6, 1.6, 3.6, 'blue', (x, y) => y >= 11);
  ball(s, cx, 13, cz, 1.2, 1.2, 1.2, 'yellow');
  path(s, [[15, 4, cz], [18, 6, cz], [20, 9, cz], [21.5, 10, cz]], 1.1, 'blue');
  hoop(s, 3.8, 7, cz, 'z', 3.4, 0.8, 'blue', x => x <= 6);
  s.bands(['teal', 'blue', 'brown', 'orange']);
  return s.done();
}

// An atom: a nucleus of red and green, caged by three rings, each with its electron.
function atom() {
  const s = new Sculpt(23, 23, 23), C = 11;
  ball(s, C, C, C, 5.2, 5.2, 5.2, 'red');
  s.paint((x, y, z) => hash(x, y, z) < 0.5, 'green');
  hoop(s, C, C, C, 'y', 9, 0.7, 'blue');
  hoop(s, C, C, C, 'x', 9, 0.7, 'yellow');
  hoop(s, C, C, C, 'z', 9, 0.7, 'teal');
  const e = 9 / Math.SQRT2;
  for (const [x, y, z] of [[C + e, C, C + e], [C, C + e, C - e], [C - e, C - e, C]]) ball(s, x, y, z, 1.4, 1.4, 1.4, 'white');
  s.bands(['yellow', 'blue', 'orange'], (x, y, z, cur) => cur === 'red' || cur === 'green');
  return s.done();
}

// A treehouse: roots, a trunk through a wide platform, a house with windows round the trunk, a
// roof, a ladder under the platform, and a crown of leaves.
function treehouse() {
  const s = new Sculpt(21, 27, 21), C = 10;
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5;
    path(s, [[C, 4, C], [C + 3 * Math.cos(a), 1.5, C + 3 * Math.sin(a)], [C + 5 * Math.cos(a), 0, C + 5 * Math.sin(a)]], 0.8, 'brown');
  }
  s.fill((x, y, z) => y === 9 && Math.hypot(x - C, z - C) <= 8.3, 'grey');
  box(s, C - 4, C + 4, 10, 15, C - 4, C + 4, 'orange');
  box(s, C - 3, C + 3, 10, 15, C - 3, C + 3, null);
  s.fill((x, y, z) => y >= 12 && y <= 13 && ring2(x, z, C, C) === 4 && Math.min(Math.abs(x - C), Math.abs(z - C)) <= 1, null);
  s.fill((x, y, z) => y <= 17 && Math.hypot(x - C, z - C) <= 2.2, 'brown'); // the trunk, through it all
  ball(s, C + 2.5, 11, C - 2.5, 0.9, 0.9, 0.9, 'yellow'); // a lamp
  s.fill((x, y, z) => y >= 16 && y <= 19 && ring2(x, z, C, C) <= 5.5 - (y - 16) * 1.5, 'red');
  ball(s, C, 22, C, 6, 4, 6, 'green');
  ball(s, C - 5, 19, C + 2, 3, 2.5, 3, 'green');
  ball(s, C + 5, 20, C - 3, 3, 2.5, 3, 'green');
  for (const lx of [C - 1, C + 1]) rod(s, [lx, 0, C + 8.5], [lx, 8, C + 8.5], 0.5, 'grey');
  for (let y = 1; y <= 7; y += 2) rod(s, [C - 1, y, C + 8.5], [C + 1, y, C + 8.5], 0.5, 'grey');
  s.bands(['teal', 'orange', 'lilac'], (x, y, z, cur) => cur === 'green');
  s.bands(['charcoal'], (x, y, z, cur) => cur === 'brown');
  return s.done();
}

// An hourglass: a frame of plates and posts, the glass as hoops and ribs, the sand running down.
function hourglass() {
  const s = new Sculpt(15, 23, 15), C = 7;
  const r = y => 1 + 5.5 * Math.pow(Math.abs(y - 11) / 10, 0.6);
  box(s, 0, 14, 0, 0, 0, 14, 'brown');
  box(s, 0, 14, 22, 22, 0, 14, 'brown');
  for (const [px, pz] of [[0, 0], [0, 14], [14, 0], [14, 14]]) box(s, px, px, 1, 21, pz, pz, 'brown');
  s.fill((x, y, z) => y >= 1 && y <= 21 && Math.abs(Math.hypot(x - C, z - C) - r(y)) <= 0.6 && (y % 2 === 1 || x === C || z === C), 'teal');
  s.fill((x, y, z) => y >= 12 && y <= 16 && Math.hypot(x - C, z - C) <= r(y) - 1, 'yellow');
  s.fill((x, y, z) => y >= 7 && y <= 11 && x === C && z === C, 'yellow');
  s.fill((x, y, z) => y >= 1 && y <= 6 && Math.hypot(x - C, z - C) <= (6.5 - y) * 0.9, 'yellow');
  s.bands(['orange', 'teal', 'red'], (x, y, z, cur) => cur === 'yellow');
  return s.done();
}

// An octopus: a round head with big eyes, eight arms curling out and up, suckers under them.
function octopus() {
  const s = new Sculpt(23, 17, 23), C = 11;
  ball(s, C, 11, C, 5, 5, 5.5, 'purple');
  for (const ex of [C - 2, C + 2]) { ball(s, ex, 11, C + 4.6, 1.3, 1.3, 1, 'white'); s.set(ex, 11, C + 5.6, 'charcoal'); }
  for (let k = 0; k < 8; k++) {
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.125) {
      const a = (k * Math.PI) / 4 + Math.PI / 8 + 0.35 * t, r = 3 + 6.5 * t;
      pts.push([C + r * Math.cos(a), 6.5 - 5.5 * t + (t > 0.75 ? (t - 0.75) * 12 : 0), C + r * Math.sin(a)]);
    }
    path(s, pts, j => 1.4 - 0.08 * j, 'purple');
  }
  s.paint((x, y, z, cur) => cur === 'purple' && y <= 6 && !s.get(x, y - 1, z) && hash(x, y, z) < 0.6, 'pink');
  s.bands(['pink', 'red', 'yellow'], (x, y, z, cur) => y >= 6 && cur === 'purple');
  return s.done();
}

// A windmill: a tower with windows and an open entrance, a cap, and four sails of open lattice.
// Inside the tower, orange (the sails' cloth), then brown (their frames), then grey and green: crew
// of the sails' colours look ready from the start, but most of their cubes are sealed in the tower.
function windmill() {
  const s = new Sculpt(23, 26, 17), cx = 11, cz = 7, hy = 15;
  s.fill((x, y, z) => y <= 16 && Math.hypot(x - cx, z - cz) <= 5 - y * 0.12, 'white');
  const r0 = y => 5 - y * 0.12;
  s.fill((x, y, z) => [6, 7, 11, 12].includes(y) && Math.abs(x - cx) <= 1 && Math.abs(z - cz) >= r0(y) - 1.6, null); // windows
  s.fill((x, y, z) => (y === 9 || y === 10) && Math.abs(z - cz) <= 1 && Math.abs(x - cx) >= r0(y) - 1.6, null);
  s.fill((x, y, z) => y <= 2 && Math.abs(x - cx) <= 1 && z - cz >= r0(y) - 2, null); // the doorway
  s.paint((x, y, z) => y === 4 || y === 14, 'grey'); // bands of stone round the tower
  ball(s, cx, 17, cz, 5, 4, 5, 'red', (x, y) => y >= 17);
  rod(s, [cx, hy, cz + 3], [cx, hy, cz + 8], 0.7, 'charcoal');
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4, ca = Math.cos(a), sa = Math.sin(a);
    s.each((x, y, z) => {
      if (z !== cz + 8) return undefined;
      const u = (x - cx) * ca + (y - hy) * sa, v = -(x - cx) * sa + (y - hy) * ca;
      if (u < 0 || u > 10 || v < -0.5 || v > 3.6) return undefined;
      if (Math.abs(v) <= 0.5) return 'brown'; // the spar
      if (u < 1.5) return undefined;
      if (u > 9.3 || v > 3.1) return 'brown'; // the sail's frame
      return (x + y) % 3 !== 0 ? 'orange' : undefined; // its cloth, a lattice you can see through
    });
  }
  s.bands(['orange', 'brown', 'grey', 'green'], (x, y, z, cur) => cur === 'white' || cur === 'red' || cur === 'grey');
  return s.done();
}

// A space station: a hub, a ring of cabins with windows on four spokes, solar panels on a mast,
// and a docking pod underneath.
function station() {
  const s = new Sculpt(25, 19, 25), C = 12, Y = 9;
  s.fill((x, y, z) => y >= 3 && y <= 15 && Math.hypot(x - C, z - C) <= 3.6, 'grey');
  hoop(s, C, Y, C, 'y', 10, 1.6, 'white');
  s.paint((x, y, z, cur) => cur === 'white' && y === Y && Math.hypot(x - C, z - C) > 10.8 && Math.floor((Math.atan2(z - C, x - C) + Math.PI) / (Math.PI / 12)) % 2 === 0, 'charcoal');
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    rod(s, [C + 2.5 * ca, Y, C + 2.5 * sa], [C + 8.6 * ca, Y, C + 8.6 * sa], 0.9, 'grey');
  }
  rod(s, [C, 15, C], [C, 18, C], 0.6, 'grey');
  s.fill((x, y, z) => y === 17 && Math.abs(z - C) <= 2 && Math.abs(x - C) >= 2 && Math.abs(x - C) <= 10 && (x % 2 === 0 || Math.abs(z - C) === 2), 'blue');
  ball(s, C, 1.5, C, 2, 1.6, 2, 'orange');
  s.bands(['orange', 'blue', 'yellow'], (x, y, z, cur) => cur === 'grey');
  s.bands(['yellow'], (x, y, z, cur) => cur === 'white');
  return s.done();
}

// A submarine: a long hull in yellow and grey plating with white portholes, a tower with a
// periscope, fins at the stern and an orange propeller. Inside the hull, white (the portholes'
// colour), then orange (the propeller's), then teal: crew of those colours look ready from the
// start, but most of their cubes are sealed in the hull.
function submarine() {
  const s = new Sculpt(29, 16, 13), Z = 6;
  ball(s, 15, 7, Z, 13, 4.6, 5, 'yellow');
  s.paint((x, y, z, cur) => cur === 'yellow' && x % 5 === 0, 'grey');
  box(s, 13, 18, 11, 13, 5, 7, 'grey');
  s.fill((x, y, z) => y === 12 && (z === 5 || z === 7) && (x === 14 || x === 16), null); // the tower's windows
  s.fill((x, y, z) => y === 12 && z >= 3 && z <= 9 && x >= 15 && x <= 16 && (z < 5 || z > 7), 'grey'); // its planes
  rod(s, [16, 13, Z], [16, 15, Z], 0.6, 'charcoal');
  s.fill((x, y, z) => z === Z && x >= 1 && x <= 4 && Math.abs(y - 7) <= 5.5 - x * 0.6 && Math.abs(y - 7) >= 1, 'grey'); // the rudder
  s.fill((x, y, z) => y === 7 && x >= 1 && x <= 4 && Math.abs(z - Z) <= 6 - x * 0.7 && Math.abs(z - Z) >= 1, 'grey'); // the hydroplanes
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + 0.3;
    rod(s, [0, 7, Z], [0, 7 + 3.4 * Math.cos(a), Z + 3.4 * Math.sin(a)], 0.6, 'orange'); // the propeller
  }
  s.paint((x, y, z, cur) => cur === 'yellow' && (y === 7 || y === 8) && x % 4 === 2 && x >= 6 && x <= 24 && Math.abs(z - Z) >= 3.5, 'white'); // portholes
  s.bands(['teal', 'orange', 'white'], (x, y, z, cur) => cur === 'yellow' || cur === 'grey');
  return s.done();
}

export const MODELS = {
  mushroom, duck, cactus, rocket, penguin, balloon, lighthouse, robot, planet, castle, dolls,
  cupcake, burger, fish, gift, tree, melon, snowman, house, patchwork,
  birdcage, lantern, jellyfish, airship, pagoda, teapot, atom, treehouse, hourglass, octopus, windmill, station, submarine,
};
