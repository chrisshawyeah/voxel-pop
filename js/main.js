// Crumble Crew: wires the rules, the 3D stage, the effects and the screen together.
import { Stage } from './render.js';
import { Fx } from './fx.js';
import { Sound, Buzz } from './audio.js';
import { LEVELS, buildLevel, modelFor } from './levels.js';
import * as R from './logic.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'crumble-crew.v1';
const PRICE = 120;
const FIRE_GAP = 1 / 15;
const ICONS = {
  bomb: '<svg viewBox="0 0 48 48"><circle cx="21" cy="28" r="14" fill="#2b2f45"/><circle cx="16" cy="23" r="4" fill="#5a6185"/><rect x="26" y="9" width="8" height="8" rx="2" transform="rotate(40 30 13)" fill="#8b90ad"/><path d="M33 10c2-4 6-5 8-3" stroke="#ff9a2e" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="42" cy="6" r="3.5" fill="#ffd23f"/></svg>',
  pad: '<svg viewBox="0 0 48 48"><rect x="6" y="14" width="36" height="26" rx="9" fill="#cfe6ff" stroke="#4b7dff" stroke-width="3" stroke-dasharray="5 4"/><path d="M24 19v16M16 27h16" stroke="#2fbf71" stroke-width="5" stroke-linecap="round"/></svg>',
  recall: '<svg viewBox="0 0 48 48"><path d="M14 18h16a10 10 0 0 1 0 20H18" stroke="#4b7dff" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M20 9 10 18l10 9" stroke="#4b7dff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  peek: '<svg viewBox="0 0 48 48"><path d="M4 24s8-13 20-13 20 13 20 13-8 13-20 13S4 24 4 24Z" fill="#fff" stroke="#2b2f45" stroke-width="3"/><circle cx="24" cy="24" r="8" fill="#9a5cf5"/><circle cx="24" cy="24" r="3.5" fill="#1b1d2b"/><circle cx="21" cy="21" r="2" fill="#fff"/></svg>',
  sweep: '<svg viewBox="0 0 48 48"><path d="M30 6 22 24" stroke="#a2683f" stroke-width="5" stroke-linecap="round"/><path d="M14 22h16l4 18H8Z" fill="#ffd23f" stroke="#e0a800" stroke-width="2"/><path d="M14 30l-2 9M20 30l-1 9M26 30l1 9" stroke="#e0a800" stroke-width="2"/></svg>',
};
const POWERS = [
  { id: 'bomb', name: 'Bomb', how: 'Tap the sculpture to drop the bomb', target: 'cube' },
  { id: 'pad', name: 'Extra pad', target: null },
  { id: 'recall', name: 'Recall', how: 'Tap a pad to send its crew member back to its line', target: 'pad' },
  { id: 'peek', name: 'Peek', target: null },
  { id: 'sweep', name: 'Sweep', how: 'Tap a colour on the sculpture', target: 'cube' },
];

// ---------- saved progress ----------
const save = Object.assign(
  { level: 0, unlocked: 0, coins: 150, stock: { bomb: 2, pad: 2, recall: 2, peek: 2, sweep: 2 }, sound: true, vibe: true, taught: false },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })(),
);
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ } };

// ---------- the pieces ----------
const stage = new Stage($('gl'));
const fx = new Fx($('fx'));
const sound = new Sound();
const buzz = new Buzz($('haptic'));
sound.on = save.sound; buzz.on = save.vibe;
const thumbs = [];
const thumb = n => (thumbs[n] ||= Stage.thumbnail(modelFor(LEVELS[n])));

let L, st, gen = 0, state = 'play', mode = null, jamClock = 0, winClock = 0, bannerTimer = 0;
let usedPower = false, deploys = 0;
const inflight = new Map();
let padEls = [];

// ---------- level start ----------
function start(n) {
  gen++;
  n = Math.max(0, Math.min(LEVELS.length - 1, n));
  save.level = n; persist();
  L = buildLevel(n);
  st = L.board;
  stage.load(st, L.model);
  fx.shots.length = 0;
  inflight.clear();
  state = 'play'; mode = null; jamClock = 0; winClock = 0; usedPower = false; deploys = 0;
  for (const id of ['win', 'jam', 'settings']) $(id).hidden = true;
  $('level-name').textContent = `Level ${n + 1}`;
  renderStrip(); renderPads(); renderQueues(); renderTray(); renderCoins();
  if (n === 0 && !save.taught) say('Tap a crew member to send it up', 0);
  else say(LEVELS[n].name, 1600);
}

// ---------- crew ----------
function crewEl(s) {
  const el = document.createElement('div');
  el.className = 'crew' + (s.hidden ? ' egg' : '');
  if (!s.hidden) el.style.setProperty('--c', st.palette[s.color]);
  el.innerHTML = `<div class="body"><span class="eyes"><i></i><i></i></span><b class="n">${s.hidden ? '?' : s.count}</b></div>`;
  return el;
}

function renderQueues(fromPad) {
  const box = $('queues');
  box.innerHTML = '';
  st.columns.forEach((col, ci) => {
    const c = document.createElement('div');
    c.className = 'col' + (col.length ? '' : ' empty');
    if (col.length) {
      const b = document.createElement('button');
      b.className = 'front';
      b.setAttribute('aria-label', col[0].hidden ? 'Hidden crew member' : `Send ${col[0].count}`);
      b.addEventListener('pointerdown', e => { e.preventDefault(); onSend(ci); });
      c.appendChild(b);
    }
    col.slice(0, 3).forEach(s => {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.appendChild(crewEl(s));
      c.appendChild(slot);
    });
    box.appendChild(c);
  });
  if (fromPad && fromPad.col !== undefined) {
    const el = box.children[fromPad.col]?.querySelector('.slot');
    if (el) flyFrom(el, fromPad.rect);
  }
}

function renderPads() {
  const box = $('pads');
  box.innerHTML = '';
  padEls = st.slots.map((s, i) => {
    const pad = document.createElement('div');
    pad.className = 'pad' + (i >= R.START_SLOTS ? ' extra' : '');
    pad.addEventListener('pointerdown', () => onPad(i));
    box.appendChild(pad);
    return pad;
  });
  st.slots.forEach((_, i) => renderPad(i));
}

function renderPad(i, fromRect) {
  const pad = padEls[i];
  pad.innerHTML = '';
  const s = st.slots[i];
  if (!s) return;
  const el = crewEl(s);
  pad.appendChild(el);
  if (fromRect) flyFrom(el, fromRect);
}

function flyFrom(el, from) {
  const to = el.getBoundingClientRect();
  el.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
    { transform: 'translate(0, -14px) scale(1.08)', offset: 0.7 },
    { transform: 'translate(0, 0)' },
  ], { duration: 300, easing: 'cubic-bezier(.2,.8,.3,1)' });
}

function setCount(i, n) {
  const el = padEls[i]?.querySelector('.n');
  if (el) el.textContent = n;
}

function recoil(i) {
  const el = padEls[i]?.firstChild;
  if (!el || el._t > performance.now() - 70) return;
  el._t = performance.now();
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1, 0.88) translateY(3px)' }, { transform: 'scale(1)' }], { duration: 90 });
}

// ---------- player actions ----------
function onSend(ci) {
  sound.unlock();
  if (state !== 'play') return;
  if (mode) setMode(null);
  if (!st.columns[ci].length) return;
  if (R.freeSlot(st) < 0) {
    sound.nope(); buzz.tick();
    $('pads').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 });
    say('Every pad is full. Wait for one to free up.', 1800);
    return;
  }
  const from = $('queues').children[ci].querySelector('.slot').getBoundingClientRect();
  const res = R.deploy(st, ci);
  sound.send(); buzz.tick();
  deploys++;
  renderQueues();
  renderPad(res.slot, from);
  if (res.revealed) {
    sound.reveal();
    const el = $('queues').children[ci].querySelector('.crew');
    el?.animate([{ transform: 'rotateY(90deg) scale(0.8)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }
  if (L.def === LEVELS[0] && !save.taught) {
    if (deploys === 1) say('It pops every cube of its colour it can reach', 3200);
    if (deploys >= 3) { save.taught = true; persist(); }
  }
}

function onPad(i) {
  if (mode !== 'recall') return;
  const res = R.recall(st, i);
  if (!res) { sound.nope(); return; }
  const rect = padEls[i].getBoundingClientRect();
  spend('recall');
  setMode(null);
  renderPad(i);
  renderQueues({ col: res.col, rect });
  sound.send();
}

function onPower(p) {
  sound.unlock();
  if (state !== 'play' && !(state === 'jam' && (p.id === 'pad' || p.id === 'recall'))) return;
  if (mode === p.id) { setMode(null); return; }
  if (!save.stock[p.id]) {
    if (save.coins < PRICE) { sound.nope(); say(`You need ${PRICE} coins for another ${p.name.toLowerCase()}`, 2000); return; }
    save.coins -= PRICE; save.stock[p.id]++; persist(); renderCoins(); renderTray();
  }
  if (p.id === 'pad') {
    if (!R.addSlot(st)) { sound.nope(); say('Six pads is the most', 1600); return; }
    spend('pad'); renderPads(); sound.reveal(); resume();
    return;
  }
  if (p.id === 'peek') {
    const shown = R.revealAll(st);
    if (!shown.length) { sound.nope(); say('No hidden crew right now', 1600); return; }
    spend('peek'); sound.reveal(); renderQueues();
    return;
  }
  if (p.id === 'recall' && !st.slots.some(s => s && !s.leaving)) { sound.nope(); say('No crew on the pads yet', 1600); return; }
  if (state === 'jam') resume();
  setMode(p.id);
}

function spend(id) { save.stock[id] = Math.max(0, save.stock[id] - 1); usedPower = true; persist(); renderTray(); }

function setMode(m) {
  mode = m;
  document.querySelectorAll('.pw').forEach(b => b.classList.toggle('on', b.dataset.id === m));
  padEls.forEach((p, i) => p.classList.toggle('pick', m === 'recall' && !!st.slots[i]));
  const p = POWERS.find(x => x.id === m);
  if (p) say(p.how, 0); else say('', 1);
}

function useOnCube(cell) {
  if (mode === 'bomb') {
    const gone = R.blast(st, cell, 2.4);
    gone.forEach(c => stage.smash(c, 3));
    stage.burst(cell, stage.colors[L.model.cells[cell] - 1], 20);
    sound.boom(); buzz.tick(0);
    spend('bomb');
  } else if (mode === 'sweep') {
    const color = L.model.cells[cell] - 1;
    const gone = R.sweep(st, color);
    if (!gone.length) { sound.nope(); return; }
    gone.forEach((c, k) => setTimeout(() => stage.smash(c, 2), k * 6));
    sound.reveal(); buzz.tick(0);
    spend('sweep');
  }
  setMode(null);
  afterHit();
}

// ---------- the loop ----------
const choose = stage.chooser();

function tick(dt) {
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    if (!s || s.leaving) continue;
    s.cool = (s.cool || 0) - dt;
    while (s.cool <= 0 && R.canFire(st, i)) {
      s.cool += FIRE_GAP;
      const cell = R.fire(st, i, choose);
      if (cell < 0) break;
      launch(i, s, cell);
    }
    if (s.cool < 0) s.cool = 0;
    padEls[i]?.firstChild?.classList.toggle('busy', R.canFire(st, i));
    if (s.count <= 0) s.leaving = true;
  }
  for (let i = 0; i < st.slots.length; i++) {
    const s = st.slots[i];
    if (s && s.leaving && !s.exiting && !inflight.get(s.id)) exit(i, s);
  }
  if (R.isWon(st)) {
    if (!fx.busy && !stage.flashes.size) { winClock += dt; if (winClock > 0.25) win(); }
    return;
  }
  if (R.isJammed(st) && !fx.busy) { jamClock += dt; if (jamClock > 0.8) jam(); } else jamClock = 0;
}

function launch(i, s, cell) {
  const r = padEls[i].getBoundingClientRect();
  inflight.set(s.id, (inflight.get(s.id) || 0) + 1);
  setCount(i, s.count);
  recoil(i);
  const g = gen;
  fx.shoot(r.left + r.width / 2, r.top + 6, st.palette[s.color], () => stage.screen(cell), () => {
    if (g !== gen) return;
    inflight.set(s.id, inflight.get(s.id) - 1);
    stage.hit(cell);
    sound.pop(); buzz.tick(110);
    afterHit();
  });
}

function exit(i, s) {
  s.exiting = true;
  const el = padEls[i]?.firstChild;
  const g = gen;
  const done = () => {
    if (g !== gen) return;
    if (st.slots[i] === s) { R.release(st, i); renderPad(i); }
  };
  if (s.count <= 0) sound.done();
  if (!el) return done();
  el.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(-24px) scale(1.25)', opacity: 0 }], { duration: 260, easing: 'ease-in' }).finished.then(done, done);
}

// Crew whose colour is gone from the sculpture leave.
function afterHit() {
  const gone = R.purgeCleared(st);
  if (!gone.length) return;
  let queues = false;
  for (const g of gone) {
    if (g.where === 'slot') { g.shooter.leaving = true; }
    else queues = true;
  }
  if (queues) renderQueues();
}

function win() {
  state = 'won';
  setMode(null);
  stage.finale(); fx.party(); sound.win(); buzz.tick(0);
  const n = save.level;
  const reward = 50 + n * 10 + (usedPower ? 0 : 25);
  save.coins += reward;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length - 1, n + 1));
  persist(); renderCoins();
  $('win-thumb').src = thumb(n);
  $('win-title').textContent = `${LEVELS[n].name} popped!`;
  $('win-coins').textContent = `+${reward}`;
  $('win-next').textContent = n + 1 < LEVELS.length ? 'Next level' : 'Play level 1 again';
  setTimeout(() => { if (state === 'won') $('win').hidden = false; }, 1100);
}

function jam() {
  state = 'jam';
  sound.jam(); buzz.tick(0);
  const padBtn = $('jam-pad');
  padBtn.disabled = st.slots.length >= R.MAX_SLOTS;
  padBtn.textContent = save.stock.pad ? `Extra pad (${save.stock.pad} left)` : `Extra pad (${PRICE} coins)`;
  $('jam-recall').textContent = save.stock.recall ? `Recall one (${save.stock.recall} left)` : `Recall one (${PRICE} coins)`;
  padEls.forEach(p => p.classList.add('stuck'));
  $('jam').hidden = false;
}

function resume() { state = 'play'; jamClock = 0; $('jam').hidden = true; padEls.forEach(p => p.classList.remove('stuck')); }

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'play') tick(dt);
  stage.update(dt);
  fx.update(dt);
  requestAnimationFrame(frame);
}

// ---------- top bar, tray, sheets ----------
function renderCoins() { $('coin-count').textContent = save.coins; }

const TICK = '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 8.5 6.5 12 13 4.5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg viewBox="0 0 16 16" width="10" height="10"><rect x="3" y="7" width="10" height="8" rx="2" fill="#fff"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#fff" stroke-width="2" fill="none"/></svg>';

// Five pictures around the current level: beaten ones ticked, later ones locked.
function renderStrip() {
  const box = $('strip');
  box.innerHTML = '';
  const n = save.level;
  const from = Math.max(0, Math.min(LEVELS.length - 5, n - 2));
  for (let k = from; k < Math.min(LEVELS.length, from + 5); k++) {
    const kind = k === n ? 'now' : k < save.unlocked ? 'done' : k > save.unlocked ? 'locked' : 'open';
    const t = document.createElement('div');
    t.className = `t ${kind}`;
    t.innerHTML = `<img alt="${LEVELS[k].name}" src="${thumb(k)}">` +
      (kind === 'done' ? `<span class="mark">${TICK}</span>` : kind === 'locked' ? `<span class="mark">${LOCK}</span>` : '');
    box.appendChild(t);
  }
}

function renderTray() {
  const box = $('tray');
  box.innerHTML = '';
  for (const p of POWERS) {
    const b = document.createElement('button');
    b.className = 'pw' + (mode === p.id ? ' on' : '');
    b.dataset.id = p.id;
    b.setAttribute('aria-label', p.name);
    const n = save.stock[p.id];
    b.innerHTML = ICONS[p.id] + (n ? `<span class="count">${n}</span>` : `<span class="count buy">${PRICE}</span>`) + `<span class="label">${p.name}</span>`;
    b.addEventListener('click', () => onPower(p));
    box.appendChild(b);
  }
}

function renderSettings() {
  $('opt-sound').checked = save.sound;
  $('opt-vibe').checked = save.vibe;
  const grid = $('level-grid');
  grid.innerHTML = '';
  LEVELS.forEach((lv, k) => {
    const b = document.createElement('button');
    b.className = k === save.level ? 'now' : '';
    b.disabled = k > save.unlocked;
    b.setAttribute('aria-label', `Level ${k + 1}, ${lv.name}`);
    b.innerHTML = `<img alt="" src="${thumb(k)}"><span>${k + 1}</span>`;
    b.addEventListener('click', () => start(k));
    grid.appendChild(b);
  });
}

let say = (text, ms) => {
  const b = $('banner');
  clearTimeout(bannerTimer);
  if (!text) { b.hidden = true; return; }
  b.textContent = text;
  b.hidden = false;
  if (ms) bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
};

// ---------- stage touch: drag to turn, tap to aim a power-up ----------
{
  const cv = $('gl');
  let down = null;
  cv.addEventListener('pointerdown', e => { sound.unlock(); down = { x: e.clientX, y: e.clientY, lx: e.clientX, moved: 0 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.lx;
    down.lx = e.clientX;
    down.moved += Math.abs(dx);
    stage.drag(dx);
  });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const tap = down.moved < 8 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10;
    down = null;
    if (tap && (mode === 'bomb' || mode === 'sweep') && state === 'play') {
      const cell = stage.pick(e.clientX, e.clientY);
      if (cell >= 0) useOnCube(cell);
    }
  });
  cv.addEventListener('pointercancel', () => { down = null; });
}

$('gear').addEventListener('click', () => { renderSettings(); $('settings').hidden = false; });
$('close-settings').addEventListener('click', () => { $('settings').hidden = true; });
$('opt-sound').addEventListener('change', e => { save.sound = sound.on = e.target.checked; persist(); });
$('opt-vibe').addEventListener('change', e => { save.vibe = buzz.on = e.target.checked; persist(); });
$('restart').addEventListener('click', () => start(save.level));
$('reset').addEventListener('click', () => {
  if (!confirm('Start over from level 1? Your coins and power-ups go back to the start too.')) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});
$('win-next').addEventListener('click', () => start(save.level + 1 < LEVELS.length ? save.level + 1 : 0));
$('jam-pad').addEventListener('click', () => onPower(POWERS[1]));
$('jam-recall').addEventListener('click', () => onPower(POWERS[2]));
$('jam-retry').addEventListener('click', () => start(save.level));
window.addEventListener('resize', () => { stage.resize(); fx.resize(); });
new ResizeObserver(() => stage.resize()).observe($('stage'));

start(save.level);
requestAnimationFrame(frame);

// For the automated checks: a small window onto the game.
window.crumble = { get state() { return state; }, get board() { return st; }, start, send: onSend, save };
