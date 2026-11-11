// Crumble Crew, levels only: wires the rules, the 3D stage and the effects to the screen.
// There are no coins, power-ups or menus. Win a level and the next one starts; run out of
// room and a tap takes back the last send (again and again, to the start of the level); clear
// the last level, or the last one still missing, and the ending stays until a tap starts level 1.
// The undo button takes back a send at any time, the arrows move between levels (a level left
// half-played is kept and comes back), the level's name restarts it and the speaker turns sound
// on or off. A win with no undo is a clean clear, and the level's name gets a star.
import { Stage } from './render.js';
import { Fx } from './fx.js';
import { Sound, Buzz } from './audio.js';
import { LEVELS, buildLevel, levelPrint } from './levels.js';
import * as R from './logic.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'crumble-crew.level';             // the level being played, 0 to 19
const SOUND_KEY = 'crumble-crew.sound';            // '0' when the player turned sound off
const DONE_KEY = 'crumble-crew.all-cleared';       // how many times every level has been cleared
const CLEARED_KEY = 'crumble-crew.cleared-levels'; // which levels have been won since then, one bit each
const CLEAN_KEY = 'crumble-crew.clean-levels';     // which levels have been won with no undo, one bit each
const ATTEMPT_KEY = n => `crumble-crew.attempt.${n + 1}`; // level n half-played, by its number on screen
const OLD_ATTEMPT_KEY = 'crumble-crew.attempt';    // the one attempt the game kept before, for any level
const TAUGHT_KEY = 'crumble-crew.taught';          // the lessons seen, one bit each (SENT, PARK, TICK below)
const UPDATE_KEY = 'crumble-crew.update-to';       // the version the page last reloaded to load, and when
const FIRE_GAP = 1 / 30;  // seconds per tick of the rules: each pad sends at most one shot a tick, and a
                          // shot lands R.FLIGHT ticks after it leaves (js/logic.js). R.pace() says when
                          // the ticks run R.FAST times as fast.
const LAND = 5;           // ticks (about 167 ms) a crew member takes to land on its pad before its first shot
const NEXT_AFTER = 1700;  // milliseconds of confetti before the next level starts
const HOLD_MS = 300;      // a touch held this long on a front shows what sending it would do, and sends nobody
const RETRY_MS = 60000;   // a reload that came back as the old version is tried again after this long
const LAST = LEVELS.length - 1;
const TEACH_UNTIL = 2;    // levels 1 to 3 teach the first send and always show the forecast under each front
const BUILD = document.querySelector('meta[name="build"]')?.content || 'dev';
const ALL = (2 ** LEVELS.length) - 1;
const bit = n => 2 ** n;

// Browser storage can be missing or blocked; the game plays on without it, keeping in memory
// whatever it needs for the length of the visit.
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

// ---------- which level: ?level=7 in the address wins (once), then the one saved last time ----------
let current = levelOf(new URLSearchParams(location.search).get('level'), 1);
if (Number.isNaN(current)) current = levelOf(store.get(SAVE_KEY), 0);
if (Number.isNaN(current)) current = 0;

// ---------- the pieces ----------
const stage = new Stage($('gl'));
const fx = new Fx($('fx'));
const sound = new Sound();
const buzz = new Buzz($('haptic'));

let L, att, st, gen = 0, state = 'play', jamClock = 0, winClock = 0, bannerTimer = 0, partyTimer = 0, clock = 0;
let padEls = [], fronts = [];
let previewOf = -1;          // the line whose preview is open, -1 when none
let newBuild = '';           // a new version of the game is live and every file of it is fetched; it loads at the next level boundary
let dragged = 0;             // how far the last press on the sculpture moved, in pixels
let speed = 1;               // 1, or R.FAST (R.pace in js/logic.js)
let quiet = 0;               // real seconds since a finger or the mouse last went down or up, or a key was pressed
const pressed = new Set();   // the pointers down now: while one is, the ticks never speed up for quiet
let clearedMask = Number(store.get(CLEARED_KEY)) || 0; // kept here too, so a visit with storage blocked still counts
let cleanMask = Number(store.get(CLEAN_KEY)) || 0;
let allCleared = Number(store.get(DONE_KEY)) || 0;
const clearedColours = new Set();
const leavers = new Set();   // crew that have sent their last shot, drawn leaving over a pad that is already free
const padState = [];         // per pad: who is on it, awake or not, parking or not, and since when
let quietPads = false;       // the board was just drawn from scratch: pads take their state without announcing it

const names = () => L.model.names;
const crewName = s => (s.hidden ? 'a hidden crew member' : `${names()[s.color]} ${s.count}`);

// ---------- the attempt kept in storage: a page that iOS stopped comes back where it was ----------
// One per level, so arrowing away and back finds the level as it was left. Kept: the sends (line
// and tick) with a check of the board after each, the undos so far, and the tick the board was at
// when it was last saved with its check (R.Attempt.save in js/logic.js), plus a fingerprint of the
// level as dealt (levelPrint in js/levels.js) and the landing pause. It is saved after each send
// and undo, when the page is hidden or closed, and when the player moves to another level.
// R.Attempt.restore plays the sends again with the game's own ticks up to that tick. A save that
// does not fit the level any more (it was changed, or the rules) starts the level again and says so.
// The game also keeps each level's attempt in memory for the visit (`kept`), so the arrows bring
// a level back as it was left even when storage is blocked or full.
const printOf = n => `${levelPrint(n)}:${LAND}`;
const kept = new Map(); // level -> its attempt as it was left, this visit
function saveAttempt() {
  if (!att || (state !== 'play' && state !== 'jam')) return;
  if (!att.sends.length && !att.undos) { kept.delete(current); store.remove(ATTEMPT_KEY(current)); }
  else { kept.set(current, att); store.set(ATTEMPT_KEY(current), JSON.stringify({ fp: printOf(current), ...att.save() })); }
}
function forgetAttempt(n) { kept.delete(n); store.remove(ATTEMPT_KEY(n)); }
// Level n's attempt as it was left (from memory, else played back from storage); 'changed' when
// the stored one no longer fits (it is removed); null when there is none.
function savedAttempt(n) {
  if (kept.has(n)) return kept.get(n);
  const text = store.get(ATTEMPT_KEY(n));
  if (!text) return null;
  try {
    const a = JSON.parse(text);
    const back = a && a.fp === printOf(n) ? R.Attempt.restore(buildLevel(n).board, a, LAND) : null;
    if (back) return back;
  } catch { /* not a save at all */ }
  store.remove(ATTEMPT_KEY(n));
  return 'changed';
}
// The game used to keep one attempt for whichever level was being played, with no fingerprint of
// its sculpture or of the rules, so nothing can show it still fits: that level starts again and
// says "Level changed. Restarted." the first time it is opened (a save with no fingerprint is
// turned down like any other that does not fit).
try {
  const old = JSON.parse(store.get(OLD_ATTEMPT_KEY));
  store.remove(OLD_ATTEMPT_KEY);
  const n = old && old.level;
  if (Number.isInteger(n) && n >= 0 && n <= LAST && Array.isArray(old.sends) && old.sends.length && !store.get(ATTEMPT_KEY(n))) {
    store.set(ATTEMPT_KEY(n), JSON.stringify({ fp: 'old' }));
  }
} catch { /* nothing kept, or nothing usable */ }

// ?level=7 opens level 7 once; then the address forgets it, so a reload comes back to the level
// being played and its saved attempt, never to an old link. With storage blocked the address is
// the only memory there is, so then it follows the level being played instead.
function syncAddress(kept) {
  try {
    const u = new URL(location.href);
    const want = kept ? null : String(current + 1);
    if (u.searchParams.get('level') === want) return;
    if (want) u.searchParams.set('level', want); else u.searchParams.delete('level');
    history.replaceState(history.state, '', u.href);
  } catch { /* an address that cannot change: nothing lost but the shortcut */ }
}

// ---------- level start ----------
// `fresh` starts from scratch and forgets the level's saved attempt (the level's name, out of room
// with nothing to undo); otherwise a level left half-played comes back as it was.
function start(n, fresh = false) {
  n = Math.round(Number(n));
  n = Number.isFinite(n) ? ((n % LEVELS.length) + LEVELS.length) % LEVELS.length : 0; // the arrows wrap around
  if (att && n !== current) saveAttempt(); // the level being left is kept as it is now
  if (fresh) forgetAttempt(n);
  if (newBuild) return reloadAt(n); // a level boundary: the new version loads now (and nothing more is saved)
  gen++;
  current = n;
  syncAddress(store.set(SAVE_KEY, current) && store.get(SAVE_KEY) === String(current));
  L = buildLevel(current); // a fresh copy of the level, dealt once and kept (js/levels.js)
  const back = fresh ? null : savedAttempt(current);
  att = back instanceof R.Attempt ? back : new R.Attempt(L.board);
  clearTimeout(partyTimer);
  state = 'play'; jamClock = 0; winClock = 0; clock = 0;
  $('level-name').textContent = `Level ${current + 1}`;
  $('level-sub').textContent = LEVELS[current].name;
  showStar();
  $('ending').hidden = true;
  lessonBreak();
  showBoard();
  $('loading').hidden = true;
  if (back === 'changed') say('Level changed. Restarted.', 2500);
  else say('', 0);
}

// One small star beside the level's name once it has been cleared clean (won with no undo).
function showStar() {
  const clean = !!(cleanMask & bit(current));
  $('star').hidden = !clean;
  $('again').setAttribute('aria-label', `Restart level ${current + 1}, ${LEVELS[current].name}${clean ? ', cleared clean' : ''}`);
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
  inspecting = -1;
  lessonBreak();
  padState.length = 0;
  quietPads = true; // the pads are as they were: nobody newly parks or wakes
  boardChanged(true);
  renderPads(); renderQueues(); progress();
  fx.shots.length = 0;
  for (const f of st.flying) shotFor(f);
  showReach(); teach();
  $('undo').disabled = !att.canUndo;
}

// ---------- crew ----------
const TICK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.4 5 8.8l4.6-5.6"/></svg>';
function crewEl(s) {
  const el = document.createElement('span');
  el.className = 'crew' + (s.hidden ? ' egg' : '');
  if (!s.hidden) el.style.setProperty('--c', st.palette[s.color]);
  el.innerHTML = `<span class="body"><span class="eyes"><i></i><i></i></span><b class="n">${s.hidden ? '?' : s.count}</b></span>`;
  return el;
}
const markEl = () => Object.assign(document.createElement('i'), { className: 'fc', hidden: true });

function renderQueues() {
  const box = $('queues');
  box.innerHTML = '';
  fronts = [];
  inspecting = -1;
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
        frontEvents(slot, ci);
        el.appendChild(markEl());
        const tip = document.createElement('span');
        tip.className = 'tip';
        tip.hidden = true;
        tip.setAttribute('aria-hidden', 'true');
        slot.appendChild(tip);
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
  labelFronts(true);
}

// ---------- the whole of one line, front to back, without sending anyone ----------
// What the planning player in tools/players.mjs knows is all on the screen this way: every crew
// member in every line, a "?" as a "?", and which crew the "?" can be.
function preview(ci) {
  const col = st.columns[ci];
  if (!col?.length || (state !== 'play' && state !== 'jam')) return;
  inspect(-1);
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
  el.appendChild(markEl());
  pad.appendChild(el);
  if (fromRect) flyFrom(el, fromRect);
}

// A pad's name for a screen reader: empty, or who is on it, whether it is firing or waiting, and
// whether it will park if no more crew are sent.
function padLabel(i, awake = null, parks = 0) {
  const s = st.slots[i];
  padEls[i].setAttribute('aria-label', `Pad ${i + 1}: ` + (!s ? 'empty' : `${crewName(s)}, ${awake === false ? 'asleep, waiting for its colour' : 'firing'}${parks ? `, parks ${parks} if no more crew are sent` : ''}`));
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
  const p = padState[i];
  padLabel(i, p?.awake ?? null, p?.parks || 0);
}

function recoil(i) {
  const el = padEls[i]?.querySelector('.body');
  if (!el || el._t > performance.now() - 70) return;
  el._t = performance.now();
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1, 0.88) translateY(3px)' }, { transform: 'scale(1)' }], { duration: 90 });
}

// A screen reader hears who parks, who wakes and when a pad frees, never every shot. What happens
// close together is said as one line, set a moment after the region is emptied so a line said
// twice in a row is still read.
let srQueue = [], srTimer = 0;
function announce(text) {
  if (!srQueue.includes(text)) srQueue.push(text);
  if (srTimer) return;
  srTimer = setTimeout(() => {
    $('sr').textContent = '';
    srTimer = setTimeout(() => {
      $('sr').textContent = srQueue.join('. ');
      srQueue = []; srTimer = 0;
    }, 50);
  }, 100);
}

// ---------- what each crew member can reach, and what sending it would do ----------
// A colour can be hit when one of its cubes has nothing on top and no shot has taken it yet:
// R's st.exposed, the same test the rules fire by. A front of a line is ready (a white rim and a
// glow) when its colour can be hit, otherwise covered (plain). Both switch the moment that test
// changes (only the glow fades, css/game.css). A crew member on a pad is awake while it has
// something to hit or a shot of its own in the air; otherwise it is asleep and its pad shows it
// is waiting.
//
// What sending a front now would do (R.forecast, the rules run on a copy of the board, if no more
// crew are sent after it): it finishes and frees its pad, or it parks with N still to fire; and it
// may strand crew already on a pad, which would have finished without it and park instead. Under
// the front: a tick (finishes, strands nobody), "parks N", or "strands" (it finishes but leaves
// someone parked). In words, above the front while it is held (HOLD_MS), hovered with a mouse or
// has keyboard focus: "finishes; strands red 12" over "if no more crew are sent". A screen reader
// hears the words in the front's name. The marks show on levels 1 to 3, and on every level until
// the player has held a front once (marksShown); after that, from level 4, only the words, when
// asked. Worked out only when asked for and kept until the board changes (`rev`: a send, an undo, a
// shot leaving or landing, a crew member landing) or, while shots are in the air, the next tick
// (a send lands before or after a shot opens a cube), so what shows is right when it shows.
//
// A crew member already on a pad shows "parks N" as soon as a send has made it certain to park
// (R.fates: the board run on until nothing moves, once per send or undo, since nothing else
// changes where it is going; it is also what R.forecast compares with to find who a send strands).
let rev = 0, fcAt = '', fates = new Map();
const fcKinds = new Map(); // crew of the same colour and number fare the same
let inspecting = -1;       // the line whose front shows its forecast now, -1 when none
const marksShown = () => current <= TEACH_UNTIL || !(taught & HOLD);
const fcStamp = () => (st.flying.length ? `${rev}@${st.tick}` : `${rev}`);

function boardChanged(sent) {
  rev++;
  if (sent) fates = R.fates(st);
}
function forecastFor(ci) {
  const s = st.columns[ci]?.[0];
  if (!s || s.hidden || R.freeSlot(st) < 0) return null;
  const at = fcStamp();
  if (fcAt !== at) { fcKinds.clear(); fcAt = at; }
  const k = `${s.color}:${s.count}`;
  if (!fcKinds.has(k)) fcKinds.set(k, R.forecast(st, ci, LAND, fates));
  return fcKinds.get(k);
}
const IF_NONE = 'if no more crew are sent';
const cleanSend = f => !!f && f.finishes && !f.strands.length; // finishes and strands nobody: the tick
const fcHead = f => (!f ? 'no free pad' : (f.finishes ? 'finishes' : `parks ${f.left}`) + f.strands.map(s => `; strands ${names()[s.color]} ${s.left}`).join(''));
const fcWords = f => (!f ? 'no free pad' : `${fcHead(f)}, ${IF_NONE}`);

// The fronts' names for a screen reader, with what sending each would do. Once the marks are off
// they are brought up to date at most twice a second (and at once after a send or undo or on
// focus), so the forecasts run on demand, not on every tick.
let labelAt = '', labelMs = 0;
function labelFronts(now = false) {
  const t = performance.now();
  if (!now && (labelAt === fcStamp() || (!marksShown() && t - labelMs < 500))) return;
  labelAt = fcStamp(); labelMs = t;
  fronts.forEach((el, ci) => {
    const s = st.columns[ci]?.[0];
    if (!el || !s) return;
    const ready = st.exposed[s.color].size > 0;
    const f = forecastFor(ci);
    el.parentNode.setAttribute('aria-label', `Send ${crewName(s)}, ${ready ? 'ready' : 'covered, its colour is under other cubes'}, ${fcWords(f)}`);
  });
}

function showReach() {
  const marks = marksShown();
  fronts.forEach((el, ci) => {
    const s = st.columns[ci]?.[0];
    if (!el || !s) return;
    const ready = st.exposed[s.color].size > 0;
    const open = ci === inspecting;
    const f = marks || open ? forecastFor(ci) : undefined;
    const key = `${ready}|${f === undefined ? '' : R.forecastKey(f)}|${open}|${marks}`;
    if (el._key === key) return;
    el._key = key;
    el.classList.toggle('ready', ready);
    el.classList.toggle('covered', !ready);
    const fc = el.querySelector('.fc');
    fc.hidden = !marks || !f;
    if (!fc.hidden) {
      fc.className = cleanSend(f) ? 'fc done' : 'fc park';
      fc.innerHTML = cleanSend(f) ? TICK : f.finishes ? 'strands' : `parks ${f.left}`;
    }
    const tip = el.parentNode.querySelector('.tip');
    tip.hidden = !open;
    el.parentNode.parentNode.classList.toggle('open', open);
    if (open) {
      tip.className = `tip ${cleanSend(f) ? 'done' : 'park'}`;
      tip.innerHTML = `<b>${cleanSend(f) ? TICK : ''}${fcHead(f)}</b>${f ? `<small>${IF_NONE}</small>` : ''}`;
      tip.style.marginLeft = '0px'; // kept inside the window beside the first and last lines
      const r = tip.getBoundingClientRect();
      tip.style.marginLeft = `${Math.max(0, 6 - r.left) - Math.max(0, r.right - (innerWidth - 6))}px`;
    }
  });
  labelFronts();
  const now = performance.now();
  for (let i = 0; i < padEls.length; i++) {
    const s = st.slots[i];
    const awake = !!s && (R.canReach(st, i) || st.flying.some(f => f.id === s.id));
    const left = s ? fates.get(s.id) || 0 : 0;
    const parks = awake && left > 0 ? left : 0; // firing now, but its colour will run dry with `left` to go
    const el = padEls[i].firstChild;
    if (el) {
      el.classList.toggle('ready', awake); el.classList.toggle('asleep', !awake);
      const fc = el.querySelector('.fc');
      if (fc && fc._n !== parks) { fc._n = parks; fc.hidden = !parks; fc.className = 'fc park'; fc.textContent = `parks ${parks}`; }
    }
    padEls[i].classList.toggle('waiting', !!s && !awake);
    const was = padState[i];
    const who = s ? s.id : -1;
    if (was && was.who === who && was.awake === awake && was.parks === parks) continue;
    padState[i] = { who, awake, parks, since: was && was.who === who && was.awake === awake ? was.since : now };
    padLabel(i, awake, parks);
    if (quietPads || !s) continue;
    if (was?.who === who && was.awake !== awake) announce(awake ? `${names()[s.color]} wakes on pad ${i + 1}` : `${crewName(s)} is asleep on pad ${i + 1}, waiting for its colour`);
    else if (was?.who !== who && !awake) announce(`${crewName(s)} parks on pad ${i + 1}, waiting for its colour`);
    else if (parks && !was?.parks) announce(`${crewName(s)} on pad ${i + 1} will now park with ${parks} left`);
  }
  quietPads = false;
}

// Shows what sending line ci would do on its front (-1: on none). `hold` when a touch held it: that
// is the player using the preview, so the marks can go (HOLD). A mouse over a front or keyboard
// focus on it counts too once the words have been up HOLD_MS.
let seenTimer = 0;
function inspect(ci, hold = false) {
  if (ci >= 0 && (state !== 'play' && state !== 'jam')) ci = -1;
  clearTimeout(seenTimer);
  if (ci >= 0 && !(taught & HOLD)) {
    if (hold) learnHold();
    else seenTimer = setTimeout(() => { if (inspecting === ci) learnHold(); }, HOLD_MS);
  }
  if (ci === inspecting) return;
  inspecting = ci;
  if (st) showReach();
}
function learnHold() {
  if (taught & HOLD) return;
  learn(HOLD);
  if (st) { showReach(); teach(); }
}

// A front: a tap, a click, Enter or Space sends it at once. A touch held HOLD_MS shows its
// forecast until it lifts, and that press sends nobody; a mouse shows it while over the front, a
// keyboard while the front has focus.
let holdTimer = 0, held = false;
function frontEvents(slot, ci) {
  slot.addEventListener('pointerdown', e => {
    held = false;
    clearTimeout(holdTimer);
    if (e.pointerType === 'mouse') return;
    holdTimer = setTimeout(() => { held = true; inspect(ci, true); }, HOLD_MS);
  });
  const lift = () => {
    clearTimeout(holdTimer);
    if (held) inspect(-1);
  };
  slot.addEventListener('pointerup', lift);
  slot.addEventListener('pointercancel', lift);
  slot.addEventListener('pointerleave', e => { lift(); if (e.pointerType === 'mouse' && inspecting === ci) inspect(-1); });
  slot.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') inspect(ci); });
  slot.addEventListener('focus', () => { labelFronts(true); if (slot.matches(':focus-visible')) inspect(ci); });
  slot.addEventListener('blur', () => { if (inspecting === ci) inspect(-1); });
  slot.addEventListener('contextmenu', e => e.preventDefault()); // a long press is an inspection, not a menu
  slot.addEventListener('click', e => {
    if (held && e.detail !== 0) { held = false; return; } // the end of a hold: it only looked
    held = false;
    onSend(ci);
  });
}

// ---------- the lessons, one line at a time ----------
// "Tap the front crew" on levels 1 to 3, until a crew member has been sent. On level 1, just after
// that, what the tick means, for LESSON_MS. On any level, the first time a crew member sleeps on a
// pad (for half a second, not just between two shots), what that means, until that crew member
// wakes (seen by the rules: it fires a shot) and it has been on screen at least LESSON_MS. And from
// level 4, "Hold a front crew to preview. Tap to send." until the player has held a front once
// (inspect): then the marks under the fronts go too. Only time on screen counts toward LESSON_MS:
// not while the line is hidden (out of room, a win, the page in the background, a message over it).
// A lesson that has been on screen LESSON_MS counts as seen even when an undo or a restart cuts it
// short. The browser remembers each (TAUGHT_KEY).
const SENT = 1, PARK = 2, TICK_SEEN = 4, HOLD = 8;
const HINT_SEND = 'Tap the front crew';
const HINT_TICK = `${TICK} it finishes and frees its pad, ${IF_NONE}`;
const HINT_PARK = 'Sleeping crew keep a pad. Clear the cubes above their colour.';
const HINT_HOLD = 'Hold a front crew to preview. Tap to send.';
const LESSON_MS = 2500;
let taught = Number(store.get(TAUGHT_KEY)) || 0;
if (taught === 2) taught = SENT | PARK; // the old count: 2 meant both lessons seen
let tickShown = -1;   // ms the tick lesson has been on screen, -1 while it has not come up
let lesson = null;    // the parking lesson: { id of its sleeper, ms on screen, whether it has woken }
let hintOn = 0;       // when the line on screen was last counted, 0 while none is on screen
function learn(what) { taught |= what; store.set(TAUGHT_KEY, taught); }
// Adds the time the lesson line has been on screen since it was last counted to that lesson.
function countHint(now) {
  if (!hintOn) return;
  const text = $('hint')._text;
  if (text === HINT_TICK && tickShown >= 0) tickShown += now - hintOn;
  if (text === HINT_PARK && lesson) lesson.shown += now - hintOn;
  hintOn = now;
}
function lessonBreak() {
  countHint(performance.now());
  hintOn = 0;
  if (lesson && lesson.shown >= LESSON_MS) learn(PARK);
  if (tickShown >= LESSON_MS) learn(TICK_SEEN);
  lesson = null; tickShown = -1;
}
function teach() {
  let text = '';
  const now = performance.now();
  countHint(now);
  if (state === 'play') {
    if (current <= TEACH_UNTIL && !(taught & SENT) && !att.sends.length) text = HINT_SEND;
    else if (current === 0 && (taught & SENT) && !(taught & TICK_SEEN)) {
      if (tickShown < 0) tickShown = 0;
      if (tickShown < LESSON_MS) text = HINT_TICK;
      else { learn(TICK_SEEN); tickShown = -1; }
    }
    if (!text && !(taught & PARK)) {
      if (!lesson) {
        const p = padState.find(p => p && p.who >= 0 && !p.awake && now - p.since >= 500);
        if (p) lesson = { id: p.who, shown: 0, woke: false };
      }
      if (lesson && lesson.woke && lesson.shown >= LESSON_MS) { learn(PARK); lesson = null; }
      if (lesson) text = HINT_PARK;
    }
    if (!text && current > TEACH_UNTIL && !(taught & HOLD)) text = HINT_HOLD;
  }
  const h = $('hint');
  if (h._text !== text) { h._text = text; h.innerHTML = text; }
  h.hidden = !text || !$('banner').hidden; // a message ("Level changed. Restarted.") goes first
  hintOn = !h.hidden && document.visibilityState === 'visible' ? now : 0;
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
  if (!(taught & SENT)) learn(SENT);
  boardChanged(true);
  saveAttempt();
  $('undo').disabled = false;
  renderQueues();
  renderPad(res.slot, from);
  if (res.revealed) {
    sound.reveal();
    const el = $('queues').children[ci].querySelector('.crew');
    el?.animate([{ transform: 'rotateY(90deg) scale(0.8)' }, { transform: 'rotateY(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }
  showReach(); teach();
  if (keyboard) $('queues').children[ci].querySelector('button')?.focus({ preventScroll: true });
}

// ---------- undo: the board as it was just before the last send ----------
function undo() {
  if ((state !== 'play' && state !== 'jam') || !att.canUndo) return;
  sound.unlock();
  att.undo(); // counts it: a win after this is not a clean clear
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
// Before every tick R.pace() says how fast it runs: R.FAST times as fast while there is nothing to
// send (every pad taken, or every line empty) or nobody has touched the screen or a key for
// R.IDLE_MS, back to 1x the moment a finger goes down (and while it stays down), and never faster
// than 1x while a crew member is still landing on its pad. The test players keep the same clock
// (tools/players.mjs).
function tick(dt) {
  let left = dt; // real seconds of this frame still to run
  const still = !pressed.size;
  for (;;) {
    speed = R.pace(st, still ? quiet * 1000 : 0);
    const need = (FIRE_GAP - clock) / speed; // real seconds until the next tick
    if (left < need) { clock += left * speed; quiet += left; break; }
    left -= need; quiet += need; clock = 0;
    const landing = st.slots.some(s => s && s.land > 0);
    const { landed, shots, gone } = R.tickGame(st);
    for (const shot of shots) launch(shot);
    if (landed.length) afterHit(landed, gone);
    // What a send would do changes when a shot leaves or lands or a crew member lands (and, while
    // shots fly, with every tick: forecastFor keys on it).
    if (landed.length || shots.length || gone.length || landing) boardChanged(false);
  }
  showReach();
  teach();
  if (R.isWon(st)) {
    if (!fx.busy) { winClock += dt; if (winClock > 0.25) win(); }
    return;
  }
  if (R.isJammed(st) && !fx.busy) { jamClock += dt; if (jamClock > 0.8) jam(); } else jamClock = 0;
}

// A shot in the air, drawn from its record in the rules: from its pad to its cube, as far along as
// the rules' clock says, so the dot reaches the cube on the tick the rules land it. Its cube starts
// to flash just before.
function shotFor(f) {
  const r = padEls[f.slot].getBoundingClientRect();
  const b = st, g = gen;
  fx.shoot(r.left + r.width / 2, r.top + 6, st.palette[f.color], () => stage.screen(f.cell),
    () => (g !== gen ? 1 : (b.tick + clock / FIRE_GAP - f.from) / (f.at - f.from)),
    () => { if (g === gen) stage.flash(f.cell); });
}

// A shot has left a pad for its cube. The cube is taken now and goes when the rules land the shot.
// A crew member that was asleep on that pad has woken (the rules say so, whatever a frame saw).
function launch({ slot, shooter, freed, flight }) {
  shotFor(flight);
  const p = padState[slot];
  if (p && p.who === shooter.id && !p.awake) {
    padState[slot] = { ...p, awake: true, since: performance.now() };
    announce(`${names()[shooter.color]} wakes on pad ${slot + 1}`);
  }
  if (lesson && lesson.id === shooter.id) lesson.woke = true;
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

// Won: confetti, then the next level by itself. A win with no undo in this attempt is a clean
// clear: the banner says so and the level keeps a star. The ending comes after the last level,
// and as soon as every level has been won, whichever was the last one missing.
function win() {
  state = 'won';
  const clean = att.undos === 0;
  $('undo').disabled = true;
  closePreview(); inspect(-1); teach();
  forgetAttempt(current);
  clearedMask |= bit(current);
  store.set(CLEARED_KEY, clearedMask);
  if (clean) { cleanMask |= bit(current); store.set(CLEAN_KEY, cleanMask); showStar(); }
  stage.finale(); fx.party(); buzz.tick(0);
  if (current === LAST || (clearedMask & ALL) === ALL) return ending();
  store.set(SAVE_KEY, current + 1); // a page stopped during the confetti comes back on the next level
  sound.win();
  say(`${LEVELS[current].name} popped!${clean ? ' Clean clear' : ''}`, 0);
  const g = gen;
  setTimeout(() => { if (g === gen) start(current + 1); }, NEXT_AFTER);
}

// The ending stays, with confetti now and then, until a tap starts level 1. It says "All 20
// cleared", and counts one more full clear, when every level has been won since the last full
// clear; reaching level 20 without that (the arrows, the address) is "Level 20 cleared". Under it,
// how many levels have their clean-clear star ("7 of 20 clean clears"), or "All 20 clean" once
// every one has.
function ending() {
  state = 'done';
  const full = (clearedMask & ALL) === ALL;
  if (full) {
    allCleared++;
    store.set(DONE_KEY, allCleared);
    clearedMask = 0;
    store.set(CLEARED_KEY, 0);
  }
  store.set(SAVE_KEY, 0);
  sound.allClear();
  say('', 0);
  $('ending-title').textContent = full ? `All ${LEVELS.length} cleared` : `Level ${LEVELS.length} cleared`;
  const stars = LEVELS.filter((_, n) => cleanMask & bit(n)).length;
  $('ending-sub').textContent = `${stars === LEVELS.length ? `All ${stars} clean` : `${stars} of ${LEVELS.length} clean clears`}. Tap to play again`;
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
  closePreview(); inspect(-1); teach();
  padEls.forEach(p => p.classList.add('stuck'));
  saveAttempt();
  say(att.canUndo ? 'Out of room. Tap to undo your last send.' : 'Out of room. Tap to try again.', 0);
}

// The tap after running out of room, on the ending, or with a line's preview open, anywhere but
// the top bar (a preview closes on any tap, the top bar's too). It is taken before any button
// under the finger sees it, so it never also sends a crew member. Out of room, a tap behind the
// front of a line still opens that line, to look before undoing. The end of a touch held on a
// front only looked, so it does nothing here either. Only a real tap or key counts: the haptic
// switch's own click (js/audio.js) is not one.
window.addEventListener('click', e => {
  if (!e.isTrusted) return;
  if (held && e.detail !== 0) {
    held = false;
    e.stopPropagation(); e.preventDefault();
    return;
  }
  if (previewOf >= 0) {
    e.stopPropagation(); e.preventDefault();
    closePreview();
    return;
  }
  if (state !== 'jam' && state !== 'done') return;
  if (e.target instanceof Element && e.target.closest('.top')) return;
  if (state === 'jam' && e.target instanceof Element && e.target.closest('#queues .rear')) return;
  if (e.target === $('gl') && dragged > 8) return; // turning the sculpture is not a tap
  e.stopPropagation(); e.preventDefault();
  if (state === 'done') start(0);
  else if (att.canUndo) undo();
  else start(current, true);
}, true);
window.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });
// Every new press starts clean: a hold whose click never came (some browsers drop it after a long
// press) must not swallow the next tap, wherever it lands. Every press, lift and key is also the
// player moving, which brings the ticks back to 1x (R.pace): while a finger is down they stay there.
window.addEventListener('pointerdown', e => { held = false; pressed.add(e.pointerId); quiet = 0; }, true);
const lifted = e => { pressed.delete(e.pointerId); quiet = 0; };
window.addEventListener('pointerup', lifted, true);
window.addEventListener('pointercancel', lifted, true);
window.addEventListener('keydown', () => { quiet = 0; }, true);
window.addEventListener('blur', () => pressed.clear()); // a lift that will never come

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
// On a fresh load, when the page comes back into view, and when the iPhone app comes back to the
// front (ios-app/App.js), it asks for the live page and compares its build with its own. When
// there is a new one, every file of it is fetched again first; only when every one came back whole
// does the new version load, and only at a level boundary: a level with nothing sent or undone,
// the start of another level, or the ending. Otherwise it keeps playing this version and tries
// again next time. A level left half-played is kept (saveAttempt) and checked against the new
// version when it comes back.
const FRESH = ['css/game.css', 'js/main.js', 'js/render.js', 'js/fx.js', 'js/audio.js', 'js/levels.js', 'js/logic.js', 'js/models.js',
  'vendor/three.module.js', 'vendor/three.core.js', 'vendor/RoundedBoxGeometry.js'];
let checking = false;
// The version the page last reloaded to load, and when: "abc1234@1762850000000".
const lastReload = () => { const [build, at] = String(store.get(UPDATE_KEY) || '').split('@'); return { build, at: Number(at) || 0 }; };
if (lastReload().build === BUILD) store.remove(UPDATE_KEY); // that reload worked
async function checkForUpdate() {
  if (BUILD === 'dev' || newBuild || checking) return;
  checking = true;
  try {
    const page = await fetch(location.pathname, { cache: 'reload' });
    if (!page.ok) return;
    const live = /<meta name="build" content="([^"]*)"/.exec(await page.text())?.[1];
    if (!live || live === BUILD || live === 'dev') return;
    // The page reloaded for this version under a minute ago and still came back old: give the cache
    // time to let go, then try again (the next check after that, at a level boundary as always).
    const was = lastReload();
    if (was.build === live && Math.abs(Date.now() - was.at) < RETRY_MS) return;
    const got = await Promise.all(FRESH.map(f => fetch(f, { cache: 'reload' }).then(r => r.ok && r.arrayBuffer().then(() => true), () => false)));
    if (!got.every(Boolean)) return; // a file did not come: no mix of old and new, try again later
    newBuild = live;
    if (state === 'done') reloadAt(0);
    else if (state === 'play' && !att.sends.length && !att.undos) reloadAt(current);
  } catch { /* offline: next time */ } finally { checking = false; }
}
// The page is left for the new version: from here on nothing plays and nothing is saved, so a
// restart that has just forgotten its attempt is not saved again as the page goes.
function reloadAt(n) {
  state = 'gone';
  store.set(SAVE_KEY, n);
  store.set(UPDATE_KEY, `${newBuild}@${Date.now()}`);
  const u = new URL(location.href);
  u.searchParams.delete('level'); // the saved level decides, so a page iOS stops later comes back right
  if (store.get(SAVE_KEY) !== String(n)) u.searchParams.set('level', n + 1); // storage blocked
  location.replace(u.href);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
  else { saveAttempt(); pressed.clear(); if (st) teach(); } // iOS may stop the page from here on: keep the board as it is; a lesson stops counting
});
window.addEventListener('pagehide', () => saveAttempt());
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
$('again').addEventListener('click', () => start(current, true));
window.addEventListener('resize', () => { stage.resize(); fx.resize(); closePreview(); });
new ResizeObserver(() => stage.resize()).observe($('stage'));

start(current); // a level left half-played comes back where it was
requestAnimationFrame(frame);
// A fresh load can come from an old copy in the cache (after iOS stopped the page, say). Only with
// storage working: it is what stops a reload that keeps coming back old from trying again.
if (store.get(SAVE_KEY) === String(current)) setTimeout(checkForUpdate, 1500);

// For the automated checks: a small window onto the game. state is 'play', 'won', 'jam', 'done'
// (the ending) or 'gone' (a new version is loading); allCleared is how many times every level was
// cleared. sends is how many sends there are to take back, undos how many were taken back in this
// attempt, clean whether this level has been cleared clean, speed 1 or R.FAST (R.pace).
// snapshot() is the board in plain text, drawn what the screen draws (shots in the air, cubes
// standing). start(n) starts level n from scratch (as the level's name does); send(line) and
// undo() are the player's two moves.
function snapshot() {
  return {
    state, level: current, tick: st.tick, cleared: st.cleared, hash: `${st.h1},${st.h2}`,
    lines: st.columns.map(c => c.map(x => `${x.color}:${x.count}${x.hidden ? '?' : ''}`).join(' ')).join(' | '),
    pads: st.slots.map(x => (x ? `${x.color}:${x.count}${x.land > 0 ? `+${x.land}` : ''}` : '_')).join(' '),
    flying: st.flying.map(f => `${f.cell}@${f.at}`).join(' '),
    sends: att.sends.length, undos: att.undos,
  };
}
window.crumble = {
  get state() { return state; }, get board() { return st; }, get level() { return current; },
  get allCleared() { return allCleared; },
  get sends() { return att.sends.length; }, get undos() { return att.undos; },
  get clean() { return !!(cleanMask & bit(current)); }, get speed() { return speed; },
  get drawn() { return { shots: fx.shots.length, cubes: stage.shown }; },
  snapshot,
  start: n => start(n, true), send: onSend, undo, checkForUpdate,
};
