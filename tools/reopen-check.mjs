// Reopened after a minute or more away, before the first touch, the game loads the new
// version, even in the middle of a level, and the level comes back as it was left (11nov).
// Run: serve the repo (python3 -m http.server 8137), then node tools/reopen-check.mjs http://127.0.0.1:8137/
// Serves the branch at BASE; the page's build mark is rewritten per request: the document the
// browser loads says `doc`, the live page the game checks says `live`. "Away" is made by holding the
// page's frames (requestAnimationFrame) and moving its clock (Date.now) on; "hidden" and "visible"
// by the page's visibility events, as iOS sends them.
// Cases: A. away 61 s, hidden then visible: reloads into the new version, level as left.
//        B. frames held 61 s with no visibility event (iOS froze the app): the same.
//        C. away 10 s: keeps the old version mid-level; "Start it again" (a level boundary) loads it.
//        D. away 61 s but touched before the check came back: keeps the old version.
//        E. a fresh load from an old copy, half-played level, untouched: loads the new version, level as left.
import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/code/package.json');
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8137/';
const browser = await chromium.launch();
let bad = 0;
const ok = (c, what) => { console.log(c ? 'ok ' : 'BAD', what); if (!c) bad++; };

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const s = { doc: 'aaa1111', live: 'aaa1111', docs: 0, delay: 0, errors: [] };
  page.on('pageerror', e => s.errors.push(String(e.message)));
  await page.route(u => u.pathname === '/' || u.pathname === '/index.html', async route => {
    const isDoc = route.request().resourceType() === 'document';
    const r = await route.fetch();
    const html = (await r.text()).replace('name="build" content="dev"', `name="build" content="${isDoc ? s.doc : s.live}"`);
    if (isDoc) { s.docs++; if (s.afterDoc) { s.doc = s.afterDoc; s.afterDoc = null; } }
    else if (s.delay) await new Promise(res => setTimeout(res, s.delay));
    await route.fulfill({ response: r, body: html, headers: { ...r.headers(), 'cache-control': 'no-store' } });
  });
  return { ctx, page, s };
}
const loaded = page => page.waitForFunction(() => window.crumble && document.getElementById('loading').hidden, null, { timeout: 30000 });
const build = page => page.evaluate(() => document.querySelector('meta[name="build"]').content);
const snap = page => page.evaluate(() => { const x = window.crumble.snapshot(); return { state: x.state, level: x.level, cleared: x.cleared, hash: x.hash, lines: x.lines, pads: String(x.pads).replace(/\+\d+/g, ''), flying: x.flying, sends: x.sends, undos: x.undos }; });
const quiet = page => page.evaluate(() => { const st = window.crumble.board; return !st.flying.length && st.slots.every(s => !s || (!(s.land > 0) && st.exposed[s.color].size === 0)); });
async function sendTwo(page) {
  for (let k = 0; k < 2; k++) {
    const i = await page.evaluate(() => {
      const st = window.crumble.board;
      const lines = st.columns.map((c, i) => (c.length ? i : -1)).filter(i => i >= 0);
      return lines.find(i => st.exposed[st.columns[i][0].color].size > 0) ?? lines[0];
    });
    await page.locator('#queues .col').nth(i).locator('button.front').click({ timeout: 5000 });
    await page.waitForTimeout(250);
  }
  const end = Date.now() + 30000;
  while (!(await quiet(page))) { if (Date.now() > end) throw new Error('board did not settle'); await page.waitForTimeout(200); }
}
// Hold the frames, move the clock on by `ms`, and optionally send hidden then visible.
const holdFrames = page => page.evaluate(() => { window.__raf = window.requestAnimationFrame; window.__held = []; window.requestAnimationFrame = cb => { window.__held.push(cb); return 0; }; });
const freeFrames = page => page.evaluate(() => { window.requestAnimationFrame = window.__raf; window.__held.forEach(cb => window.__raf(cb)); });
const shiftClock = (page, ms) => page.evaluate(ms => { const real = Date.now.bind(Date); Date.now = () => real() + ms; }, ms);
const vis = (page, v) => page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }, v);
async function reloadedTo(page, s, docsBefore, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (s.docs > docsBefore) { await loaded(page); await page.waitForTimeout(400); return true; }
    await page.waitForTimeout(100);
  }
  return false;
}

async function half(level = 2) {
  const o = await open();
  await o.page.goto(BASE + '?level=' + level);
  await loaded(o.page); await o.page.waitForTimeout(1800); // the load's own check finds nothing new
  await sendTwo(o.page);
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
  await page.locator('#again').click({ timeout: 5000 });
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
  const box = await page.locator('#stage').boundingBox(); // a touch while the check is out: a turn of the sculpture
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  const re = await reloadedTo(page, s, d, 6000);
  ok(!re && (await build(page)) === 'aaa1111', `D. touched before the check came back: kept the old version (${re ? 'reloaded' : 'kept'})`);
  const now = await snap(page);
  ok(now.sends === was.sends && now.state === 'play', `D. still mid-level, ${now.sends} sends`);
  const d3 = s.docs;
  await page.locator('#again').click({ timeout: 5000 });
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
await browser.close();
console.log(bad ? `${bad} checks failed` : 'all checks pass');
process.exit(bad ? 1 : 0);
