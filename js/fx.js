// The flat effects layer over everything: shots that home in on their cube, the flash as each
// leaves its pad, the puff when a crew member leaves, and confetti.

const NEAR = 2 / 3; // the cube starts to glow for the last third of a shot's flight (0.1 s)
const TRAIL = 9;    // points kept of each shot's path, for its tail

export class Fx {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.shots = [];
    this.rings = [];   // muzzle flashes and puffs: expanding rings that fade
    this.flashAt = new Map(); // when each pad (by its x) last flashed
    this.confetti = [];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  // A shot from (x, y) to wherever target() says its cube is now. It keeps the rules' clock:
  // progress() says how far along it is, 0 to 1, and it is gone at 1, the tick the rules land it
  // (js/main.js pops the cube then). near() runs once, when it is NEAR of the way there.
  shoot(x, y, color, target, progress, near) {
    this.shots.push({ x0: x, y0: y, color, target, progress, near, bend: (Math.random() - 0.5) * 90, trail: [] });
    // A flash at the pad, at most one every 90 ms there (a pad can fire every tick).
    const key = Math.round(x), now = performance.now();
    if (!(this.flashAt.get(key) > now - 90)) { this.flashAt.set(key, now); this.ring(x, y, color, 4, 18, 0.16, 3); }
  }

  // A ring at (x, y) growing from r0 to r1 pixels over `life` seconds as it fades.
  ring(x, y, color, r0, r1, life, width) {
    if (this.rings.length > 80) this.rings.shift();
    this.rings.push({ x, y, color, r0, r1, life, max: life, width, dots: 0 });
  }

  // A crew member leaves: a puff of its colour, with a few sparks thrown out.
  poof(x, y, color) {
    this.ring(x, y, color, 10, 40, 0.32, 5);
    this.rings[this.rings.length - 1].dots = 7;
  }

  get busy() { return this.shots.length > 0; }

  party() {
    const colors = ['#ff4b5c', '#ffd23f', '#36c46f', '#3f7cff', '#ff6fb3', '#9a5cf5', '#ff9a2e', '#1fc6bd'];
    for (let k = 0; k < 140; k++) {
      this.confetti.push({
        x: this.w / 2 + (Math.random() - 0.5) * 60, y: this.h * 0.38,
        vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 700,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
        w: 8 + Math.random() * 8, h: 4 + Math.random() * 5, color: colors[k % colors.length], life: 2.2 + Math.random(),
      });
    }
  }

  update(dt) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.life -= dt;
      if (r.life <= 0) { this.rings.splice(k, 1); continue; }
      const e = Math.min(1, Math.max(0, 1 - r.life / r.max)), ease = 1 - (1 - e) ** 3;
      const rad = r.r0 + (r.r1 - r.r0) * ease;
      g.globalAlpha = (1 - e) * 0.9;
      g.strokeStyle = r.color;
      g.lineWidth = r.width * (1 - e * 0.6);
      g.beginPath(); g.arc(r.x, r.y, rad, 0, Math.PI * 2); g.stroke();
      if (r.dots) {
        g.fillStyle = r.color;
        for (let q = 0; q < r.dots; q++) {
          const a = (q / r.dots) * Math.PI * 2 + 0.4;
          g.beginPath(); g.arc(r.x + Math.cos(a) * rad * 1.25, r.y + Math.sin(a) * rad * 1.25, 3.5 * (1 - e), 0, Math.PI * 2); g.fill();
        }
      }
    }
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k];
      const p = s.progress();
      if (p >= 1) { this.shots.splice(k, 1); continue; }
      if (p >= NEAR && s.near) { s.near(); s.near = null; }
      const end = s.target();
      const t = Math.max(0, p);
      const mx = (s.x0 + end.x) / 2 + s.bend, my = Math.min(s.y0, end.y) - 40;
      const x = (1 - t) * (1 - t) * s.x0 + 2 * (1 - t) * t * mx + t * t * end.x;
      const y = (1 - t) * (1 - t) * s.y0 + 2 * (1 - t) * t * my + t * t * end.y;
      s.trail.push(x, y);
      if (s.trail.length > TRAIL * 2) s.trail.splice(0, 2);
      // The tail: thin and faint at its end, as wide as the shot at its head.
      g.strokeStyle = s.color;
      const n = s.trail.length / 2;
      for (let q = 1; q < n; q++) {
        const a = q / n;
        g.globalAlpha = a * 0.7;
        g.lineWidth = 1 + a * 7;
        g.beginPath();
        g.moveTo(s.trail[q * 2 - 2], s.trail[q * 2 - 1]);
        g.lineTo(s.trail[q * 2], s.trail[q * 2 + 1]);
        g.stroke();
      }
      // A glow, then a white core with the colour inside.
      g.globalAlpha = 0.28;
      g.fillStyle = s.color;
      g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = s.color;
      g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
    }
    for (let k = this.confetti.length - 1; k >= 0; k--) {
      const c = this.confetti[k];
      c.life -= dt;
      if (c.life <= 0 || c.y > this.h + 40) { this.confetti.splice(k, 1); continue; }
      c.vy += 900 * dt; c.vx *= Math.pow(0.5, dt); c.vy *= Math.pow(0.7, dt);
      c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt;
      g.save();
      g.translate(c.x, c.y); g.rotate(c.r);
      g.scale(1, Math.cos(c.r * 1.7));
      g.fillStyle = c.color;
      g.globalAlpha = Math.min(1, c.life);
      g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      g.restore();
    }
    g.globalAlpha = 1;
  }
}
