// The 3D stage: the sculpture floating in the air and turning, seen from where the rules' view
// says (js/logic.js: its turn and the camera's height are part of the board; js/main.js passes them
// on with setView). Nothing stands under it, so from below the player sees its underside. The cubes
// stand flush against each other, so nothing behind them shows through; a groove and a bevel on
// every face keep each cube readable. A cube about to be hit glows, pops, puffs and bursts into
// chips that fall away; the sculpture gives a little under fire, drops into place at a level's
// start, and a colour cleared sends a ring out from under it.
import * as THREE from 'three';
import { camBack } from './logic.js';

const CHIP_POOL = 1400;
const PUFF_POOL = 48;
const RING_POOL = 4;
// The lens (lensAt()): while a finger is on the stage, a disc about twice the size of the phone's
// own magnifier floats above the thumb and shows what is under it LENS_ZOOM times bigger, with a
// ring round each cube the crew on the pads would hit now (js/main.js passes them; the rules aim
// them at the cube of their colour nearest the middle of the lens, js/logic.js aimDistance()).
const LENS_ZOOM = 2;
const LENS_SIZE = 0.44;   // the lens across, as a part of the stage's width ...
const LENS_MIN = 150;     // ... but never under this many pixels across
const LENS_MAX = 200;     // ... nor over this many
const LENS_LIFT = 58;     // pixels between the thumb and the lens's lower edge, so the thumb never covers it
const LENS_EDGE = 6;      // pixels the lens keeps from the stage's edges
const AIM_RINGS = 8;
// The page's sky (css/game.css, body), top to bottom of the window: the lens's background.
const SKY = [[0, '#a9d6ff'], [0.38, '#cfe6ff'], [0.78, '#ffdcef'], [1, '#ffe8cf']].map(([t, c]) => [t, new THREE.Color(c)]);
const CHIPS = 5;        // chips a cube bursts into (a pad fires up to 30 shots a second)
const POP = 0.09;       // seconds a hit cube takes to pop
const GLOW = 0.1;       // seconds a cube takes to glow white before its shot lands
const SHADOW_Y = -1.2;  // the soft shadow on the floor nobody sees, under the floating sculpture
const GRAVITY = 24;
const DROP = 1.2;       // how high the sculpture drops from at a level's start: a short hop, so it never leaves the view
const DROP_TIME = 0.26; // seconds it falls
const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const white = new THREE.Color('#ffffff');
const noTurn = new THREE.Quaternion();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const easeOutCubic = t => 1 - (1 - t) ** 3;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    // A long lens (14 degrees), standing well back: the rules see the sculpture along one straight
    // line (js/logic.js clearView), and the narrower the lens, the closer the screen is to that, so
    // the crew hit cubes the player can see (a 32-degree lens hid about 1 aimed cube in 12).
    this.camera = new THREE.PerspectiveCamera(14, 1, 0.5, 1500);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#f3c9a6', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(6, 14, 10);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#bcd8ff', 0.9);
    rim.position.set(-8, 4, -6);
    this.scene.add(rim);
    // A soft light from below, so the sculpture's underside reads clearly when the camera looks up at it.
    const under = new THREE.DirectionalLight('#ffffff', 0.9);
    under.position.set(2, -10, 3);
    this.scene.add(under);

    this.spin = new THREE.Group();
    this.scene.add(this.spin);
    // A soft shadow well under the sculpture, so it reads as floating. It faces up only, so from
    // below it is not drawn, and it never stands between the camera and a cube.
    const shadowTex = makeShadowTexture();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = SHADOW_Y;
    this.scene.add(this.shadow);

    // The sculpture's underside is at y = 0; it squashes from there when it is hit.
    this.sculpt = new THREE.Group();
    this.spin.add(this.sculpt);
    const faces = makeFaceTextures();
    this.cubeGeo = new THREE.BoxGeometry(1, 1, 1);
    this.cubeMat = new THREE.MeshStandardMaterial({ map: faces.color, normalMap: faces.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.45, metalness: 0.02 });
    this.mesh = null;

    const chipGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    this.chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ map: faces.color, roughness: 0.5 }), CHIP_POOL);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chips.frustumCulled = false;
    for (let i = 0; i < CHIP_POOL; i++) { this.chips.setMatrixAt(i, ZERO); this.chips.setColorAt(i, white); }
    this.scene.add(this.chips);
    this.chipState = Array.from({ length: CHIP_POOL }, () => ({ life: 0, max: 1, size: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
    this.chipNext = 0;

    // A soft puff where a shot lands, and a ring out from under the sculpture when a colour is cleared.
    const puffTex = makePuffTexture();
    this.puffs = Array.from({ length: PUFF_POOL }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
      s.visible = false; s.renderOrder = 2; s.life = 0;
      this.scene.add(s);
      return s;
    });
    this.puffNext = 0;
    this.rings = Array.from({ length: RING_POOL }, () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = -0.05; m.visible = false; m.life = 0;
      this.scene.add(m);
      return m;
    });
    this.ringNext = 0;

    // The lens: the scene drawn again through the part of this view under the finger, into a
    // texture laid over the stage as a disc, with a white rim and the aim rings on top.
    this.lens = null;
    this.aims = [];
    this.lensRT = new THREE.WebGLRenderTarget(2, 2, { samples: 4 });
    this.lensRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.lensCam = this.camera.clone();
    this.overlay = new THREE.Scene();
    this.overCam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    const flat = (mat, order) => { mat.depthTest = false; mat.depthWrite = false; mat.transparent = true; return order; };
    this.lensShade = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: '#1f2547', opacity: 0.22 }));
    this.lensShade.renderOrder = flat(this.lensShade.material, 1);
    this.lensRim = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.lensRim.renderOrder = flat(this.lensRim.material, 2);
    this.lensDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ map: this.lensRT.texture }));
    this.lensDisc.renderOrder = flat(this.lensDisc.material, 3);
    this.overlay.add(this.lensShade, this.lensRim, this.lensDisc);
    const ringTex = makeAimRingTexture();
    this.aimRings = Array.from({ length: AIM_RINGS }, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: ringTex }));
      m.renderOrder = flat(m.material, 4);
      m.visible = false;
      this.overlay.add(m);
      return m;
    });

    this.yaw = 0.6; this.pitch = 0.39;
    this.wob = 0; this.wobV = 0;
    this.flashes = new Map(); // instance -> seconds glowing
    this.pops = [];           // instances popping: { id, t }
    this.drop = null;         // the sculpture dropping into place at a level's start: seconds so far
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.cssW = w; this.cssH = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  // Builds the instanced cubes for the cubes still on a board (all of them at a level's start,
  // fewer after an undo or a restore). Grid cell i becomes instance idOf[i]. The framing comes
  // from the whole sculpture, so the camera does not move when cubes come back. `build` drops the
  // sculpture into place in one piece, so nothing inside shows on the way (a level's start, not an
  // undo or a restore).
  load(board, model, build = false) {
    if (this.mesh) { this.sculpt.remove(this.mesh); this.mesh.dispose(); }
    this.board = board; this.model = model;
    const { sx, sy, sz } = board;
    this.idOf = new Int32Array(board.cells.length).fill(-1);
    this.cellOf = [];
    this.colors = model.palette.map(h => new THREE.Color(h));
    let present = 0;
    for (let i = 0; i < board.cells.length; i++) if (board.cells[i]) present++;
    const mesh = new THREE.InstancedMesh(this.cubeGeo, this.cubeMat, Math.max(1, present));
    mesh.count = present;
    this.offset = new THREE.Vector3(-(sx - 1) / 2, 0.5, -(sz - 1) / 2);
    // A cube with a cube on all six sides is not drawn until one of them goes: drawn, it showed
    // through the seams of the flush cubes in front of it (the fish's red flesh as thin red lines).
    const has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && board.cells[x + y * sx + z * sx * sy];
    this.buried = new Uint8Array(present);
    let k = 0;
    for (let i = 0; i < board.cells.length; i++) {
      if (!board.cells[i]) continue;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      this.buried[k] = has(x + 1, y, z) && has(x - 1, y, z) && has(x, y + 1, z) && has(x, y - 1, z) && has(x, y, z + 1) && has(x, y, z - 1) ? 1 : 0;
      if (this.buried[k]) mesh.setMatrixAt(k, ZERO);
      else mesh.setMatrixAt(k, tmpM.makeTranslation(x + this.offset.x, y + this.offset.y, z + this.offset.z));
      mesh.setColorAt(k, this.colors[board.cells[i] - 1]);
      this.idOf[i] = k; this.cellOf[k] = i; k++;
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
    this.mesh = mesh;
    this.sculpt.add(mesh);
    // The real reach of the shape as it turns, not its grid box.
    let reach = 1, top = 1;
    for (let i = 0; i < model.cells.length; i++) {
      if (!model.cells[i]) continue;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      reach = Math.max(reach, Math.hypot(x - (sx - 1) / 2, z - (sz - 1) / 2) + 0.75);
      top = Math.max(top, y + 1);
    }
    const rad = reach + 0.5;
    this.shadow.scale.set(rad * 2, rad * 2, 1); // fades out at its edges, so it is never cut off
    this.size = { top, reach, rad };
    this.flashes.clear();
    this.pops.length = 0;
    this.wob = this.wobV = 0;
    this.drop = build && !calm() ? 0 : null;
    this.sculpt.position.y = this.drop === null ? 0 : DROP;
    this.clearChips(); // chips of cubes an undo put back would fly over them
    this.frame();
  }

  // How many cubes are drawn standing (for the play-through checks, window.crumble.drawn).
  get shown() {
    let n = 0;
    if (this.idOf) for (const id of this.idOf) if (id >= 0) n++;
    return n;
  }

  clearChips() {
    for (let k = 0; k < CHIP_POOL; k++) {
      if (this.chipState[k].life <= 0) continue;
      this.chipState[k].life = 0;
      this.chips.setMatrixAt(k, ZERO);
    }
    this.chips.instanceMatrix.needsUpdate = true;
    for (const p of this.puffs) { p.life = 0; p.visible = false; }
    for (const r of this.rings) { r.life = 0; r.visible = false; }
  }

  // The view to draw: the sculpture turned by `yaw` and the camera `pitch` above level, both in
  // radians (js/logic.js yawRad and pitchRad of the board's view, or the player's own while they
  // turn it).
  setView(yaw, pitch) { this.yaw = yaw; this.pitch = pitch; }

  // Fits the floating sculpture into the stage from the camera's height now, whatever the shape
  // and the screen, looking at the middle of its height (js/logic.js camBack, the same framing the
  // rules see from), with more room left at the bottom, where the hint sits over the stage.
  frame() {
    if (!this.size) return;
    const { top, reach } = this.size;
    const p = this.pitch;
    const sp = Math.sin(p), cp = Math.cos(p);
    const ty = top / 2;
    const d = camBack(this.camera.fov, this.camera.aspect, top, reach, p);
    this.dist = d;
    this.camera.position.set(0, ty + sp * d, cp * d);
    this.camera.lookAt(0, ty, 0);
    this.camera.updateProjectionMatrix();
  }

  // Cell centre in world space, now.
  world(i, out = tmpV) {
    const { sx, sy } = this.board;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    out.set(x + this.offset.x, y + this.offset.y, z + this.offset.z);
    return out.applyMatrix4(this.sculpt.matrixWorld);
  }

  // Cell centre in page pixels.
  screen(i) {
    const v = this.world(i).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  // Instance n at its place, at `scale`, raised by `lift`.
  place(n, scale, lift) {
    const i = this.cellOf[n];
    const { sx, sy } = this.board;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    tmpV.set(x + this.offset.x, y + this.offset.y + lift, z + this.offset.z);
    tmpM.compose(tmpV, noTurn, tmpS.set(scale, scale, scale));
    this.mesh.setMatrixAt(n, tmpM);
  }

  // A shot is about to land on cube i: it glows white and swells a little (js/main.js starts this
  // in the shot's last third).
  flash(i) {
    const id = this.idOf[i];
    if (id >= 0 && !this.flashes.has(id)) this.flashes.set(id, 0);
  }

  // The rules landed a shot on cube i: it pops now, with a puff, and bursts into chips.
  hit(i) {
    const id = this.idOf[i];
    if (id < 0) return;
    this.idOf[i] = -1;
    this.flashes.delete(id);
    this.uncover(i);
    this.pops.push({ id, t: 0 });
    const color = this.colors[this.model.cells[i] - 1];
    const p = this.world(i, new THREE.Vector3());
    this.burst(p, color, calm() ? 4 : CHIPS);
    this.puff(p, color);
    if (!calm() && this.wob > -0.03) this.wobV = Math.max(-1.2, this.wobV - 0.35); // a hit gives a little, never much
  }

  // Cube i is gone: the buried cubes next to it are in the open now, so they are drawn.
  uncover(i) {
    const { sx, sy, sz } = this.board;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const n = this.idOf[nx + ny * sx + nz * sx * sy];
      if (n < 0 || !this.buried[n]) continue;
      this.buried[n] = 0;
      this.place(n, 1, 0);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // `n` chips of `color` from world point p: thrown outward from the sculpture's middle and a
  // little toward the camera, in shades of the colour.
  burst(p, color, n) {
    const out = tmpV.set(p.x, 0, p.z);
    if (out.lengthSq() < 1e-6) out.set(0, 0, 1);
    out.normalize();
    const cx = 0, cy = Math.sin(this.pitch), cz = Math.cos(this.pitch);
    for (let k = 0; k < n; k++) {
      const c = this.chipState[this.chipNext];
      const id = this.chipNext;
      this.chipNext = (this.chipNext + 1) % CHIP_POOL;
      c.life = c.max = 0.65 + Math.random() * 0.45;
      c.size = 0.4 + Math.random() * 0.6;
      c.p.copy(p);
      c.v.set(
        out.x * 2.8 + cx * 0.8 + (Math.random() - 0.5) * 4,
        3 + cy * 1.2 + Math.random() * 4,
        out.z * 2.8 + cz * 0.8 + (Math.random() - 0.5) * 4,
      );
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18);
      this.chips.setColorAt(id, tmpC.copy(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.18));
    }
    this.chips.instanceColor.needsUpdate = true;
  }

  puff(p, color) {
    const s = this.puffs[this.puffNext];
    this.puffNext = (this.puffNext + 1) % PUFF_POOL;
    s.position.copy(p);
    s.material.color.copy(color).lerp(white, 0.65);
    s.life = 0.28; s.visible = true;
  }

  // A colour's last cube went: a ring of that colour out from under the sculpture, and a fountain of
  // its chips round its base.
  cleared(colorIndex) {
    const color = this.colors?.[colorIndex];
    if (!color || !this.size) return;
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % RING_POOL;
    r.material.color.copy(color);
    r.life = 0.75; r.visible = true;
    if (calm()) return;
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      tmpS.set(Math.cos(a) * this.size.rad * 0.9, 0.2, Math.sin(a) * this.size.rad * 0.9);
      this.burst(tmpS.clone(), color, 1);
    }
  }

  // Big finale: chips of every colour burst out of where the sculpture was.
  finale() {
    const rad = this.size ? this.size.rad : 3, top = this.size ? this.size.top : 5;
    for (let k = 0; k < (calm() ? 40 : 140); k++) {
      const c = this.chipState[this.chipNext];
      const id = this.chipNext;
      this.chipNext = (this.chipNext + 1) % CHIP_POOL;
      c.life = c.max = 1.2 + Math.random() * 0.9;
      c.size = 0.6 + Math.random() * 0.8;
      c.p.set((Math.random() - 0.5) * rad, Math.random() * top, (Math.random() - 0.5) * rad);
      c.v.set((Math.random() - 0.5) * 12, 5 + Math.random() * 10, (Math.random() - 0.5) * 12);
      c.w.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      this.chips.setColorAt(id, this.colors[k % this.colors.length]);
    }
    this.chips.instanceColor.needsUpdate = true;
  }

  update(dt) {
    this.spin.rotation.y = this.yaw;
    // The sculpture gives under fire and springs back (squashing from its base).
    if (this.wob || this.wobV) {
      this.wobV += (-260 * this.wob - 16 * this.wobV) * dt;
      this.wob = Math.max(-0.09, Math.min(0.09, this.wob + this.wobV * dt));
      if (Math.abs(this.wob) < 1e-4 && Math.abs(this.wobV) < 1e-3) this.wob = this.wobV = 0;
      this.sculpt.scale.set(1 - this.wob * 0.5, 1 + this.wob, 1 - this.wob * 0.5);
    }
    this.frame();
    this.spin.updateMatrixWorld(true);
    let moved = false, recolour = false;
    if (this.drop !== null) {
      // Falling as things fall, then a squash and a puff of dust where it lands.
      this.drop += dt;
      const t = Math.min(1, this.drop / DROP_TIME);
      this.sculpt.position.y = DROP * (1 - t * t);
      if (t >= 1) {
        this.drop = null;
        this.wobV = -2.2;
        if (this.size) {
          const r = this.rings[this.ringNext];
          this.ringNext = (this.ringNext + 1) % RING_POOL;
          r.material.color.set('#ffffff');
          r.life = 0.75; r.visible = true;
        }
      }
    }
    if (this.mesh && this.flashes.size) {
      // A glow grows for GLOW seconds and then holds until hit() takes the cube away.
      for (const [id, t0] of this.flashes) {
        if (t0 >= GLOW) continue;
        const t = Math.min(GLOW, t0 + dt);
        this.place(id, 1 + (t / GLOW) * 0.06, 0);
        tmpC.copy(this.colors[this.model.cells[this.cellOf[id]] - 1]).lerp(white, Math.min(1, (t / GLOW) * 0.85));
        this.mesh.setColorAt(id, tmpC);
        this.flashes.set(id, t);
        moved = recolour = true;
      }
    }
    if (this.mesh && this.pops.length) {
      for (let k = this.pops.length - 1; k >= 0; k--) {
        const p = this.pops[k];
        p.t += dt;
        if (p.t >= POP) { this.mesh.setMatrixAt(p.id, ZERO); this.pops.splice(k, 1); continue; }
        const e = p.t / POP;
        this.place(p.id, 1.06 + 0.16 * e - 1.2 * e * e, 0);
        this.mesh.setColorAt(p.id, white);
        recolour = true;
      }
      moved = true;
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
    if (recolour) this.mesh.instanceColor.needsUpdate = true;
    let live = false;
    const rad = this.size ? this.size.rad : 0;
    // Chips fall away: nothing under the sculpture catches them.
    for (let k = 0; k < CHIP_POOL; k++) {
      const c = this.chipState[k];
      if (c.life <= 0) continue;
      live = true;
      c.life -= dt;
      if (c.life <= 0) { this.chips.setMatrixAt(k, ZERO); continue; }
      c.v.y -= GRAVITY * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      const s = c.size * Math.min(1, (c.life / c.max) * 3);
      tmpQ.setFromEuler(c.r);
      tmpM.compose(c.p, tmpQ, tmpS.set(s, s, s));
      this.chips.setMatrixAt(k, tmpM);
    }
    if (live || this.chipsWereLive) this.chips.instanceMatrix.needsUpdate = true;
    this.chipsWereLive = live;
    for (const s of this.puffs) {
      if (!s.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.visible = false; continue; }
      const e = 1 - s.life / 0.28;
      s.scale.setScalar(0.6 + easeOutCubic(e) * 1.8);
      s.material.opacity = 0.85 * (1 - e) * (1 - e);
    }
    for (const r of this.rings) {
      if (!r.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.visible = false; continue; }
      const e = 1 - r.life / 0.75;
      const s = rad * (0.35 + easeOutCubic(e) * 0.65); // out to the sculpture's reach, never past the stage's edges
      r.scale.set(s, s, 1);
      r.material.opacity = 0.9 * (1 - e);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.lens) this.drawLens();
  }

  // ---------- the lens and the aim ----------
  // Where a finger at page point (px, py) aims, as the rules keep it (js/logic.js setAim): the point
  // under it on the plane through the middle of the sculpture square to the camera's line of sight,
  // in cells to the right of and above that middle. null when the point is not on the stage.
  aimOf(px, py) {
    const r = this.canvas.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || !this.size) return null;
    const nx = ((px - r.left) / r.width) * 2 - 1, ny = -(((py - r.top) / r.height) * 2 - 1);
    const cam = this.camera;
    cam.updateMatrixWorld();
    const o = cam.position, dir = tmpV.set(nx, ny, 0.5).unproject(cam).sub(o).normalize();
    const ahead = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    cam.matrixWorld.extractBasis(right, up, ahead);
    ahead.negate();
    const mid = new THREE.Vector3(0, this.size.top / 2, 0);
    const along = dir.dot(ahead);
    if (!(along > 1e-6)) return null;
    const t = mid.clone().sub(o).dot(ahead) / along;
    const q = o.clone().addScaledVector(dir, t).sub(mid);
    return [q.dot(right), q.dot(up)];
  }

  // Shows the lens for a finger at page point (px, py): above the thumb, or beside it near the top
  // of the stage, never past the stage's edges.
  lensAt(px, py) {
    const r = this.canvas.getBoundingClientRect();
    const W = r.width, H = r.height;
    const x = px - r.left, y = py - r.top;
    const rad = Math.min(Math.max(LENS_SIZE * W, LENS_MIN), LENS_MAX, W - 2 * LENS_EDGE, H - 2 * LENS_EDGE) / 2;
    if (!(rad > 10)) { this.lens = null; return; }
    let cx = x, cy = y - LENS_LIFT - rad;
    if (cy - rad < LENS_EDGE) { // no room above: beside the thumb, on the side with more room
      cy = Math.max(rad + LENS_EDGE, Math.min(H - rad - LENS_EDGE, y));
      cx = x + (x < W / 2 ? 1 : -1) * (LENS_LIFT + rad);
    }
    cx = Math.max(rad + LENS_EDGE, Math.min(W - rad - LENS_EDGE, cx));
    this.lens = { x, y, cx, cy, rad, sky: py / Math.max(1, window.innerHeight) };
  }

  hideLens() { this.lens = null; }

  // The cubes the crew on the pads would hit now (grid cells), ringed in the lens.
  setAims(cells) { this.aims = cells; }

  drawLens() {
    const { x, y, cx, cy, rad, sky } = this.lens;
    const W = this.cssW, H = this.cssH, rr = this.renderer;
    const dpr = rr.getPixelRatio();
    const size = Math.max(2, Math.round(2 * rad * dpr));
    if (this.lensRT.width !== size) this.lensRT.setSize(size, size);
    // The part of this very view the lens shows: a square LENS_ZOOM times smaller than the lens,
    // round the finger, through the same camera, so what shows in it is what is under the finger.
    const span = (2 * rad) / LENS_ZOOM;
    const cam = this.lensCam;
    cam.copy(this.camera);
    cam.setViewOffset(W, H, x - span / 2, y - span / 2, span, span);
    const clear = rr.getClearColor(new THREE.Color()), alpha = rr.getClearAlpha();
    rr.setRenderTarget(this.lensRT);
    rr.setClearColor(skyAt(sky), 1);
    rr.clear();
    rr.render(this.scene, cam);
    rr.setRenderTarget(null);
    rr.setClearColor(clear, alpha);
    // The disc and its rings, laid over the stage in its own pixels (y up).
    const oc = this.overCam;
    oc.left = 0; oc.right = W; oc.top = H; oc.bottom = 0;
    oc.updateProjectionMatrix();
    const at = (m, s) => { m.position.set(cx, H - cy, 0); m.scale.set(s, s, 1); };
    at(this.lensShade, rad + 7); this.lensShade.position.y -= 2;
    at(this.lensRim, rad + 4);
    at(this.lensDisc, rad);
    // A ring round each cube the crew would hit, where the lens shows it; none for one outside it.
    const fovTan = Math.tan((this.camera.fov * Math.PI) / 360);
    let k = 0;
    for (const i of this.aims) {
      if (k >= AIM_RINGS || this.idOf?.[i] === undefined || this.idOf[i] < 0) continue;
      const p = this.world(i);
      const dist = p.distanceTo(this.camera.position);
      const v = p.project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
      const lx = cx + (sx - x) * LENS_ZOOM, ly = cy + (sy - y) * LENS_ZOOM;
      const cube = (H / (2 * fovTan * dist)) * LENS_ZOOM; // a cube's size in the lens, in pixels
      const ring = Math.max(10, cube * 0.78);
      if (Math.hypot(lx - cx, ly - cy) > rad - ring * 0.4) continue;
      const m = this.aimRings[k++];
      m.visible = true;
      m.position.set(lx, H - ly, 0);
      m.scale.set(ring, ring, 1);
    }
    for (; k < AIM_RINGS; k++) this.aimRings[k].visible = false;
    const auto = rr.autoClear;
    rr.autoClear = false;
    rr.render(this.overlay, oc);
    rr.autoClear = auto;
  }
}

// The page's sky at `t`, 0 at the top of the window to 1 at its foot.
const skyColor = new THREE.Color();
function skyAt(t) {
  t = Math.max(0, Math.min(1, t));
  for (let k = 1; k < SKY.length; k++) {
    if (t > SKY[k][0]) continue;
    const [t0, c0] = SKY[k - 1], [t1, c1] = SKY[k];
    return skyColor.copy(c0).lerp(c1, (t - t0) / (t1 - t0 || 1));
  }
  return skyColor.copy(SKY[SKY.length - 1][1]);
}

// The ring round a cube the crew would hit: white under a dark dashed line, as on the mockup.
function makeAimRingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.lineWidth = 12; g.strokeStyle = '#ffffff';
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 6; g.strokeStyle = '#1f2547'; g.setLineDash([14, 10]);
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The face of every cube: white with a darker groove at its edges (the instance colour tints it),
// and a normal map that rounds those edges so they catch the light.
function makeFaceTextures() {
  const N = 128, B = 0.075; // the bevel, as a part of the face
  const color = document.createElement('canvas');
  const normal = document.createElement('canvas');
  color.width = color.height = normal.width = normal.height = N;
  const gc = color.getContext('2d'), gn = normal.getContext('2d');
  const ci = gc.createImageData(N, N), ni = gn.createImageData(N, N);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const u = (px + 0.5) / N, v = (py + 0.5) / N;
      const e = Math.min(u, 1 - u, v, 1 - v);
      // The groove: darkest right at the edge, the face itself a touch lighter in the middle.
      const shade = e < B ? 0.7 + 0.3 * Math.pow(e / B, 0.6) : 1 - 0.04 * Math.max(0, 0.5 - e) / 0.5;
      const o = (py * N + px) * 4;
      ci.data[o] = ci.data[o + 1] = ci.data[o + 2] = Math.round(255 * shade);
      ci.data[o + 3] = 255;
      // The bevel's slope, in the face's own frame (x right, y up; the canvas's rows run down).
      let nx = 0, ny = 0;
      const k = t => (t < B ? (1 - t / B) ** 1.5 * 0.85 : 0);
      nx = k(1 - u) - k(u);
      ny = k(v) - k(1 - v);
      const len = Math.hypot(nx, ny, 1);
      ni.data[o] = Math.round((nx / len * 0.5 + 0.5) * 255);
      ni.data[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      ni.data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      ni.data[o + 3] = 255;
    }
  }
  gc.putImageData(ci, 0, 0); gn.putImageData(ni, 0, 0);
  const tc = new THREE.CanvasTexture(color);
  tc.colorSpace = THREE.SRGBColorSpace;
  tc.anisotropy = 4;
  const tn = new THREE.CanvasTexture(normal);
  tn.anisotropy = 4;
  return { color: tc, normal: tn };
}

function makePuffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(60,40,90,0.30)');
  grd.addColorStop(0.55, 'rgba(60,40,90,0.12)');
  grd.addColorStop(1, 'rgba(60,40,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
