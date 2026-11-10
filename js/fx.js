// The flat effects layer over everything: shots that home in on their cube, and confetti.

export class Fx {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.shots = [];
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

  // A shot from (x, y) to wherever target() says the cube is now; onHit runs when it lands.
  shoot(x, y, color, target, onHit) {
    this.shots.push({ x0: x, y0: y, color, target, onHit, t: 0, dur: 0.2 + Math.random() * 0.08, bend: (Math.random() - 0.5) * 90, trail: [] });
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
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k];
      s.t += dt / s.dur;
      const end = s.target();
      const t = Math.min(1, s.t);
      const mx = (s.x0 + end.x) / 2 + s.bend, my = Math.min(s.y0, end.y) - 40;
      const x = (1 - t) * (1 - t) * s.x0 + 2 * (1 - t) * t * mx + t * t * end.x;
      const y = (1 - t) * (1 - t) * s.y0 + 2 * (1 - t) * t * my + t * t * end.y;
      s.trail.push(x, y);
      if (s.trail.length > 14) s.trail.splice(0, 2);
      for (let q = 0; q < s.trail.length; q += 2) {
        const a = q / s.trail.length;
        g.globalAlpha = a * 0.6;
        g.fillStyle = s.color;
        g.beginPath(); g.arc(s.trail[q], s.trail[q + 1], 2 + a * 4, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = s.color;
      g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
      if (s.t >= 1) { this.shots.splice(k, 1); s.onHit(); }
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
