// Crumble Crew, levels only: wires the rules, the 3D stage and the effects to the screen.
// There are no coins, power-ups or menus. Win a level and the next one starts; run out of
// room and a tap starts the level again; clear the last level and the ending stays until a tap
// starts level 1. The arrows at the top move between levels; the speaker turns sound on or off.
import { Stage } from './render.js';
import { Fx } from './fx.js';
import { Sound, Buzz } from './audio.js';
import { LEVELS, buildLevel } from './levels.js';
import * as R from './logic.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'crumble-crew.level';      // the level being played, 0 to 19
const SOUND_KEY = 'crumble-crew.sound';     // '0' when the player turned sound off
const DONE_KEY = 'crumble-crew.all-cleared'; // how many times every level has been cleared
const FIRE_GAP = 1 / 30;  // seconds per tick of the rules: each pad sends at most one shot a tick, and a
                          // shot lands R.FLIGHT ticks after it leaves (js/logic.js)
const LAND = 5;           // ticks (about 150 ms) a crew member takes to land on its pad before its first shot
const HOLD = 6;           // ticks a front stays "ready" after its colour closes, so it does not flicker
const NEXT_AFTER = 1700;  // milliseconds of confetti before the next level starts
const LAST = LEVELS.length - 1;

// Browser storage can be missing or blocked; the game plays on without it.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* blocked or private mode */ } },
};

// A level number as written in the address (base 1) or saved (base 0), as a whole level index
// from 0 to LAST; NaN when it is no number at all. ?level=1.5, ?level=-25 or a broken save never
// stop the game (the inline script in index.html does the same for the first paint).
function levelOf(v, base) {
  if (v === null || v === undefined || !String(v).trim()) return NaN;
  const n = Math.round(Number(v)) - base;
  return Number.isFinite(n) ? Math.min(LAST, Math.max(0, n)) : NaN;
}

// ---------- which level: ?level=7 in the address wins, then the one saved last time ----------
let current = levelOf(new URLSearchParams(location.search).get('level'), 1);
if (Number.isNaN(current)) current = levelOf(store.get(SAVE_KEY), 0);
if (Number.isNaN(current)) current = 0;

// ---------- the pieces ----------
const stage = new Stage($('gl'));
const fx = new Fx($('fx'));
const sound = new Sound();
const buzz = new Buzz($('haptic'));

let L, st, gen = 0, state = 'play', jamClock = 0, winClock = 0, bannerTimer = 0, partyTimer = 0, clock = 0;
let padEls = [], fronts = [];
let openUntil = [];          // per colour: the last tick a front of that colour still shows ready
const firedAt = new Map();   // crew id -> tick of its last shot
const clearedColours = new Set();
const leavers = new Set();   // crew that have sent their last shot, drawn leaving over a pad that is already free

// ---------- level start ----------
function start(n) {
  gen++;
  n = Math.round(Number(n));
  current = Number.isFinite(n) ? ((n % LEVELS.length) + LEVELS.length) % LEVELS.length : 0; // the arrows wrap around
  store.set(SAVE_KEY, current);
  L = buildLevel(current); // a fresh copy of the level, dealt once and kept (js/levels.js)
  st = L.board;
  stage.load(st, L.model);
  fx.shots.length = 0;
  for (const el of leavers) el.remove();
  leavers.clear();
  firedAt.clear();
  clearedColours.clear();
  openUntil = st.palette.map(() => -Infinity);
  clearTimeout(partyTimer);
  state = 'play'; jamClock = 0; winClock = 0; clock = 0;
  $('level-name').textContent = `Level ${current + 1}`;
  $('level-sub').textContent = LEVELS[current].name;
  $('ending').hidden = true;
  renderPads(); renderQueues(); progress(); showReach();
  $('loading').hidden = true;
  say('', 0);
  $('hint').hidden = current !== 0; // level 1 says what to do until the first send
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
  fronts = [];
  st.columns.forEach((col, ci) => {
    const c = document.createElement('div');
    c.className = 'col' + (col.length ? '' : ' empty');
    c.style.setProperty('--k', ci);
    // The front crew member is the button; the two behind it stand back and only show what
    // comes next. Tapping one of them points at the front of its line.
    col.slice(0, 3).forEach((s, k) => {
      const slot = document.createElement(k ? 'div' : 'button');
      slot.className = `slot s${k + 1}` + (k ? '' : ' front');
      const el = crewEl(s);
      if (!k) {
        slot.type = 'button';
        slot.setAttribute('aria-label', s.hidden ? 'Send the hidden crew member' : `Send ${s.count}`);
        // One activation path for touch, mouse, Enter, Space and screen readers: one send per tap.
        slot.addEventListener('click', () => onSend(ci));
        fronts[ci] = el;
      } else {
        slot.addEventListener('click', () => nudge(ci));
      }
      slot.appendChild(el);
      c.appendChild(slot);
    });
    box.appendChild(c);
  });
}

function nudge(ci) {
  const el = fronts[ci];
  if (!el || state !== 'play') return;
  el.classList.remove('nudge');
  void el.offsetWidth; // start the animation again on a second tap
  el.classList.add('nudge');
  setTimeout(() => el.classList.remove('nudge'), 600);
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

// The flight up to the pad moves the crew member as a whole; the recoil of each shot squashes
// only its body inside, so the two never fight. The flight ends before the first shot (LAND).
function flyFrom(el, from) {
  const to = el.getBoundingClientRect();
  el.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(0.92)` },
    { transform: 'translate(0, -6px) scale(1.05)', offset: 0.75 },
    { transform: 'translate(0, 0)' },
  ], { duration: 120, easing: 'cubic-bezier(.2,.8,.3,1)' });
}

function setCount(i, n) {
  const el = padEls[i]?.querySelector('.n');
  if (el) el.textContent = n;
}

function recoil(i) {
  const el = padEls[i]?.querySelector('.body');
  if (!el || el._t > performance.now() - 70) return;
  el._t = performance.now();
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1, 0.88) translateY(3px)' }, { transform: 'scale(1)' }], { duration: 90 });
}

// ---------- what each crew member can reach right now ----------
// A colour can be hit when one of its cubes has nothing on top and no shot has taken it yet:
// R's st.exposed, the same test the rules fire by. A front of a line is ready when its colour
// can be hit; otherwise it is asleep (sent now it would only park). A crew member on a pad is
// awake while it has something to hit or a shot of its own in the air; otherwise it is asleep
// and its pad shows it is waiting. Run every frame, so it changes the moment a shot lands.
function showReach() {
  for (let c = 0; c < openUntil.length; c++) if (st.exposed[c].size) openUntil[c] = st.tick + HOLD;
  fronts.forEach((el, ci) => {
    const s = st.columns[ci][0];
    if (!el || !s || s.hidden) return;
    const ready = st.tick <= openUntil[s.color];
    if (el._ready === ready) return;
    el._ready = ready;
    el.classList.toggle('ready', ready);
    el.classList.toggle('asleep', !ready);
    el.parentNode.setAttribute('aria-label', `Send ${s.count}` + (ready ? '' : ', its colour is buried'));
  });
  for (let i = 0; i < padEls.length; i++) {
    const s = st.slots[i];
    const awake = !!s && (R.canReach(st, i) || st.tick - (firedAt.get(s.id) ?? -Infinity) <= R.FLIGHT);
    const el = padEls[i].firstChild;
    if (el) { el.classList.toggle('ready', awake); el.classList.toggle('asleep', !awake); }
    padEls[i].classList.toggle('waiting', !!s && !awake);
  }
}

// ---------- the one thing the player does: send the front of a line up to a pad ----------
function onSend(ci) {
  sound.unlock();
  if (state !== 'play' || !st.columns[ci]?.length) return;
  if (R.freeSlot(st) < 0) {
    sound.nope(); buzz.tick();
    $('pads').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 });
    return;
  }
  const keyboard = !!document.activeElement?.closest?.('#queues'); // keep a keyboard player's place
  const from = $('queues').children[ci].querySelector('.slot').getBoundingClientRect();
  const res = R.deploy(st, ci, LAND);
  sound.send(); buzz.tick();
  $('hint').hidden = true;
  renderQueues();
  renderPad(res.slot, from);
  if (res.revealed) {
    sound.reveal();
    const el = $('queues').children[ci].querySelector('.crew');
    el?.animate([{ transform: 'rotateY(90deg) scale(0.8)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }
  showReach();
  if (keyboard) $('queues').children[ci].querySelector('button')?.focus({ preventScroll: true });
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
    if (landed.length) afterHit(landed);
  }
  showReach();
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
  firedAt.set(shooter.id, st.tick);
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

// Shots have landed: the progress bar moves, a colour whose last cube went gets its pulse and
// chime, and crew whose colour is gone leave (a dealt level never needs that last part: its
// crew carry exactly as many shots as their colour has cubes).
function afterHit(landed) {
  progress();
  for (const cell of landed) {
    const c = L.model.cells[cell] - 1;
    if (c >= 0 && st.remaining[c] === 0 && !clearedColours.has(c)) { clearedColours.add(c); colourCleared(c); }
  }
  const gone = R.purgeCleared(st);
  if (!gone.length) return;
  let queues = false;
  for (const g of gone) {
    if (g.where === 'slot') leave(g.slot);
    else queues = true;
  }
  if (queues) renderQueues();
}

function progress() {
  $('progress').firstChild.style.transform = `scaleX(${st.cleared / Math.max(1, st.total)})`;
}

function colourCleared(c) {
  const col = st.palette[c];
  $('progress').animate([
    { boxShadow: `0 0 0 0 ${col}`, transform: 'scaleY(1)' },
    { boxShadow: `0 0 0 4px ${col}`, transform: 'scaleY(1.8)', offset: 0.3 },
    { boxShadow: '0 0 0 9px transparent', transform: 'scaleY(1)' },
  ], { duration: 560, easing: 'ease-out' });
  if (!R.isWon(st)) { sound.clear(); buzz.tick(0); } // the last colour gets the win's own fanfare
}

// Won: confetti, then the next level by itself; after the last level, the ending.
function win() {
  state = 'won';
  stage.finale(); fx.party(); buzz.tick(0);
  if (current === LAST) return ending();
  sound.win();
  say(`${LEVELS[current].name} popped!`, 0);
  const g = gen;
  setTimeout(() => { if (g === gen) start(current + 1); }, NEXT_AFTER);
}

// Every level cleared. The ending stays, with confetti now and then, until a tap starts level 1.
// Completion is kept apart from the level being played, and the next visit opens level 1.
function ending() {
  state = 'done';
  store.set(DONE_KEY, (Number(store.get(DONE_KEY)) || 0) + 1);
  store.set(SAVE_KEY, 0);
  sound.allClear();
  say('', 0);
  $('ending-title').textContent = `All ${LEVELS.length} cleared`;
  $('ending').hidden = false;
  const g = gen;
  const more = () => {
    if (g !== gen || state !== 'done') return;
    fx.party(); stage.finale();
    partyTimer = setTimeout(more, 2600);
  };
  partyTimer = setTimeout(more, 2600);
}

// Out of room: every pad is full and none of them can hit anything. A tap starts the level again.
function jam() {
  state = 'jam';
  sound.jam(); buzz.tick(0);
  padEls.forEach(p => p.classList.add('stuck'));
  say('Out of room. Tap to try again.', 0);
}

// The tap after running out of room, or on the ending, anywhere but the top bar. It is taken
// before any button under the finger sees it, so it never also sends a crew member. Only a real
// tap or key counts: the haptic switch's own click (js/audio.js) is not one.
window.addEventListener('click', e => {
  if ((state !== 'jam' && state !== 'done') || !e.isTrusted) return;
  if (e.target instanceof Element && e.target.closest('.top')) return;
  e.stopPropagation(); e.preventDefault();
  start(state === 'done' ? 0 : current);
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

// ---------- drag the sculpture to turn it (js/render.js turns it by speed, not by event) ----------
{
  const cv = $('gl');
  let lastX = null, lastT = 0;
  cv.addEventListener('pointerdown', e => {
    sound.unlock();
    lastX = e.clientX; lastT = e.timeStamp;
    cv.setPointerCapture(e.pointerId);
    stage.dragStart();
  });
  cv.addEventListener('pointermove', e => {
    if (lastX === null) return;
    stage.drag(e.clientX - lastX, e.timeStamp - lastT);
    lastX = e.clientX; lastT = e.timeStamp;
  });
  const end = e => {
    if (lastX === null) return;
    stage.dragEnd(e.timeStamp - lastT);
    lastX = null;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('lostpointercapture', end);
}

// ---------- sound on or off, remembered; off also stops the buzz ----------
function setSound(on) {
  sound.on = on; buzz.on = on;
  $('sound').setAttribute('aria-pressed', String(on));
}
setSound(store.get(SOUND_KEY) !== '0');
$('sound').addEventListener('click', () => {
  setSound(!sound.on);
  store.set(SOUND_KEY, sound.on ? 1 : 0);
  if (sound.on) { sound.unlock(); sound.send(); }
});

$('prev').addEventListener('click', () => start(current - 1));
$('next').addEventListener('click', () => start(current + 1));
$('again').addEventListener('click', () => start(current));
window.addEventListener('resize', () => { stage.resize(); fx.resize(); });
new ResizeObserver(() => stage.resize()).observe($('stage'));

start(current);
requestAnimationFrame(frame);

// For the automated checks: a small window onto the game. state is 'play', 'won', 'jam' or
// 'done' (the ending after the last level); allCleared is how many times every level was cleared.
window.crumble = {
  get state() { return state; }, get board() { return st; }, get level() { return current; },
  get allCleared() { return Number(store.get(DONE_KEY)) || 0; },
  start, send: onSend,
};
