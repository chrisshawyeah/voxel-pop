// The 3D stage: the sculpture on a turntable, cubes that flash and burst, and flying chips.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';

const CHIP_POOL = 900;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const white = new THREE.Color('#ffffff');
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#f3c9a6', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 2.1);
    sun.position.set(6, 14, 10);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#bcd8ff', 0.9);
    rim.position.set(-8, 4, -6);
    this.scene.add(rim);

    this.spin = new THREE.Group();
    this.scene.add(this.spin);
    this.table = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1.04, 0.6, 64),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }),
    );
    this.spin.add(this.table);
    this.tableRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.02, 0.06, 8, 64),
      new THREE.MeshStandardMaterial({ color: '#ffd3e6', roughness: 0.5 }),
    );
    this.tableRing.rotation.x = Math.PI / 2;
    this.spin.add(this.tableRing);
    const shadowTex = makeShadowTexture();
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);

    this.cubeGeo = new RoundedBoxGeometry(0.92, 0.92, 0.92, 2, 0.13);
    this.cubeMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.02 });
    this.mesh = null;

    const chipGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
    this.chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), CHIP_POOL);
    this.chips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chips.frustumCulled = false;
    for (let i = 0; i < CHIP_POOL; i++) { this.chips.setMatrixAt(i, ZERO); this.chips.setColorAt(i, white); }
    this.scene.add(this.chips);
    this.chipState = Array.from({ length: CHIP_POOL }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() }));
    this.chipNext = 0;

    this.angle = 0.6; this.vel = 0; this.tilt = 0.32; this.auto = 0.32;
    this.flashes = new Map();
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.frame();
  }

  // Builds the instanced cubes for a board. Grid cell i becomes instance idOf[i].
  load(board, model) {
    if (this.mesh) { this.spin.remove(this.mesh); this.mesh.dispose(); }
    this.board = board; this.model = model;
    const { sx, sy, sz } = board;
    this.idOf = new Int32Array(board.cells.length).fill(-1);
    this.cellOf = [];
    this.colors = model.palette.map(h => new THREE.Color(h));
    const mesh = new THREE.InstancedMesh(this.cubeGeo, this.cubeMat, board.total);
    this.offset = new THREE.Vector3(-(sx - 1) / 2, 0.8, -(sz - 1) / 2);
    let k = 0;
    for (let i = 0; i < board.cells.length; i++) {
      if (!board.cells[i]) continue;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      tmpM.makeTranslation(x + this.offset.x, y + this.offset.y, z + this.offset.z);
      mesh.setMatrixAt(k, tmpM);
      mesh.setColorAt(k, this.colors[board.cells[i] - 1]);
      this.idOf[i] = k; this.cellOf[k] = i; k++;
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
    this.mesh = mesh;
    this.spin.add(mesh);
    // The real reach of the shape as it turns, not its grid box.
    let reach = 1, top = 1;
    for (let i = 0; i < board.cells.length; i++) {
      if (!board.cells[i]) continue;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      reach = Math.max(reach, Math.hypot(x - (sx - 1) / 2, z - (sz - 1) / 2) + 0.7);
      top = Math.max(top, y + 1);
    }
    const rad = reach + 0.5;
    this.table.scale.set(rad, 1, rad); this.table.position.y = 0;
    this.tableRing.scale.set(rad, rad, 1); this.tableRing.position.y = 0.28;
    this.shadow.scale.set(rad * 2.9, rad * 2.9, 1); this.shadow.position.y = -0.32;
    this.size = { sx, sy: top, sz, rad: reach };
    this.flashes.clear();
    this.frame();
  }

  // Fits the sculpture into the stage, whatever its shape and the screen's.
  frame() {
    if (!this.size) return;
    const { sy, rad } = this.size;
    const h = sy + 1.2;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const needV = (h * 0.5 + rad * 0.3) / Math.tan(vfov / 2);
    const needH = (rad * 1.02) / Math.tan(hfov / 2);
    const d = Math.max(needV, needH) + rad * 0.85;
    this.dist = d;
    const ty = h * 0.42;
    this.camera.position.set(0, ty + Math.sin(this.tilt) * d, Math.cos(this.tilt) * d);
    this.camera.lookAt(0, ty, 0);
    this.camera.updateProjectionMatrix();
  }

  // Cell centre in world space, now.
  world(i, out = tmpV) {
    const { sx, sy } = this.board;
    const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    out.set(x + this.offset.x, y + this.offset.y, z + this.offset.z);
    return out.applyMatrix4(this.spin.matrixWorld);
  }

  // Cell centre in page pixels.
  screen(i) {
    const v = this.world(i).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  // The cube was hit: it flashes white and swells for a moment, then bursts into chips.
  hit(i) {
    const id = this.idOf[i];
    if (id < 0) return;
    this.flashes.set(id, 0);
    this.burst(i, this.colors[this.model.cells[i] - 1], 7);
  }

  burst(i, color, n) {
    const p = this.world(i, new THREE.Vector3());
    for (let k = 0; k < n; k++) {
      const c = this.chipState[this.chipNext];
      const id = this.chipNext;
      this.chipNext = (this.chipNext + 1) % CHIP_POOL;
      c.life = 0.7 + Math.random() * 0.5;
      c.max = c.life;
      c.p.copy(p);
      const out = p.clone().setY(0).normalize();
      c.v.set(out.x * 3 + (Math.random() - 0.5) * 5, 3 + Math.random() * 5, out.z * 3 + (Math.random() - 0.5) * 5);
      c.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.chips.setColorAt(id, color);
    }
    this.chips.instanceColor.needsUpdate = true;
  }

  // Big finale: every chip slot flies.
  finale() {
    for (let k = 0; k < 120; k++) {
      const c = this.chipState[this.chipNext];
      const id = this.chipNext;
      this.chipNext = (this.chipNext + 1) % CHIP_POOL;
      c.life = c.max = 1 + Math.random() * 0.8;
      c.p.set((Math.random() - 0.5) * 4, 2 + Math.random() * 6, (Math.random() - 0.5) * 4);
      c.v.set((Math.random() - 0.5) * 16, 4 + Math.random() * 10, (Math.random() - 0.5) * 16);
      c.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      this.chips.setColorAt(id, this.colors[k % this.colors.length]);
    }
    this.chips.instanceColor.needsUpdate = true;
  }

  drag(dx) { this.angle += dx * 0.012; this.vel = dx * 0.6; }

  update(dt) {
    this.vel *= Math.pow(0.04, dt);
    this.angle += (this.auto + this.vel) * dt;
    this.spin.rotation.y = this.angle;
    this.spin.updateMatrixWorld();
    if (this.mesh && this.flashes.size) {
      for (const [id, t0] of this.flashes) {
        const t = t0 + dt;
        const i = this.cellOf[id];
        if (t >= 0.11) {
          this.mesh.setMatrixAt(id, ZERO);
          this.idOf[i] = -1;
          this.flashes.delete(id);
        } else {
          const s = 1 + t * 3.2;
          this.mesh.getMatrixAt(id, tmpM);
          tmpM.decompose(tmpV, tmpQ, tmpS);
          tmpM.compose(tmpV, tmpQ, tmpS.set(s, s, s));
          this.mesh.setMatrixAt(id, tmpM);
          tmpC.copy(this.colors[this.model.cells[i] - 1]).lerp(white, Math.min(1, t * 9));
          this.mesh.setColorAt(id, tmpC);
          this.mesh.instanceColor.needsUpdate = true;
          this.flashes.set(id, t);
        }
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    let live = false;
    for (let k = 0; k < CHIP_POOL; k++) {
      const c = this.chipState[k];
      if (c.life <= 0) continue;
      live = true;
      c.life -= dt;
      if (c.life <= 0) { this.chips.setMatrixAt(k, ZERO); continue; }
      c.v.y -= 22 * dt;
      c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      const s = Math.min(1, (c.life / c.max) * 1.6);
      tmpQ.setFromEuler(c.r);
      tmpM.compose(c.p, tmpQ, tmpS.set(s, s, s));
      this.chips.setMatrixAt(k, tmpM);
    }
    if (live || this.chipsWereLive) this.chips.instanceMatrix.needsUpdate = true;
    this.chipsWereLive = live;
    this.renderer.render(this.scene, this.camera);
  }
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
