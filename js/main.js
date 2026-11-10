// Crumble Crew, levels only: wires the rules, the 3D stage and the effects to the screen.
// There are no coins, power-ups or menus. Win a level and the next one starts; run out of
// room and a tap starts the level again. The arrows at the top move between levels.
import { Stage } from './render.js';
import { Fx } from './fx.js';
import { Sound, Buzz } from './audio.js';
import { LEVELS, buildLevel } from './levels.js';
import * as R from './logic.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'crumble-crew.level';
const FIRE_GAP = 1 / 30;  // seconds per tick of the rules: each pad sends at most one shot a tick, and a
                          // shot lands R.FLIGHT ticks after it leaves (js/logic.js)
const NEXT_AFTER = 1700;  // milliseconds of confetti before the next level starts

// ---------- which level: ?level=7 in the address wins, then the one saved last time ----------
const asked = Number(new URLSearchParams(location.search).get('level'));
let current = asked >= 1 ? asked - 1 : Number(localStorage.getItem(SAVE_KEY)) || 0;

// ---------- the pieces ----------
const stage = new Stage($('gl'));
const fx = new Fx($('fx'));
const sound = new Sound();
const buzz = new Buzz($('haptic'));

let L, st, gen = 0, state = 'play', jamClock = 0, winClock = 0, bannerTimer = 0, clock = 0;
let padEls = [];
const leavers = new Set(); // crew that have sent their last shot, drawn leaving over a pad that is already free

// ---------- level start ----------
function start(n) {
  gen++;
  current = (n + LEVELS.length) % LEVELS.length;
  try { localStorage.setItem(SAVE_KEY, current); } catch { /* private mode */ }
  L = buildLevel(current); // a fresh copy of the level, dealt once and kept (js/levels.js)
  st = L.board;
  stage.load(st, L.model);
  fx.shots.length = 0;
  for (const el of leavers) el.remove();
  leavers.clear();
  state = 'play'; jamClock = 0; winClock = 0; clock = 0;
  $('level-name').textContent = `Level ${current + 1}`;
  $('level-sub').textContent = LEVELS[current].name;
  renderPads(); renderQueues();
  $('loading').hidden = true;
  say('', 0);
}

// ---------- crew ----------
function crewEl(s) {
  const el = document.createElement('span');
  el.className = 'crew' + (s.hidden ? ' egg' : '');
  if (!s.hidden) el.style.setProperty('--c', st.palette[s.color]);
  el.innerHTML = `<span class="body"><span class="eyes"><i></i><i></i></span><b class="n">${s.hidden ? '?' : s.count}</b></span>`;
  return el;
}

function renderQueues() {
  const box = $('queues');
  box.innerHTML = '';
  st.columns.forEach((col, ci) => {
    const c = document.createElement('div');
    c.className = 'col' + (col.length ? '' : ' empty');
    // The front crew member is the button; the two behind it only show what comes next.
    col.slice(0, 3).forEach((s, k) => {
      const slot = document.createElement(k ? 'div' : 'button');
      slot.className = `slot s${k + 1}` + (k ? '' : ' front');
      if (!k) {
        slot.setAttribute('aria-label', s.hidden ? 'Send the hidden crew member' : `Send ${s.count}`);
        slot.addEventListener('pointerdown', e => { e.preventDefault(); onSend(ci); });
      }
      slot.appendChild(crewEl(s));
      c.appendChild(slot);
    });
    box.appendChild(c);
  });
}

function renderPads() {
  const box = $('pads');
  box.innerHTML = '';
  padEls = st.slots.map(() => {
    const pad = document.createElement('div');
    pad.className = 'pad';
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

// ---------- the one thing the player does: send the front of a line up to a pad ----------
function onSend(ci) {
  sound.unlock();
  if (state !== 'play' || !st.columns[ci].length) return;
  if (R.freeSlot(st) < 0) {
    sound.nope(); buzz.tick();
    $('pads').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 });
    return;
  }
  const from = $('queues').children[ci].querySelector('.slot').getBoundingClientRect();
  const res = R.deploy(st, ci);
  sound.send(); buzz.tick();
  renderQueues();
  renderPad(res.slot, from);
  if (res.revealed) {
    sound.reveal();
    const el = $('queues').children[ci].querySelector('.crew');
    el?.animate([{ transform: 'rotateY(90deg) scale(0.8)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }
}

// ---------- the loop ----------
// The rules run in ticks of FIRE_GAP (R.step in js/logic.js): the shots that are due land, then
// every pad that can fire sends one. The screen only draws what each tick did.
function tick(dt) {
  clock += dt;
  while (clock >= FIRE_GAP) {
    clock -= FIRE_GAP;
    const { landed, shots } = R.step(st);
    for (const shot of shots) launch(shot);
    if (landed.length) afterHit();
  }
  for (let i = 0; i < st.slots.length; i++) padEls[i]?.firstChild?.classList.toggle('busy', R.canFire(st, i));
  if (R.isWon(st)) {
    if (!fx.busy && !stage.flashes.size) { winClock += dt; if (winClock > 0.25) win(); }
    return;
  }
  if (R.isJammed(st) && !fx.busy) { jamClock += dt; if (jamClock > 0.8) jam(); } else jamClock = 0;
}

// A shot has left a pad for `cell`. The cube is taken now and goes when the rules land the shot;
// the flying dot and the burst are only its picture. The burst comes when the dot arrives, which is
// never later than the rules land it, so nothing under a cube is hit before that cube visibly pops.
function launch({ slot, shooter, cell, freed }) {
  const r = padEls[slot].getBoundingClientRect();
  setCount(slot, shooter.count);
  recoil(slot);
  const g = gen;
  fx.shoot(r.left + r.width / 2, r.top + 6, st.palette[shooter.color], () => stage.screen(cell), () => {
    if (g !== gen) return;
    stage.hit(cell);
    sound.pop(); buzz.tick(110);
  });
  if (freed) leave(slot);
}

// A crew member with nothing left to do leaves at once: its pad is free for the next one right
// away, and the leaving picture is a copy laid over the page that nothing waits for.
function leave(slot) {
  const el = padEls[slot]?.firstChild;
  const r = el?.getBoundingClientRect();
  renderPad(slot);
  sound.done();
  if (!el) return;
  Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, margin: '0', zIndex: '5' });
  document.body.appendChild(el);
  leavers.add(el);
  const gone = () => { el.remove(); leavers.delete(el); };
  el.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(-24px) scale(1.25)', opacity: 0 }], { duration: 260, easing: 'ease-in' }).finished.then(gone, gone);
}

// Crew whose colour is gone from the sculpture leave (a dealt level never needs this: its crew
// carry exactly as many shots as their colour has cubes).
function afterHit() {
  const gone = R.purgeCleared(st);
  if (!gone.length) return;
  let queues = false;
  for (const g of gone) {
    if (g.where === 'slot') leave(g.slot);
    else queues = true;
  }
  if (queues) renderQueues();
}

// Won: confetti, then the next level by itself.
function win() {
  state = 'won';
  stage.finale(); fx.party(); sound.win(); buzz.tick(0);
  say(`${LEVELS[current].name} popped!`, 0);
  const g = gen;
  setTimeout(() => { if (g === gen) start(current + 1); }, NEXT_AFTER);
}

// Out of room: every pad is full and none of them can hit anything. A tap starts the level again.
function jam() {
  state = 'jam';
  sound.jam(); buzz.tick(0);
  padEls.forEach(p => p.classList.add('stuck'));
  say('Out of room. Tap to try again.', 0);
}

window.addEventListener('pointerdown', e => {
  if (state !== 'jam' || e.target.closest('.top')) return;
  e.stopPropagation(); e.preventDefault();
  start(current);
}, true);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state === 'play') tick(dt);
  stage.update(dt);
  fx.update(dt);
  requestAnimationFrame(frame);
}

function say(text, ms) {
  const b = $('banner');
  clearTimeout(bannerTimer);
  if (!text) { b.hidden = true; return; }
  b.textContent = text;
  b.hidden = false;
  if (ms) bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

// ---------- drag the sculpture to turn it ----------
{
  const cv = $('gl');
  let lastX = null;
  cv.addEventListener('pointerdown', e => { sound.unlock(); lastX = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (lastX === null) return;
    stage.drag(e.clientX - lastX);
    lastX = e.clientX;
  });
  cv.addEventListener('pointerup', () => { lastX = null; });
  cv.addEventListener('pointercancel', () => { lastX = null; });
}

$('prev').addEventListener('click', () => start(current - 1));
$('next').addEventListener('click', () => start(current + 1));
$('again').addEventListener('click', () => start(current));
window.addEventListener('resize', () => { stage.resize(); fx.resize(); });
new ResizeObserver(() => stage.resize()).observe($('stage'));

start(Math.min(current, LEVELS.length - 1));
requestAnimationFrame(frame);

// For the automated checks: a small window onto the game.
window.crumble = { get state() { return state; }, get board() { return st; }, get level() { return current; }, start, send: onSend };
