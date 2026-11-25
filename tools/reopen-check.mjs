// Reopened after a minute or more away, before the first touch, the game loads the new
// version, even in the middle of a level, and the level comes back as it was left (11nov).
// Run: serve the repo (python3 -m http.server 8137), then node tools/reopen-check.mjs http://127.0.0.1:8137/
// Playwright comes from the repo's own node_modules (npm i --no-save playwright), else from ~/code.
// Serves the branch at BASE; the page's build mark is rewritten per request: the document the
// browser loads says `doc`, the live page the game checks says `live`. "Away" is made by holding the
// page's frames (requestAnimationFrame) and moving its clock (Date.now) on; "hidden" and "visible"
// by the page's visibility events, as iOS sends them.
// Cases: A. away 61 s, hidden then visible: reloads into the new version, level as left.
//        B. frames held 61 s with no visibility event (iOS froze the app): the same.
//        C. away 10 s: keeps the old version mid-level; "Start it again" (a level boundary) loads it.
//        D. away 61 s but touched before the check came back: keeps the old version.
//        E. a fresh load from an old copy, half-played level, untouched: loads the new version, level as left.
//        F. left with crew still landing and shots in the air: comes back at that very tick, every shot and pad as left.
//        G. left out of room: comes back out of room, and a tap on undo takes back the last send.
//        H. the new version changed that level: it starts again, whole, and says "Level changed. Restarted."
//        I. the new version was found while playing (a short look away), then away 61 s: loads it on coming back.
//        J. played by keyboard only (Enter on a front): a short look away that finds the new version keeps the old one mid-level.
//        K. touched after the page showed but before its first frame (and, with no visibility event, before its first frame): keeps it.
//        L. a check still out from before the away (no answer yet): the reopen's own check still runs, and loads it.
//        M. offline as it comes back, with the new version found before: no reload, the level plays on.
//        N. storage full at the reopen: no reload, the level plays on as left.
//        O. storage blocked: the arrows (a level boundary) do not reload while a level left half-played lives only in memory.
//        P. stars, clean clears and cleared marks won on a level that has changed since go; the rest stay.
//        Q. a level won for real keeps its marks after a reload (the next one deals no level to check them), and in
//           a new version with only the rules' version up.
//        R. the ending, with the new version found before: offline on coming back, no reload; online the next time, it loads.
//        S. another version went live after the new one was found: on coming back the newest one loads.
//        T. a mouse hovering a front before the check came back counts as a touch: keeps the old version.
//        U. offline as it comes back, online again before a touch: the check is tried again and loads it.
import { createRequire } from 'node:module';
const playwright = from => createRequire(from)('playwright');
let chromium;
try { ({ chromium } = playwright(new URL('../package.json', import.meta.url))); } catch { ({ chromium } = playwright(process.env.HOME + '/code/package.json')); }
const BASE = process.argv[2] || 'http://127.0.0.1:8137/';
const browser = await chromium.launch();
let bad = 0;
const ok = (c, what) => { console.log(c ? 'ok ' : 'BAD', what); if (!c) bad++; };

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const s = { doc: 'aaa1111', live: 'aaa1111', docs: 0, delay: 0, hang: 0, offline: false, served: '', errors: [] };
  page.on('pageerror', e => s.errors.push(String(e.message)));
  const home = new URL(BASE).pathname; // the game's own address, '/' or '/voxel-pop/'
  await page.route(u => u.pathname === home || u.pathname === home + 'index.html', async route => {
    const isDoc = route.request().resourceType() === 'document';
    if (s.offline) { if (isDoc) s.docs++; return route.abort('internetdisconnected'); }
    const r = await route.fetch();
    const mark = isDoc ? s.doc : s.live;
    const html = (await r.text()).replace('name="build" content="dev"', `name="build" content="${mark}"`);
    if (isDoc) { s.docs++; s.served = mark; if (s.afterDoc) { s.doc = s.afterDoc; s.afterDoc = null; } }
    else if (s.delay) await new Promise(res => setTimeout(res, s.delay));
    else if (s.hang) { const ms = s.hang; s.hang = 0; await new Promise(res => setTimeout(res, ms)); } // this one ask gets no answer for that long
    try { await route.fulfill({ response: r, body: html, headers: { ...r.headers(), 'cache-control': 'no-store' } }); } catch { /* given up on, or the page is gone */ }
  });
  await page.route(u => u.pathname.endsWith('/js/levels.js'), async route => {
    const r = await route.fetch();
    let js = await r.text();
    if (s.changeLevel2) js += "\nLEVELS[1].name += ', changed'; LEVELS[1].pads += 1;\n"; // the new version changed level 2 (its play, not only its name)
    if (s.countDeals) js = js.replace('export function dealLevel(def) {', '$& globalThis.__dealt = (globalThis.__dealt || 0) + 1;'); // how many levels this page dealt
    await route.fulfill({ response: r, body: js, headers: { ...r.headers(), 'cache-control': 'no-store' } });
  });
  return { ctx, page, s };
}
const loaded = page => page.waitForFunction(() => window.crumble && document.getElementById('loading').hidden, null, { timeout: 30000 });
const build = page => page.evaluate(() => document.querySelector('meta[name="build"]').content);
const snap = page => page.evaluate(() => { const x = window.crumble.snapshot(); return { state: x.state, level: x.level, cleared: x.cleared, hash: x.hash, lines: x.lines, pads: String(x.pads).replace(/\+\d+/g, ''), flying: x.flying, sends: x.sends, undos: x.undos }; });
const quiet = page => page.evaluate(() => { const st = window.crumble.board; return !st.flying.length && st.slots.every(s => !s || (!(s.land > 0) && st.exposed[s.color].size === 0)); });
// `keys`: by keyboard only, focus on the front and Enter, no pointer at all.
async function sendTwo(page, keys = false) {
  for (let k = 0; k < 2; k++) {
    const i = await page.evaluate(() => {
      const st = window.crumble.board;
      const lines = st.columns.map((c, i) => (c.length ? i : -1)).filter(i => i >= 0);
      return lines.find(i => st.exposed[st.columns[i][0].color].size > 0) ?? lines[0];
    });
    const front = page.locator('#queues .col').nth(i).locator('button.front');
    if (keys) { await front.focus({ timeout: 20000 }); await page.keyboard.press('Enter'); } else await front.click({ timeout: 20000 });
    await page.waitForTimeout(250);
  }
  const end = Date.now() + 30000;
  while (!(await quiet(page))) { if (Date.now() > end) throw new Error('board did not settle'); await page.waitForTimeout(200); }
}
// Hold the frames, move the clock on by `ms`, and optionally send hidden then visible.
const holdFrames = page => page.evaluate(() => { window.__raf = window.requestAnimationFrame; window.__held = []; window.requestAnimationFrame = cb => { window.__held.push(cb); return 0; }; });
const freeFrames = page => page.evaluate(() => { window.requestAnimationFrame = window.__raf; window.__held.forEach(cb => window.__raf(cb)); });
const shiftClock = (page, ms) => page.evaluate(ms => { const real = Date.now.bind(Date); Date.now = () => real() + ms; }, ms);
const turn = async page => { // a touch: a turn of the sculpture
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
};
const blockStorage = () => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; };
const vis = (page, v) => page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }, v);
async function reloadedTo(page, s, docsBefore, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (s.docs > docsBefore) { // counted as it is asked for: wait for that document itself, not the one going
      await page.waitForFunction(b => document.querySelector('meta[name="build"]')?.content === b && window.crumble && document.getElementById('loading').hidden, s.served, { timeout: 30000, polling: 100 }); // the page going may have its frames held
      await page.waitForTimeout(400); return true;
    }
    await page.waitForTimeout(100);
  }
  return false;
}

// Plays the level open now to its win by the careful rule (verify/journeys.ts): the first line whose
// front can hit a cube; with none and nothing moving, the first line.
async function winLevel(page) {
  const n = await page.evaluate(() => window.crumble.level);
  const end = Date.now() + 150000;
  while (Date.now() < end) {
    const g = await page.evaluate(() => ({ state: window.crumble.state, level: window.crumble.level }));
    if (g.state === 'won' || g.state === 'done' || g.level !== n) return;
    if (g.state !== 'play') throw new Error(`level ${n + 1} is ${g.state}, not won`);
    const i = await page.evaluate(() => {
      const st = window.crumble.board;
      if (st.slots.every(x => x)) return -1;
      const lines = st.columns.map((c, i) => (c.length ? i : -1)).filter(i => i >= 0);
      const pick = lines.find(i => st.exposed[st.columns[i][0].color].size > 0);
      if (pick !== undefined) return pick;
      const still = !st.flying.length && st.slots.every(x => !x || st.exposed[x.color].size === 0);
      return still && lines.length ? lines[0] : -1;
    });
    if (i >= 0) await page.locator('#queues .col').nth(i).locator('button.front').click({ timeout: 20000 });
    await page.waitForTimeout(i >= 0 ? 150 : 250);
  }
  throw new Error(`level ${n + 1} was not won in 150 s`);
}
// Every level's shape as the page's own levels.js works it out (`skip`: those left null).
const shapesNow = (page, skip = -1) => page.evaluate(async skip => {
  const { levelShape } = await import(new URL('js/levels.js', location.href).href);
  return Array.from({ length: 20 }, (_, n) => (n === skip ? null : levelShape(n)));
}, skip);

// A reload while the check after coming back runs to its end: until it has found the new version
// (every file fetched again), then the live page's next answer (s.delay) and 3 s more. A broken touch
// guard would reload within that. null when the check never found the new version.
async function reloadedByCheck(page, s, docsBefore) {
  const found = await page.waitForFunction(() => window.crumble.newBuild, null, { timeout: 30000, polling: 100 }).then(() => true, () => s.docs > docsBefore);
  return found ? reloadedTo(page, s, docsBefore, s.delay + 3000) : null;
}
const keptSay = re => (re ? 'reloaded' : re === null ? 'the check never found the new version' : 'kept');

// A level just begun: one crew member sent, still on its way; then the live page has the new version.
async function begun() {
  const o = await open();
  await o.page.goto(BASE + '?level=2');
  await loaded(o.page); await o.page.waitForTimeout(1800); // the load's own check finds nothing new
  await o.page.locator('#queues .col button.front').first().click({ timeout: 20000 });
  o.s.live = 'bbb2222'; o.s.doc = 'bbb2222';
  return o;
}

async function half(level = 2, { keys = false, init = null } = {}) {
  const o = await open();
  if (init) await o.ctx.addInitScript(init);
  await o.page.goto(BASE + '?level=' + level);
  await loaded(o.page); await o.page.waitForTimeout(1800); // the load's own check finds nothing new
  await sendTwo(o.page, keys);
  o.was = await snap(o.page);
  o.s.live = 'bbb2222'; o.s.doc = 'bbb2222';
  return o;
}

{ // A
  const { ctx, page, s, was } = await half();
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  const re = await reloadedTo(page, s, d);
  const now = re && await snap(page);
  ok(re && (await build(page)) === 'bbb2222', `A. away 61 s, hidden then visible: reloaded into the new version (${re ? await build(page) : 'no reload'})`);
  ok(re && JSON.stringify(now) === JSON.stringify(was), `A. the level came back as left: ${re ? (JSON.stringify(now) === JSON.stringify(was) ? `level ${now.level + 1}, ${now.sends} sends, ${now.cleared} cubes gone` : `was ${JSON.stringify(was)} now ${JSON.stringify(now)}`) : ''}`);
  ok(!s.errors.length, 'A. no page errors ' + s.errors.join(' | '));
  await ctx.close();
}
{ // B
  const { ctx, page, s, was } = await half();
  const d = s.docs;
  await holdFrames(page); await shiftClock(page, 61000); await freeFrames(page);
  const re = await reloadedTo(page, s, d);
  const now = re && await snap(page);
  ok(re && (await build(page)) === 'bbb2222' && JSON.stringify(now) === JSON.stringify(was), `B. frames held 61 s, no visibility event: reloaded, level as left (${re ? 'reloaded' : 'no reload'})`);
  await ctx.close();
}
{ // C
  const { ctx, page, s, was } = await half();
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 10000); await vis(page, 'visible'); await freeFrames(page);
  const re = await reloadedTo(page, s, d, 4000);
  ok(!re && (await build(page)) === 'aaa1111', `C. away 10 s: kept the old version mid-level (${re ? 'reloaded' : 'kept'})`);
  const now = await snap(page);
  ok(JSON.stringify(now) === JSON.stringify(was), 'C. the level is untouched');
  const d2 = s.docs;
  await page.locator('#again').click({ timeout: 20000 });
  const re2 = await reloadedTo(page, s, d2);
  ok(re2 && (await build(page)) === 'bbb2222', `C. "Start it again" loaded the new version (${re2 ? await build(page) : 'no reload'})`);
  await ctx.close();
}
{ // D
  const { ctx, page, s, was } = await half();
  const d = s.docs;
  s.delay = 2500;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible'); await freeFrames(page);
  await page.waitForTimeout(300);
  await turn(page); // a touch while the check is out
  const re = await reloadedByCheck(page, s, d);
  ok(re === false && (await build(page)) === 'aaa1111', `D. touched before the check came back: kept the old version (${keptSay(re)})`);
  const now = await snap(page);
  ok(now.sends === was.sends && now.state === 'play', `D. still mid-level, ${now.sends} sends`);
  const d3 = s.docs;
  await page.locator('#again').click({ timeout: 20000 });
  ok(await reloadedTo(page, s, d3), 'D. and the next level boundary loaded it');
  await ctx.close();
}
{ // E
  const { ctx, page, s, was } = await half();
  s.doc = 'aaa1111'; s.afterDoc = 'bbb2222'; // the next load comes from an old copy, the one after it is new
  const d = s.docs;
  await page.reload(); await loaded(page);
  const re = await reloadedTo(page, s, d + 1, 8000);
  const now = re && await snap(page);
  ok(re && (await build(page)) === 'bbb2222' && JSON.stringify(now) === JSON.stringify(was), `E. fresh load from an old copy, untouched: reloaded into the new version, level as left (${re ? `${await build(page)}, ${JSON.stringify(now) === JSON.stringify(was) ? 'as left' : 'differs'}` : 'no reload'})`);
  await ctx.close();
}
{ // F
  const { ctx, page, s } = await open();
  await page.goto(BASE + '?level=2');
  await loaded(page); await page.waitForTimeout(1800);
  for (let k = 0; k < 2; k++) { // two crew up, and away at once, before they settle
    const i = await page.evaluate(() => { const st = window.crumble.board; const lines = st.columns.map((c, i) => (c.length ? i : -1)).filter(i => i >= 0); return lines.find(i => st.exposed[st.columns[i][0].color].size > 0) ?? lines[0]; });
    await page.locator('#queues .col').nth(i).locator('button.front').click({ timeout: 20000 });
    await page.waitForTimeout(k ? 400 : 150);
  }
  await holdFrames(page);
  await page.evaluate(() => new Promise(r => window.__raf(() => window.__raf(r)))); // the frame the game asked for before the hold runs first
  const was = await page.evaluate(() => window.crumble.snapshot());
  const moving = (was.flying && was.flying.length) || /\+\d/.test(String(was.pads));
  s.live = 'bbb2222'; s.doc = 'bbb2222';
  await ctx.addInitScript(() => { window.__held = []; window.requestAnimationFrame = cb => { window.__held.push(cb); return 0; }; }); // the new page starts with its frames held too
  const d = s.docs;
  await vis(page, 'hidden'); await shiftClock(page, 61000); await vis(page, 'visible');
  const end = Date.now() + 8000;
  while (s.docs === d && Date.now() < end) await page.waitForTimeout(100);
  await page.waitForFunction(() => window.crumble && window.crumble.board, null, { timeout: 30000, polling: 100 }); // its frames are held: no polling by frame
  const now = await page.evaluate(() => window.crumble.snapshot());
  const diff = Object.keys(was).filter(k => JSON.stringify(was[k]) !== JSON.stringify(now[k]));
  ok(moving, `F. left while crew were still moving (shots in the air: ${String(was.flying || '') || 'none'}; pads ${was.pads})`);
  ok(s.docs > d && (await build(page)) === 'bbb2222' && !diff.length, `F. came back at the same tick ${was.tick}, every shot and pad as left${diff.length ? ': differs in ' + diff.map(k => `${k} ${JSON.stringify(was[k])} -> ${JSON.stringify(now[k])}`).join('; ') : ''}`);
  ok(!s.errors.length, 'F. no page errors ' + s.errors.join(' | '));
  await ctx.close();
}
{ // G
  const { ctx, page, s } = await open();
  await page.goto(BASE + '?level=11');
  await loaded(page); await page.waitForTimeout(1800);
  // A level that can be filled with buried crew from the start (out-of-room journey, verify/journeys.ts)
  let jammed = 0;
  for (const n of [11, ...Array.from({ length: 20 }, (_, k) => k + 1).filter(k => k !== 11)]) {
    await page.evaluate(n => window.crumble.start(n - 1), n); await page.waitForTimeout(300);
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const b = await page.evaluate(() => { const g = window.crumble, st = g.board; return { s: g.state, cleared: st.cleared, free: st.slots.filter(x => !x).length }; });
      if (b.s === 'jam') { jammed = n; break; }
      if (b.cleared > 0) break;
      const i = await page.evaluate(() => { const st = window.crumble.board; if (st.slots.every(x => x)) return -1; return st.columns.findIndex(c => c.length && st.exposed[c[0].color].size === 0); });
      if (i >= 0) { await page.locator('#queues .col').nth(i).locator('button.front').click({ timeout: 20000 }); await page.waitForTimeout(250); }
      else if (!b.free) await page.waitForTimeout(300);
      else break;
    }
    if (jammed) break;
  }
  ok(jammed, `G. level ${jammed} ran out of room with buried crew`);
  const was = await snap(page);
  s.live = 'bbb2222'; s.doc = 'bbb2222';
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  const re = await reloadedTo(page, s, d);
  let st = re && await page.evaluate(() => window.crumble.state);
  const until = Date.now() + 3000;
  while (re && st !== 'jam' && Date.now() < until) { await page.waitForTimeout(150); st = await page.evaluate(() => window.crumble.state); }
  const now = re && await snap(page);
  const same = re && ['level', 'cleared', 'hash', 'lines', 'pads', 'sends', 'undos'].every(k => JSON.stringify(now[k]) === JSON.stringify(was[k]));
  ok(re && (await build(page)) === 'bbb2222' && st === 'jam' && same, `G. reloaded into the new version still out of room, as left (${re ? `state ${st}, ${now.sends} sends${same ? '' : ', board differs'}` : 'no reload'})`);
  if (re) {
    await page.locator('#undo').click({ timeout: 20000 }); await page.waitForTimeout(300);
    const back = await snap(page);
    ok(back.sends === was.sends - 1 && back.undos === was.undos + 1, `G. undo took back the last send (${back.sends} sends, ${back.undos} undos)`);
  }
  await ctx.close();
}
{ // H
  const { ctx, page, s, was } = await half();
  s.changeLevel2 = true;
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  const re = await reloadedTo(page, s, d);
  const now = re && await snap(page);
  const said = re && await page.evaluate(() => document.getElementById('banner').textContent + ' | ' + document.getElementById('level-sub').textContent);
  ok(re && (await build(page)) === 'bbb2222' && now.level === was.level && now.sends === 0 && now.undos === 0 && now.cleared === 0 && now.state === 'play',
    `H. the changed level started again, whole (${re ? `level ${now.level + 1}, ${now.sends} sends, ${now.cleared} cubes gone` : 'no reload'})`);
  ok(re && /Level changed\. Restarted\./.test(said) && /changed/.test(said.split(' | ')[1]), `H. it said so, in the new version (${said})`);
  ok(!s.errors.length, 'H. no page errors ' + s.errors.join(' | '));
  await ctx.close();
}
{ // I
  const { ctx, page, s, was } = await half();
  let d = s.docs;
  await vis(page, 'hidden'); await shiftClock(page, 5000); await vis(page, 'visible'); // a short look away finds the new version
  const early = await reloadedTo(page, s, d, 4000);
  ok(!early && (await build(page)) === 'aaa1111', `I. a short look away mid-level found the new version and kept playing the old one (${early ? 'reloaded' : 'kept'})`);
  d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  const re = await reloadedTo(page, s, d);
  const now = re && await snap(page);
  ok(re && (await build(page)) === 'bbb2222' && JSON.stringify(now) === JSON.stringify(was), `I. then away 61 s: on coming back it loaded the new version, level as left (${re ? 'reloaded' : 'no reload'})`);
  await ctx.close();
}
{ // J
  const { ctx, page, s, was } = await half(2, { keys: true });
  const d = s.docs;
  await vis(page, 'hidden'); await shiftClock(page, 5000); await vis(page, 'visible'); // a short look away finds the new version
  const re = await reloadedTo(page, s, d, 4000);
  const now = await snap(page);
  ok(!re && (await build(page)) === 'aaa1111' && now.sends === was.sends && now.state === 'play', `J. played by keyboard only: kept the old version mid-level (${re ? 'reloaded' : `kept, ${now.sends} sends`})`);
  await ctx.close();
}
{ // K
  for (const shown of [true, false]) {
    const { ctx, page, s } = await half();
    const d = s.docs;
    s.delay = 2500;
    if (shown) await vis(page, 'hidden');
    await holdFrames(page); await shiftClock(page, 61000);
    if (shown) await vis(page, 'visible'); // the check goes out
    await turn(page); // a touch before the first frame since coming back
    await freeFrames(page);
    const re = await reloadedByCheck(page, s, d);
    ok(re === false && (await build(page)) === 'aaa1111', `K. ${shown ? 'hidden then visible' : 'frames held, no visibility event'}, touched before the first frame: kept the old version (${keptSay(re)})`);
    await ctx.close();
  }
}
{ // L
  const { ctx, page, s } = await half();
  const d = s.docs;
  s.hang = 20000; // the next ask for the live page gets no answer
  await vis(page, 'hidden'); await vis(page, 'visible'); await page.waitForTimeout(300); // a short look away: that check goes out
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible'); // still out on coming back
  const re = await reloadedTo(page, s, d);
  ok(re && (await build(page)) === 'bbb2222', `L. a check still out from before the away: the reopen's own check loaded the new version (${re ? await build(page) : 'no reload'})`);
  await ctx.close();
}
{ // M
  const { ctx, page, s, was } = await half();
  await vis(page, 'hidden'); await shiftClock(page, 5000); await vis(page, 'visible'); // a short look away finds the new version
  ok(!(await reloadedTo(page, s, s.docs, 4000)), 'M. found while playing, kept the old version');
  s.offline = true;
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  await page.waitForTimeout(6000);
  ok(s.docs === d, `M. offline on coming back: no reload (${s.docs === d ? 'none tried' : 'a reload was tried'})`);
  const now = (await page.evaluate(() => !!window.crumble).catch(() => false)) && await snap(page);
  ok(now && JSON.stringify(now) === JSON.stringify(was), `M. the level plays on as left (${now ? `${now.state}, ${now.sends} sends` : 'no game on the page'})`);
  await ctx.close();
}
{ // N
  const { ctx, page, s, was } = await half();
  await page.evaluate(blockStorage); // storage full from here on
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  const re = await reloadedTo(page, s, d, 6000);
  const now = await snap(page);
  ok(!re && (await build(page)) === 'aaa1111' && JSON.stringify(now) === JSON.stringify(was), `N. storage full at the reopen: no reload, level as left (${re ? 'reloaded' : `kept, ${now.sends} sends`})`);
  await ctx.close();
}
{ // O
  const { ctx, page, s, was } = await half(2, { init: blockStorage });
  await vis(page, 'hidden'); await shiftClock(page, 5000); await vis(page, 'visible'); // a short look away finds the new version
  ok(!(await reloadedTo(page, s, s.docs, 4000)), 'O. found while playing, kept the old version');
  const d = s.docs;
  await page.locator('#next').click({ timeout: 20000 });
  const re = await reloadedTo(page, s, d, 3000);
  ok(!re && (await page.evaluate(() => window.crumble.level)) === was.level + 1, `O. storage blocked, the next level: no reload while level ${was.level + 1} lives only in memory (${re ? 'reloaded' : 'kept'})`);
  if (!re) {
    await page.locator('#prev').click({ timeout: 20000 });
    const re2 = await reloadedTo(page, s, d, 3000);
    const now = !re2 && await snap(page);
    ok(!re2 && JSON.stringify(now) === JSON.stringify(was), `O. and back: level ${was.level + 1} as left (${re2 ? 'reloaded' : `${now.sends} sends`})`);
  }
  await ctx.close();
}
{ // P
  const { ctx, page } = await open();
  await page.goto(BASE + '?level=2');
  await loaded(page);
  const keys = () => page.evaluate(() => ['stars', 'cleared-levels', 'clean-levels', 'all-cleared', 'level'].map(k => localStorage.getItem('crumble-crew.' + k)).join(' '));
  const all = String(2 ** 20 - 1);
  const print2 = await page.evaluate(async () => (await import(new URL('js/levels.js', location.href).href)).levelShape(1));
  await page.evaluate(([all, print2]) => { // level 2 won on the level as it is now, every other one on another
    const set = (k, v) => localStorage.setItem('crumble-crew.' + k, v);
    set('stars', '3'.repeat(20)); set('cleared-levels', all); set('clean-levels', all); set('all-cleared', '2');
    set('progress-prints', JSON.stringify(Array.from({ length: 20 }, (_, n) => (n === 1 ? print2 : 'old'))));
  }, [all, print2]);
  await page.reload(); await loaded(page);
  const one = await keys(), stars1 = await page.evaluate(() => window.crumble.stars);
  ok(one === `03${'0'.repeat(18)} 2 2 2 1` && stars1 === 3, `P. only level 2's marks fit the levels as they are, and only they stay (${one}; level 2 shows ${stars1} stars)`);
  await page.evaluate(all => { // from before the fingerprints were kept
    const set = (k, v) => localStorage.setItem('crumble-crew.' + k, v);
    set('stars', '3'.repeat(20)); set('cleared-levels', all); set('clean-levels', all); localStorage.removeItem('crumble-crew.progress-prints');
  }, all);
  await page.reload(); await loaded(page);
  const two = await keys(), stars2 = await page.evaluate(() => window.crumble.stars);
  ok(two === `${'0'.repeat(20)} 0 0 2 1` && stars2 === 0, `P. marks from before the fingerprints all go, all-cleared and the level stay (${two}; level 2 shows ${stars2} stars)`);
  await ctx.close();
}
{ // Q
  const { ctx, page, s } = await open();
  s.countDeals = true;
  await page.goto(BASE + '?level=1');
  await loaded(page);
  await winLevel(page);
  const marks = () => page.evaluate(() => ['stars', 'cleared-levels', 'clean-levels'].map(k => localStorage.getItem('crumble-crew.' + k)).join(' '));
  const won = await marks();
  await page.reload(); await loaded(page);
  const one = await marks();
  ok(/^[123]0{19} 1 (1|null)$/.test(won) && one === won, `Q. level 1 won for real: its marks stay after a reload (${won} -> ${one})`);
  await page.reload(); await loaded(page);
  const dealt = await page.evaluate(() => globalThis.__dealt);
  ok(dealt === 1, `Q. the load after that, in the same version, deals only the level it opens, none to check the marks (${dealt} dealt)`);
  const rules = () => page.evaluate(async () => (await import(new URL('js/logic.js', location.href).href)).RULES);
  const rules0 = await rules();
  await page.route(u => u.pathname.endsWith('/js/logic.js'), async route => { // a new version whose only change is the rules' version
    const r = await route.fetch();
    const js = (await r.text()).replace(/export const RULES = (\d+);/, (_, v) => `export const RULES = ${Number(v) + 1};`);
    await route.fulfill({ response: r, body: js, headers: { ...r.headers(), 'cache-control': 'no-store' } });
  });
  s.doc = s.live = 'bbb2222';
  await page.reload(); await loaded(page);
  const two = await marks(), rules1 = await rules();
  ok(two === won && rules1 === rules0 + 1, `Q. and in a new version with the rules' version up from ${rules0} to ${rules1} (${await build(page)}): ${two}`);
  await ctx.close();
}
{ // R
  const { ctx, page, s } = await open();
  await page.goto(BASE + '?level=1');
  await loaded(page);
  const rest = await shapesNow(page, 0);
  await page.evaluate(rest => { // every level but level 1 won since the last full clear, on the levels as they are
    localStorage.setItem('crumble-crew.cleared-levels', 2 ** 20 - 2); localStorage.setItem('crumble-crew.progress-prints', JSON.stringify(rest));
  }, rest);
  await page.reload(); await loaded(page); await page.waitForTimeout(1800);
  await page.locator('#queues .col button.front').first().click({ timeout: 20000 }); // a send, so the level is mid-way
  s.live = s.doc = 'bbb2222';
  let d = s.docs;
  await vis(page, 'hidden'); await shiftClock(page, 5000); await vis(page, 'visible'); // a short look away finds the new version
  await page.waitForFunction(() => window.crumble.newBuild, null, { timeout: 30000, polling: 100 });
  await winLevel(page);
  const end = await page.evaluate(() => window.crumble.state + ' | ' + document.getElementById('ending-title').textContent);
  ok(s.docs === d && /^done \| All 20 cleared/.test(end), `R. found mid-level and kept; then the last level missing won: the ending (${s.docs === d ? end : 'reloaded'})`);
  s.offline = true;
  d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  await page.waitForTimeout(4000);
  const still = await page.evaluate(() => window.crumble.state).catch(() => 'gone');
  ok(s.docs === d && still === 'done', `R. offline on coming back to the ending: no reload, the ending stays (${s.docs === d ? `none tried, ${still}` : 'a reload was tried'})`);
  s.offline = false;
  await vis(page, 'hidden'); await shiftClock(page, 61000); await vis(page, 'visible'); // online, the next time back
  const re = await reloadedTo(page, s, d);
  ok(re && (await build(page)) === 'bbb2222' && (await page.evaluate(() => window.crumble.level)) === 0, `R. online the next time back: the new version loads, at level 1 (${re ? await build(page) : 'no reload'})`);
  await ctx.close();
}
{ // S
  const { ctx, page, s } = await begun();
  let d = s.docs;
  await vis(page, 'hidden'); await shiftClock(page, 5000); await vis(page, 'visible'); // a short look away finds bbb2222
  await page.waitForFunction(() => window.crumble.newBuild, null, { timeout: 30000, polling: 100 });
  ok(s.docs === d, 'S. found while playing, kept the old version');
  s.live = s.doc = 'ccc3333'; // then another version goes live
  d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  const re = await reloadedTo(page, s, d, 12000);
  const now = re && await snap(page);
  ok(re && (await build(page)) === 'ccc3333' && now.level === 1 && now.sends === 1, `S. another version went live since: the newest one loaded, level as left (${re ? `${await build(page)}, level ${now.level + 1}, ${now.sends} sends` : 'no reload'})`);
  await ctx.close();
}
{ // T
  const { ctx, page, s } = await begun();
  const d = s.docs;
  s.delay = 2500;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible'); await freeFrames(page);
  await page.waitForTimeout(300);
  const box = await page.locator('#queues .col button.front').first().boundingBox();
  await page.mouse.move(box.x + 6, box.y + 6, { steps: 4 }); // over a front, no press: its forecast opens
  const re = await reloadedByCheck(page, s, d);
  ok(re === false && (await build(page)) === 'aaa1111', `T. a mouse hovering a front before the check came back: kept the old version (${keptSay(re)})`);
  await ctx.close();
}
{ // U
  const { ctx, page, s } = await begun();
  s.offline = true;
  const d = s.docs;
  await vis(page, 'hidden'); await holdFrames(page); await shiftClock(page, 61000); await vis(page, 'visible');
  await page.waitForTimeout(2000);
  s.offline = false; // online again a moment later, before any touch
  const re = await reloadedTo(page, s, d, 15000);
  const now = re && await snap(page);
  ok(re && (await build(page)) === 'bbb2222' && now.level === 1 && now.sends === 1, `U. offline as it came back, online again before a touch: tried again, loaded the new version, level as left (${re ? `level ${now.level + 1}, ${now.sends} sends` : 'no reload'})`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} checks failed` : 'all checks pass');
process.exit(bad ? 1 : 0);
