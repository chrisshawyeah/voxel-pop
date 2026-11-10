// Crumble Crew, levels only: wires the rules, the 3D stage and the effects to the screen.
// There are no coins, power-ups or menus. Win a level and the next one starts; run out of
// room and a tap takes back the last send (again and again, to the start of the level); clear
// the last level and the ending stays until a tap starts level 1. The undo button takes back
// a send at any time, the arrows move between levels, the level's name restarts it and the
// speaker turns sound on or off.
import { Stage } from './render.js';
import { Fx } from './fx.js';
import { Sound, Buzz } from './audio.js';
import { LEVELS, buildLevel } from './levels.js';
import * as R from './logic.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'crumble-crew.level';             // the level being played, 0 to 19
const SOUND_KEY = 'crumble-crew.sound';            // '0' when the player turned sound off
const DONE_KEY = 'crumble-crew.all-cleared';       // how many times every level has been cleared
const CLEARED_KEY = 'crumble-crew.cleared-levels'; // which levels have been won since then, one bit each
const ATTEMPT_KEY = 'crumble-crew.attempt';        // the level being played: its sends so far
const TAUGHT_KEY = 'crumble-crew.taught';          // 1 once a crew member was sent, 2 once a sleeper woke
const FIRE_GAP = 1 / 30;  // seconds per tick of the rules: each pad sends at most one shot a tick, and a
                          // shot lands R.FLIGHT ticks after it leaves (js/logic.js)
const LAND = 5;           // ticks (about 150 ms) a crew member takes to land on its pad before its first shot
const NEXT_AFTER = 1700;  // milliseconds of confetti before the next level starts
const LAST = LEVELS.length - 1;
const TEACH_UNTIL = 2;    // levels 1 to 3 teach, never after
const BUILD = document.querySelector('meta[name="build"]')?.content || 'dev';

// Browser storage can be missing or blocked; the game plays on without it.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, String(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
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

let L, att, st, gen = 0, state = 'play', jamClock = 0, winClock = 0, bannerTimer = 0, partyTimer = 0, clock = 0;
let padEls = [], fronts = [], forecasts = [], dirty = true;
let previewOf = -1;          // the line whose preview is open, -1 when none
let taught = Number(store.get(TAUGHT_KEY)) || 0;
let sleeper = -1;            // the crew member the parking lesson is about (its id), -1 when none
let lessonAt = 0, lessonUntil = 0; // when the parking line came up; once its sleeper woke, when it goes
let newBuild = false;        // a new version of the game is live; it loads at the next level boundary
let dragged = 0;             // how far the last press on the sculpture moved, in pixels
const clearedColours = new Set();
const leavers = new Set();   // crew that have sent their last shot, drawn leaving over a pad that is already free
const padState = [];         // per pad: what its label and live announcement last said

const names = () => L.model.names;
const crewName = s => (s.hidden ? 'a hidden crew member' : `${names()[s.color]} ${s.count}`);

// ---------- the attempt kept in storage: a page that iOS stopped comes back where it was ----------
// Only the sends are kept (line and tick); R.Attempt.replay plays them again with the game's own
// ticks, which gives back the board just after the last send and every undo before it. With each
// send goes a check of the board just after it, so a replay under changed rules (a new version
// loaded meanwhile) that comes out different is dropped instead of played.
const levelKey = n => JSON.stringify(LEVELS[n]);
const checkOf = b => [b.tick, b.cleared, b.h1, b.h2];
let checks = []; // checkOf(the board) just after each send
function saveAttempt() {
  if (!att.sends.length) store.remove(ATTEMPT_KEY);
  else store.set(ATTEMPT_KEY, JSON.stringify({ level: current, def: levelKey(current), sends: att.sends, checks }));
}
function savedAttempt(n) {
  try {
    const a = JSON.parse(store.get(ATTEMPT_KEY));
    if (!a || a.level !== n || a.def !== levelKey(n) || !Array.isArray(a.sends) || !Array.isArray(a.checks) || a.checks.length !== a.sends.length) return null;
    const back = R.Attempt.replay(buildLevel(n).board, a.sends, LAND);
    if (!back || JSON.stringify(checkOf(back.board)) !== JSON.stringify(a.checks[a.checks.length - 1])) return null;
    return { att: back, checks: a.checks };
  } catch { return null; }
}

// ---------- level start ----------
function start(n, resume = null) {
  n = Math.round(Number(n));
  n = Number.isFinite(n) ? ((n % LEVELS.length) + LEVELS.length) % LEVELS.length : 0; // the arrows wrap around
  if (newBuild) return reloadAt(n); // a level boundary: the new version loads now
  gen++;
  current = n;
  store.set(SAVE_KEY, current);
  L = buildLevel(current); // a fresh copy of the level, dealt once and kept (js/levels.js)
  att = resume ? resume.att : new R.Attempt(L.board);
  checks = resume ? resume.checks : [];
  saveAttempt();
  clearTimeout(partyTimer);
  state = 'play'; jamClock = 0; winClock = 0; clock = 0;
  $('level-name').textContent = `Level ${current + 1}`;
  $('level-sub').textContent = LEVELS[current].name;
  $('ending').hidden = true;
  showBoard();
  $('loading').hidden = true;
  say('', 0);
}

// Draws the attempt's board from scratch: at a level start, after an undo, after a restore.
// Shots in the air are drawn again from the rules; old effects go.
function showBoard() {
  st = att.board;
  stage.load(st, L.model);
  for (const el of leavers) el.remove();
  leavers.clear();
  clearedColours.clear();
  st.remaining.forEach((left, c) => { if (!left) clearedColours.add(c); });
  closePreview();
  if (lessonUntil) learnt(); // its sleeper had woken
  sleeper = -1;
  padState.length = 0;
  renderPads(); renderQueues(); progress();
  fx.shots.length = 0;
  for (const f of st.flying) shotFor(f);
  dirty = true; showReach(); teach();
  $('undo').disabled = !att.canUndo;
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
    // The front crew member is the button; the two behind it stand back and show what comes
    // next. Tapping one of them opens the whole line (preview()); it never sends.
    col.slice(0, 3).forEach((s, k) => {
      const slot = document.createElement(k < 2 ? 'button' : 'div');
      slot.className = `slot s${k + 1}` + (k ? ' rear' : ' front');
      const el = crewEl(s);
      if (!k) {
        slot.type = 'button';
        // One activation path for touch, mouse, Enter, Space and screen readers: one send per tap.
        slot.addEventListener('click', () => onSend(ci));
        const fc = document.createElement('i');
        fc.className = 'fc';
        fc.hidden = true;
        el.appendChild(fc);
        fronts[ci] = el;
      } else {
        if (k === 1) {
          slot.type = 'button';
          slot.setAttribute('aria-label', `Line ${ci + 1}: see all ${col.length} crew`);
        }
        slot.addEventListener('click', () => preview(ci));
      }
      slot.appendChild(el);
      c.appendChild(slot);
    });
    if (col.length > 3) {
      const more = document.createElement('span');
      more.className = 'more';
      more.setAttribute('aria-hidden', 'true');
      more.textContent = `+${col.length - 3}`;
      c.appendChild(more);
    }
    box.appendChild(c);
  });
}

// ---------- the whole of one line, front to back, without sending anyone ----------
// What the planning player in tools/players.mjs knows is all on the screen this way: every crew
// member in every line, a "?" as a "?", and which crew the "?" can be.
function preview(ci) {
  const col = st.columns[ci];
  if (!col?.length || (state !== 'play' && state !== 'jam')) return;
  const box = $('preview');
  const chip = s => {
    const el = crewEl(s);
    el.classList.add('mini');
    return el.outerHTML;
  };
  const rows = col.map((s, k) => `<li><span class="at">${k ? k + 1 : 'front'}</span>${chip(s)}<span class="what">${s.hidden ? '?' : names()[s.color]}</span></li>`).join('');
  const hidden = st.columns.flat().filter(s => s.hidden).sort((a, b) => a.color - b.color || a.count - b.count);
  const pool = col.some(s => s.hidden)
    ? `<p class="pool">? is one of <span>${hidden.map(s => chip({ ...s, hidden: false })).join('')}</span></p>` : '';
  box.innerHTML = `<p class="head">Line ${ci + 1} <span>front first</span></p><ol>${rows}</ol>${pool}`;
  box.setAttribute('aria-label', `Line ${ci + 1}, front first: ${col.map(crewName).join(', ')}` +
    (pool ? `. The hidden crew are among ${hidden.map(s => crewName({ ...s, hidden: false })).join(', ')}` : '') + '. Tap anywhere to close.');
  box.style.left = box.style.top = '0px'; // measured with the whole width to grow into
  box.hidden = false;
  // Above its line, inside the window; it scrolls when the line is longer than the room there.
  const lineBox = $('queues').children[ci].getBoundingClientRect();
  const top = Math.max(8, document.querySelector('.top').getBoundingClientRect().top);
  box.style.maxHeight = `${Math.max(120, lineBox.top - 6 - top)}px`;
  const w = box.offsetWidth;
  box.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, lineBox.left + lineBox.width / 2 - w / 2))}px`;
  box.style.top = `${Math.max(top, lineBox.top - 6 - box.offsetHeight)}px`;
  previewOf = ci;
  box.focus({ preventScroll: true });
}

function closePreview() {
  if (previewOf < 0) return;
  const ci = previewOf;
  previewOf = -1;
  const box = $('preview');
  const had = box.contains(document.activeElement);
  box.hidden = true;
  box.innerHTML = '';
  if (had) $('queues').children[ci]?.querySelector('.s2')?.focus({ preventScroll: true });
}

function renderPads() {
  const box = $('pads');
  box.innerHTML = '';
  padEls = st.slots.map(() => {
    const pad = document.createElement('div');
    pad.className = 'pad';
    pad.setAttribute('role', 'img');
    box.appendChild(pad);
    return pad;
  });
  st.slots.forEach((_, i) => renderPad(i));
}

function renderPad(i, fromRect) {
  const pad = padEls[i];
  pad.innerHTML = '';
  const s = st.slots[i];
  padLabel(i);
  if (!s) return;
  const el = crewEl(s);
  pad.appendChild(el);
  if (fromRect) flyFrom(el, fromRect);
}

// A pad's name for a screen reader: empty, or who is on it and whether it is firing or waiting.
function padLabel(i, awake = null) {
  const s = st.slots[i];
  padEls[i].setAttribute('aria-label', `Pad ${i + 1}: ` + (!s ? 'empty' : `${crewName(s)}, ${awake === false ? 'asleep, waiting for its colour' : 'firing'}`));
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

function setCount(i, s) {
  const el = padEls[i]?.querySelector('.n');
  if (el) el.textContent = s.count;
  padLabel(i, padState[i]?.awake ?? null);
}

function recoil(i) {
  const el = padEls[i]?.querySelector('.body');
  if (!el || el._t > performance.now() - 70) return;
  el._t = performance.now();
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1, 0.88) translateY(3px)' }, { transform: 'scale(1)' }], { duration: 90 });
}

// A screen reader hears who parks, who wakes and when a pad frees, never every shot.
function announce(text) {
  const el = $('sr');
  el.textContent = '';
  el.textContent = text;
}

// ---------- what each crew member can reach, and what sending it would do ----------
// A colour can be hit when one of its cubes has nothing on top and no shot has taken it yet:
// R's st.exposed, the same test the rules fire by. A front of a line is ready when its colour can
// be hit; otherwise it is asleep. Both switch the moment that test changes (only the glow around a
// ready crew member fades, css/game.css). A crew member on a pad is awake while it has something
// to hit or a shot of its own in the air; otherwise it is asleep and its pad shows it is waiting.
//
// Under each front's number, what sending it now would do (R.forecast, the rules run on a copy of
// the board): a tick when it finishes and frees its pad, "N left" in a dashed box when it would
// park with N still to fire. Worked out again when the board changes (a send, a shot, an undo),
// not every frame; nothing is shown while every pad is taken.
function forecastNow() {
  dirty = false;
  const canSend = R.freeSlot(st) >= 0;
  const seen = new Map(); // crew of the same colour and number fare the same
  forecasts = st.columns.map((col, ci) => {
    const s = col[0];
    if (!canSend || !s || s.hidden) return null;
    const k = `${s.color}:${s.count}`;
    if (!seen.has(k)) seen.set(k, R.forecast(st, ci, LAND));
    return seen.get(k);
  });
}

function showReach() {
  if (dirty) forecastNow();
  fronts.forEach((el, ci) => {
    const s = st.columns[ci][0];
    if (!el || !s || s.hidden) return;
    const ready = st.exposed[s.color].size > 0;
    const f = forecasts[ci];
    const key = `${ready}|${f ? (f.finishes ? 'done' : f.left) : ''}`;
    if (el._key === key) return;
    el._key = key;
    el.classList.toggle('ready', ready);
    el.classList.toggle('asleep', !ready);
    const fc = el.querySelector('.fc');
    fc.hidden = !f;
    if (f) {
      fc.className = f.finishes ? 'fc done' : 'fc park';
      fc.innerHTML = f.finishes ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4 5 8.8l4.6-5.6"/></svg>' : `${f.left} left`;
    }
    el.parentNode.setAttribute('aria-label', `Send ${crewName(s)}, ${ready ? 'ready' : 'asleep, its colour is buried'}` +
      (f ? (f.finishes ? ', finishes and frees its pad' : `, would park with ${f.left} left`) : ''));
  });
  for (let i = 0; i < padEls.length; i++) {
    const s = st.slots[i];
    const awake = !!s && (R.canReach(st, i) || st.flying.some(f => f.id === s.id));
    const el = padEls[i].firstChild;
    if (el) { el.classList.toggle('ready', awake); el.classList.toggle('asleep', !awake); }
    padEls[i].classList.toggle('waiting', !!s && !awake);
    const was = padState[i];
    const who = s ? s.id : -1;
    if (was && was.who === who && was.awake === awake) continue;
    padState[i] = { who, awake, since: performance.now() };
    padLabel(i, awake);
    if (s && was?.who === who) announce(awake ? `${names()[s.color]} wakes on pad ${i + 1}` : `${crewName(s)} is asleep on pad ${i + 1}, waiting for its colour`);
    else if (s && !awake) announce(`${crewName(s)} parks on pad ${i + 1}, waiting for its colour`);
  }
}

// ---------- levels 1 to 3 teach, one line at a time ----------
// First "Tap the front crew", until a crew member has been sent. Then, the first time a crew member
// sleeps on a pad (for half a second, not just between two shots), what that means, shown until
// that crew member wakes (and at least LESSON_MS, so it can be read). Never after level 3.
const HINT_SEND = 'Tap the front crew';
const HINT_PARK = 'Sleeping crew keep a pad. Clear the cubes above their colour.';
const LESSON_MS = 2500;
function learnt() {
  taught = 2; store.set(TAUGHT_KEY, 2);
  sleeper = -1; lessonUntil = 0;
}
function teach() {
  let text = '';
  const now = performance.now();
  if (current <= TEACH_UNTIL && state === 'play') {
    if (taught < 1 && !att.sends.length) text = HINT_SEND;
    else if (taught < 2) {
      if (!lessonUntil && sleeper >= 0) {
        const pad = padState.findIndex(p => p && p.who === sleeper);
        if (pad < 0) sleeper = -1; // it went without waking (an undo, a restart): not learnt yet
        else if (padState[pad].awake) lessonUntil = Math.max(now, lessonAt + LESSON_MS); // it woke
      }
      if (lessonUntil) {
        if (now < lessonUntil) text = HINT_PARK;
        else learnt();
      } else {
        if (sleeper < 0) {
          const p = padState.find(p => p && p.who >= 0 && !p.awake && now - p.since >= 500);
          if (p) { sleeper = p.who; lessonAt = now; }
        }
        if (sleeper >= 0) text = HINT_PARK;
      }
    }
  }
  const h = $('hint');
  if (h.textContent !== text) h.textContent = text;
  h.hidden = !text;
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
  const res = att.send(ci, LAND);
  sound.send(); buzz.tick();
  if (taught < 1) { taught = 1; store.set(TAUGHT_KEY, 1); }
  checks.push(checkOf(st));
  saveAttempt();
  $('undo').disabled = false;
  renderQueues();
  renderPad(res.slot, from);
  if (res.revealed) {
    sound.reveal();
    const el = $('queues').children[ci].querySelector('.crew');
    el?.animate([{ transform: 'rotateY(90deg) scale(0.8)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }
  dirty = true;
  showReach(); teach();
  if (keyboard) $('queues').children[ci].querySelector('button')?.focus({ preventScroll: true });
}

// ---------- undo: the board as it was just before the last send ----------
function undo() {
  if ((state !== 'play' && state !== 'jam') || !att.canUndo) return;
  sound.unlock();
  att.undo();
  checks.pop();
  gen++;
  state = 'play'; jamClock = 0; winClock = 0; clock = 0;
  say('', 0);
  saveAttempt();
  showBoard();
  sound.undo(); buzz.tick();
}

// ---------- the loop ----------
// The rules run in ticks of FIRE_GAP (R.tickGame in js/logic.js): the shots that are due land, then
// every pad that can fire sends one. The screen only draws what each tick did, on the same clock.
function tick(dt) {
  clock += dt;
  while (clock >= FIRE_GAP) {
    clock -= FIRE_GAP;
    const { landed, shots, gone } = R.tickGame(st);
    for (const shot of shots) launch(shot);
    if (landed.length) afterHit(landed, gone);
    // Anything moving changes what a send would do: shots, landings, crew still landing.
    if (landed.length || shots.length || st.flying.length || st.slots.some(s => s && s.land > 0)) dirty = true;
  }
  showReach();
  teach();
  if (R.isWon(st)) {
    if (!fx.busy) { winClock += dt; if (winClock > 0.25) win(); }
    return;
  }
  if (R.isJammed(st) && !fx.busy) { jamClock += dt; if (jamClock > 0.8) jam(); } else jamClock = 0;
}

// A shot in the air, drawn from the rules alone: from its pad to its cube, as far along as the
// rules' clock says, so the dot reaches the cube on the tick the rules land it. Its cube starts to
// flash just before.
function shotFor(f) {
  const r = padEls[f.slot].getBoundingClientRect();
  const b = st, g = gen;
  fx.shoot(r.left + r.width / 2, r.top + 6, st.palette[f.color], () => stage.screen(f.cell),
    () => (g !== gen ? 1 : (b.tick + clock / FIRE_GAP - f.from) / (f.at - f.from)),
    () => { if (g === gen) stage.flash(f.cell); });
}

// A shot has left a pad for `cell`. The cube is taken now and goes when the rules land the shot.
function launch({ slot, shooter, cell, freed }) {
  shotFor({ cell, slot, color: shooter.color, from: st.tick, at: st.tick + R.FLIGHT });
  setCount(slot, shooter);
  recoil(slot);
  if (freed) leave(slot);
}

// A crew member with nothing left to do leaves at once: its pad is free for the next one right
// away, and the leaving picture is a copy laid over the page that nothing waits for.
function leave(slot) {
  const el = padEls[slot]?.firstChild;
  const r = el?.getBoundingClientRect();
  renderPad(slot);
  sound.done();
  announce(`Pad ${slot + 1} is free`);
  if (!el) return;
  Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, margin: '0', zIndex: '5' });
  document.body.appendChild(el);
  leavers.add(el);
  const gone = () => { el.remove(); leavers.delete(el); };
  el.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'translateY(-24px) scale(1.25)', opacity: 0 }], { duration: 260, easing: 'ease-in' }).finished.then(gone, gone);
}

// Shots have landed, this tick, by the rules: their cubes pop now, the progress bar moves, a
// colour whose last cube went gets its pulse and chime, and crew whose colour is gone leave (a
// dealt level never needs that last part: its crew carry exactly as many shots as their colour
// has cubes).
function afterHit(landed, gone) {
  for (const cell of landed) stage.hit(cell);
  sound.pop(); buzz.tick(110);
  progress();
  for (const cell of landed) {
    const c = L.model.cells[cell] - 1;
    if (c >= 0 && st.remaining[c] === 0 && !clearedColours.has(c)) { clearedColours.add(c); colourCleared(c); }
  }
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
  $('undo').disabled = true;
  closePreview(); teach();
  store.set(CLEARED_KEY, (Number(store.get(CLEARED_KEY)) || 0) | (1 << current));
  stage.finale(); fx.party(); buzz.tick(0);
  if (current === LAST) return ending();
  sound.win();
  say(`${LEVELS[current].name} popped!`, 0);
  const g = gen;
  setTimeout(() => { if (g === gen) start(current + 1); }, NEXT_AFTER);
}

// The last level is won. The ending stays, with confetti now and then, until a tap starts level 1.
// It says "All 20 cleared", and counts one more full clear, only when every level has been won
// since the last full clear; reaching level 20 by the arrows or the address is "Level 20 cleared".
function ending() {
  state = 'done';
  const all = (2 ** LEVELS.length) - 1;
  const full = ((Number(store.get(CLEARED_KEY)) || 0) & all) === all;
  if (full) {
    store.set(DONE_KEY, (Number(store.get(DONE_KEY)) || 0) + 1);
    store.set(CLEARED_KEY, 0);
  }
  store.set(SAVE_KEY, 0);
  store.remove(ATTEMPT_KEY);
  sound.allClear();
  say('', 0);
  $('ending-title').textContent = full ? `All ${LEVELS.length} cleared` : `Level ${LEVELS.length} cleared`;
  $('ending').hidden = false;
  const g = gen;
  const more = () => {
    if (g !== gen || state !== 'done') return;
    fx.party(); stage.finale();
    partyTimer = setTimeout(more, 2600);
  };
  partyTimer = setTimeout(more, 2600);
}

// Out of room: every pad is full and none of them can hit anything. A tap takes back the last send.
function jam() {
  state = 'jam';
  sound.jam(); buzz.tick(0);
  closePreview(); teach();
  padEls.forEach(p => p.classList.add('stuck'));
  say(att.canUndo ? 'Out of room. Tap to undo your last send.' : 'Out of room. Tap to try again.', 0);
}

// The tap after running out of room, on the ending, or with a line's preview open, anywhere but
// the top bar (a preview closes on any tap, the top bar's too). It is taken before any button
// under the finger sees it, so it never also sends a crew member. Only a real tap or key counts:
// the haptic switch's own click (js/audio.js) is not one.
window.addEventListener('click', e => {
  if (!e.isTrusted) return;
  if (previewOf >= 0) {
    e.stopPropagation(); e.preventDefault();
    closePreview();
    return;
  }
  if (state !== 'jam' && state !== 'done') return;
  if (e.target instanceof Element && e.target.closest('.top')) return;
  if (e.target === $('gl') && dragged > 8) return; // turning the sculpture is not a tap
  e.stopPropagation(); e.preventDefault();
  if (state === 'done') start(0);
  else if (att.canUndo) undo();
  else start(current);
}, true);
window.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

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

// ---------- a new version of the game ----------
// When the page comes back into view (and when the iPhone app comes back to the front, see
// ios-app/App.js) it asks for the live page and compares its build with its own. A new version
// is loaded only at a level boundary: a level started with nothing sent, the start of the next
// level after a win, or the ending. A level in progress is never thrown away for it.
const FRESH = ['css/game.css', 'js/main.js', 'js/render.js', 'js/fx.js', 'js/audio.js', 'js/levels.js', 'js/logic.js', 'js/models.js'];
let checking = false;
async function checkForUpdate() {
  if (BUILD === 'dev' || newBuild || checking) return;
  checking = true;
  try {
    const html = await (await fetch(location.pathname, { cache: 'reload' })).text();
    const live = /<meta name="build" content="([^"]*)"/.exec(html)?.[1];
    if (!live || live === BUILD || live === 'dev') return;
    await Promise.all(FRESH.map(f => fetch(f, { cache: 'reload' }).catch(() => null))); // so the reload gets them new
    newBuild = true;
    if (state === 'done') reloadAt(0);
    else if (state === 'play' && !att.sends.length) reloadAt(current);
  } catch { /* offline: next time */ } finally { checking = false; }
}
function reloadAt(n) {
  store.remove(ATTEMPT_KEY); // every caller is a level boundary: nothing to bring back
  store.set(SAVE_KEY, n);
  const u = new URL(location.href);
  u.searchParams.delete('level'); // the saved level decides, so a page iOS stops later comes back right
  if (store.get(SAVE_KEY) !== String(n)) u.searchParams.set('level', n + 1); // storage blocked
  location.replace(u.href);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
window.addEventListener('pageshow', e => { if (e.persisted) checkForUpdate(); });

// ---------- drag the sculpture to turn it (js/render.js turns it by speed, not by event) ----------
{
  const cv = $('gl');
  let lastX = null, lastT = 0;
  cv.addEventListener('pointerdown', e => {
    sound.unlock();
    dragged = 0;
    lastX = e.clientX; lastT = e.timeStamp;
    cv.setPointerCapture(e.pointerId);
    stage.dragStart();
  });
  cv.addEventListener('pointermove', e => {
    if (lastX === null) return;
    stage.drag(e.clientX - lastX, e.timeStamp - lastT);
    dragged += Math.abs(e.clientX - lastX);
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

$('undo').addEventListener('click', undo);
$('prev').addEventListener('click', () => start(current - 1));
$('next').addEventListener('click', () => start(current + 1));
$('again').addEventListener('click', () => start(current));
window.addEventListener('resize', () => { stage.resize(); fx.resize(); closePreview(); });
new ResizeObserver(() => stage.resize()).observe($('stage'));

start(current, savedAttempt(current)); // a level left half-played comes back where it was
requestAnimationFrame(frame);

// For the automated checks: a small window onto the game. state is 'play', 'won', 'jam' or
// 'done' (the ending after the last level); allCleared is how many times every level was cleared.
// undo() takes back the last send; sends is how many sends there are to take back.
window.crumble = {
  get state() { return state; }, get board() { return st; }, get level() { return current; },
  get allCleared() { return Number(store.get(DONE_KEY)) || 0; },
  get sends() { return att.sends.length; },
  start: n => start(n), send: onSend, undo, checkForUpdate,
};
