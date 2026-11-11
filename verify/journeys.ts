// The main flow of the levels-only game: win a level (cleanly), move between levels, come back
// to a level after a reload, run out of room and undo.
// The game is a canvas with buttons below it. The journeys choose what to send by a simple rule
// read from the board the game exposes as window.crumble, then tap the front of that line with
// a real click at its place on the screen, so a button that is hidden, covered or cut off fails.

// The board as the game holds it, in plain numbers.
const board = (page: any) =>
  page.evaluate(() => {
    const g = (window as any).crumble;
    const st = g.board;
    const crew = st.columns.flat();
    return {
      s: g.state, level: g.level, cleared: st.cleared, total: st.total,
      onPads: st.slots.filter((x: any) => x).length, free: st.slots.filter((x: any) => !x).length,
      crew: crew.length, shots: crew.reduce((n: number, x: any) => n + x.count, 0),
    };
  });

// The rule. "can-hit": the first line whose front's colour has a cube with nothing on top (the
// screen shows it ready); when none has and nothing is moving, the first line. "buried": the
// first line whose front's colour is all under other cubes (the screen shows it covered).
// -1 when the rule sends nothing now.
const pickLine = (page: any, want: "can-hit" | "buried") =>
  page.evaluate((want: string) => {
    const g = (window as any).crumble;
    const st = g.board;
    if (g.state !== "play" || st.slots.every((s: any) => s)) return -1;
    const lines = st.columns.map((c: any[], i: number) => (c.length ? i : -1)).filter((i: number) => i >= 0);
    const open = (i: number) => st.exposed[st.columns[i][0].color].size > 0;
    const pick = lines.find((i: number) => (want === "buried" ? !open(i) : open(i)));
    if (pick !== undefined) return pick;
    const quiet = !st.flying.length && st.slots.every((s: any) => !s || st.exposed[s.color].size === 0);
    return want === "can-hit" && quiet && lines.length ? lines[0] : -1;
  }, want);

// The board in plain text (window.crumble.snapshot()): state, level, clock, cubes gone and which
// (a hash), every line front to back (a "?" is marked), every pad, the shots in the air, sends and
// undos. Two equal ones are the same board.
const where = (page: any) => page.evaluate(() => (window as any).crumble.snapshot());
const BOARD = ["state", "level", "cleared", "hash", "lines", "pads", "flying"];
const same = (a: any, b: any, what: string, keys = BOARD) => {
  const diff = keys.filter(k => a[k] !== b[k]);
  if (diff.length) throw new Error(`${what}: ${diff.map(k => `${k} is ${JSON.stringify(a[k])}, was ${JSON.stringify(b[k])}`).join("; ")}`);
};
// Nothing moving: no shot in the air, nobody landing, nobody on a pad who can fire.
const quiet = (page: any) =>
  page.evaluate(() => {
    const st = (window as any).crumble.board;
    return !st.flying.length && st.slots.every((s: any) => !s || (!(s.land > 0) && st.exposed[s.color].size === 0));
  });

// Fails unless every element matching `sel` lies inside the window.
const inside = async (page: any, sel: string, what: string) => {
  const out = await page.evaluate((sel: string) => {
    const bad: string[] = [];
    document.querySelectorAll(sel).forEach((el, k) => {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) bad.push(`#${k + 1} at ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`);
    });
    return { n: document.querySelectorAll(sel).length, bad, w: innerWidth, h: innerHeight };
  }, sel);
  if (!out.n) throw new Error(`${what}: nothing on the screen`);
  if (out.bad.length) throw new Error(`${what} cut off in a ${out.w}x${out.h} window: ${out.bad.join(", ")}`);
};

// Sends one crew member by the rule with a real tap on its button; false when it sends nothing.
const send = async (page: any, want: "can-hit" | "buried") => {
  const i = await pickLine(page, want);
  if (i < 0) return false;
  await page.locator("#queues .col").nth(i).locator("button.front").click({ timeout: 5000 });
  return true;
};

// Fails unless at least one crew member is drawn on a launch pad right now.
const onPads = async (page: any) => {
  const n = await page.evaluate(() => document.querySelectorAll("#pads .pad .crew").length);
  if (!n) throw new Error("no crew on the pads after the taps");
};

// Fails unless the level is whole: nothing popped, nobody on a pad, every crew member in the
// lines with all its shots, on the level expected (and as many crew as at the start, if given).
const whole = async (page: any, level: number, crew?: number) => {
  const b = await board(page);
  const bad: string[] = [];
  if (b.s !== "play") bad.push(`state ${b.s}`);
  if (b.level !== level) bad.push(`level ${b.level + 1}, not ${level + 1}`);
  if (b.cleared !== 0) bad.push(`${b.cleared} cubes already gone`);
  if (b.onPads) bad.push(`${b.onPads} crew on the pads`);
  if (b.shots !== b.total) bad.push(`the lines carry ${b.shots} shots for ${b.total} cubes`);
  if (crew !== undefined && b.crew !== crew) bad.push(`${b.crew} crew in the lines, not ${crew}`);
  if (bad.length) throw new Error(`the level is not whole: ${bad.join(", ")}`);
  return b;
};

// Fills every pad with buried crew. True once the game says it is out of room. `before` gets who
// was where just before each send (nothing moves meanwhile: buried crew have nothing to hit).
const fillWithBuried = async (page: any, before: any[]) => {
  before.length = 0;
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const b = await board(page);
    if (b.s === "jam") return true;
    if (b.cleared > 0) return false;
    const was = await where(page);
    if (await send(page, "buried")) { before.push(was); await page.waitForTimeout(250); }
    else if (!b.free) await page.waitForTimeout(300); // every pad full: the game calls it in under a second
    else return false; // no buried front left and a pad still free
  }
  return false;
};

export const journeys = [
  {
    name: "01-win",
    description: "Play level 1 to the end; the next level starts by itself, whole.",
    tag: "Win a level",
    intro: "Maya sends her crew up one at a time until the toadstool is gone.",
    steps: [
      { goto: "/voxel-pop/?level=1", caption: "Level 1" },
      { expect: "Level 1", caption: "Toadstool" },
      { expect: "Tap the front crew", caption: "What to do" },
      {
        caption: "Ready crew shine, and level 1 shows what each send would do",
        run: async (ctx: any) => {
          const wrong = await ctx.page.evaluate(() => {
            const st = (window as any).crumble.board;
            const cols = Array.from(document.querySelectorAll("#queues .col"));
            return st.columns.flatMap((c: any[], i: number) => {
              if (!c.length) return [];
              const el = cols[i]?.querySelector("button.front .crew");
              const open = st.exposed[c[0].color].size > 0;
              const mark = el?.querySelector(".fc") as HTMLElement | null;
              const label = el?.parentElement?.getAttribute("aria-label") || "";
              const ok = el && el.classList.contains(open ? "ready" : "covered") && mark && !mark.hidden && /alone/.test(label);
              return ok ? [] : [i + 1];
            });
          });
          if (wrong.length) throw new Error(`line ${wrong.join(", ")}: ready or covered does not match the board, or the finishes-or-parks mark is missing`);
        },
      },
      {
        caption: "A tap behind the front shows the whole line",
        run: async (ctx: any) => {
          const before = await board(ctx.page);
          await ctx.page.locator("#queues .col .slot.s2").first().click({ timeout: 5000 });
          await ctx.page.waitForTimeout(300);
          const shown = await ctx.page.evaluate(() => {
            const box = document.getElementById("preview")!;
            const rows = Array.from(box.querySelectorAll("li"));
            const ci = Array.from(document.querySelectorAll("#queues .col")).findIndex(c => c.querySelector(".slot.s2"));
            return { open: !box.hidden, rows: rows.length, low: rows.filter(r => r.getBoundingClientRect().height < 44).length, line: (window as any).crumble.board.columns[ci].length };
          });
          if (!shown.open) throw new Error("a tap on the second row did not open the line");
          if (shown.rows !== shown.line) throw new Error(`the line has ${shown.line} crew, the preview shows ${shown.rows}`);
          if (shown.low) throw new Error(`${shown.low} rows of the preview are under 44 px tall`);
          await inside(ctx.page, "#preview", "the line's preview");
          let after = await board(ctx.page);
          if (after.onPads !== before.onPads || after.crew !== before.crew) throw new Error("a tap on the second row sent a crew member");
          // Any tap closes it, a tap on a front crew member too, and sends nobody.
          await ctx.page.locator("#queues .col button.front").first().click({ timeout: 5000 });
          await ctx.page.waitForTimeout(300);
          if (!(await ctx.page.evaluate(() => document.getElementById("preview")!.hidden))) throw new Error("the preview stayed open after a tap");
          after = await board(ctx.page);
          if (after.onPads !== before.onPads || after.crew !== before.crew) throw new Error("the tap that closed the preview sent a crew member");
        },
      },
      {
        caption: "Crew on the pads",
        run: async (ctx: any) => {
          for (let k = 0; k < 3; k++) { await send(ctx.page, "can-hit"); await ctx.page.waitForTimeout(200); }
          await onPads(ctx.page);
        },
      },
      {
        caption: "Popping every cube",
        run: async (ctx: any) => {
          const end = Date.now() + 150_000;
          while (Date.now() < end) {
            const b = await board(ctx.page);
            if (b.s === "won") {
              if (b.cleared !== b.total) throw new Error(`won with ${b.total - b.cleared} of ${b.total} cubes still there`);
              return;
            }
            if (b.level !== 0) throw new Error(`level ${b.level + 1} started before level 1 was won`);
            if (b.s === "jam") throw new Error("level 1 ran out of room with a careful player");
            await ctx.page.waitForTimeout((await send(ctx.page, "can-hit")) ? 150 : 250);
          }
          throw new Error("level 1 was not won in 150 seconds");
        },
      },
      { expect: "Clean clear", caption: "No undo: a clean clear" },
      { expect: "Level 2", caption: "Next level starts", highlight: true },
      { caption: "A whole duck", run: async (ctx: any) => { await whole(ctx.page, 1); } },
      { click: "#prev", caption: "Back to level 1" },
      {
        caption: "Level 1 has its star",
        run: async (ctx: any) => {
          const s = await ctx.page.evaluate(() => ({ level: (window as any).crumble.level, clean: (window as any).crumble.clean, star: !document.getElementById("star")!.hidden }));
          if (s.level !== 0 || !s.clean || !s.star) throw new Error(`level ${s.level + 1}: cleared clean ${s.clean}, star shown ${s.star}`);
        },
      },
      { click: "#next", caption: "On to the duck" },
      { caption: "Still a whole duck", run: async (ctx: any) => { await whole(ctx.page, 1); } },
    ],
  },
  {
    name: "02-levels",
    description: "The arrows move between levels and the name restarts one, whole.",
    tag: "Pick a level",
    intro: "Maya skips ahead with the arrows, then restarts the level she lands on.",
    steps: [
      { goto: "/voxel-pop/?level=3", caption: "Level 3" },
      { click: "#next", caption: "Next level" },
      { expect: "Level 4", caption: "Level 4" },
      {
        caption: "From level 4 the forecast waits to be asked",
        run: async (ctx: any) => {
          const shown = await ctx.page.evaluate(() => Array.from(document.querySelectorAll("#queues .front .fc")).filter(e => !(e as HTMLElement).hidden).length);
          if (shown) throw new Error(`${shown} fronts show the finishes-or-parks mark on level 4`);
          const front = ctx.page.locator("#queues .col button.front").first();
          await front.hover({ timeout: 5000 });
          await ctx.page.waitForTimeout(200);
          const tip = await ctx.page.evaluate(() => {
            const t = document.querySelector("#queues .front .tip:not([hidden])") as HTMLElement | null;
            return { text: t?.textContent || "", label: document.querySelector("#queues .col button.front")?.getAttribute("aria-label") || "" };
          });
          if (!/finishes alone|parks \d+ alone|no free pad/.test(tip.text)) throw new Error(`hovering a front shows "${tip.text}"`);
          if (!/finishes alone|parks \d+ alone|no free pad/.test(tip.label)) throw new Error(`the front's name does not say what sending it would do: "${tip.label}"`);
          await ctx.page.mouse.move(5, 5);
          await ctx.page.waitForTimeout(200);
          const left = await ctx.page.evaluate(() => document.querySelectorAll("#queues .front .tip:not([hidden])").length);
          if (left) throw new Error("the forecast stayed after the mouse left");
          const b = await board(ctx.page);
          if (b.onPads) throw new Error("hovering sent a crew member");
        },
      },
      { click: "#prev", caption: "Back one" },
      { click: "#prev", caption: "Back again" },
      { expect: "Level 2", caption: "Level 2", highlight: true },
      { caption: "The whole duck", run: async (ctx: any) => { ctx.state.crew = (await whole(ctx.page, 1)).crew; } },
      {
        caption: "Crew go up",
        run: async (ctx: any) => {
          await send(ctx.page, "can-hit"); await ctx.page.waitForTimeout(200); await send(ctx.page, "can-hit");
          await onPads(ctx.page);
          const end = Date.now() + 5000;
          while ((await board(ctx.page)).cleared === 0) {
            if (Date.now() > end) throw new Error("no cube popped after two crew went up");
            await ctx.page.waitForTimeout(150);
          }
        },
      },
      {
        caption: "A reload brings the level back as it was",
        run: async (ctx: any) => {
          const end = Date.now() + 30_000;
          while (!(await quiet(ctx.page))) {
            if (Date.now() > end) throw new Error("the board did not come to rest in 30 seconds");
            await ctx.page.waitForTimeout(200);
          }
          const was = await where(ctx.page);
          if (/[?&]level=/.test(ctx.page.url())) throw new Error(`the address still names a level after it was used: ${ctx.page.url()}`);
          await ctx.page.reload();
          await ctx.page.waitForFunction(() => (window as any).crumble && document.getElementById("loading")!.hidden, null, { timeout: 30_000 });
          await ctx.page.waitForTimeout(300);
          const now = await where(ctx.page);
          same(now, was, "after the reload", [...BOARD, "sends", "undos"]);
          if (now.tick < was.tick) throw new Error(`the clock came back at ${now.tick}, before ${was.tick}: the level went back to an earlier moment`);
          const drawn = await ctx.page.evaluate(() => ({ ...(window as any).crumble.drawn, cubes2: (window as any).crumble.board.cells.filter(Boolean).length }));
          if (drawn.cubes !== drawn.cubes2) throw new Error(`${drawn.cubes} cubes drawn for ${drawn.cubes2} on the board`);
          await ctx.page.locator("#undo").click({ timeout: 5000 });
          await ctx.page.waitForTimeout(200);
          const back = await where(ctx.page);
          if (back.sends !== was.sends - 1 || back.undos !== was.undos + 1) throw new Error(`after a reload, undo left ${back.sends} sends and ${back.undos} undos (was ${was.sends} and ${was.undos})`);
        },
      },
      { click: "#again", caption: "Start it again" },
      { expect: "Level 2", caption: "Still level 2" },
      { caption: "Fresh level", run: async (ctx: any) => { await whole(ctx.page, 1, ctx.state.crew as number); } },
      {
        caption: "Short narrow windows keep every row",
        run: async (ctx: any) => {
          const size = ctx.page.viewportSize() ?? { width: 1280, height: 800 };
          try {
            for (const [width, height] of [[390, 360], [500, 360]]) {
              await ctx.page.setViewportSize({ width, height });
              await ctx.page.waitForTimeout(400);
              await inside(ctx.page, "#queues .col .slot", `crew rows at ${width}x${height}`);
              await inside(ctx.page, "#pads .pad", `pads at ${width}x${height}`);
              const h = await ctx.page.evaluate(() => document.getElementById("stage")!.getBoundingClientRect().height);
              if (h < 140) throw new Error(`the sculpture gets ${Math.round(h)} px at ${width}x${height}, under 140`);
            }
          } finally {
            await ctx.page.setViewportSize(size);
            await ctx.page.waitForTimeout(400);
          }
        },
      },
    ],
  },
  {
    name: "03-out-of-room",
    description: "Fill every pad with crew whose colour is buried; a tap undoes the last send, the undo button the one before, and the name restarts the level, whole.",
    tag: "Out of room",
    intro: "Maya sends up crew whose colours are still buried, runs out of room, and takes back her sends.",
    steps: [
      { goto: "/voxel-pop/?level=11", caption: "Level 11" },
      {
        caption: "Buried crew, every pad",
        run: async (ctx: any) => {
          // Level 11 can be filled with buried crew from the start; the rest are tried after it in
          // case the levels are dealt again.
          for (const n of [11, ...Array.from({ length: 20 }, (_, k) => k + 1).filter(k => k !== 11)]) {
            await ctx.page.evaluate((n: number) => (window as any).crumble.start(n - 1), n);
            const b = await whole(ctx.page, n - 1);
            ctx.state.level = b.level; ctx.state.crew = b.crew;
            ctx.state.before = [];
            if (await fillWithBuried(ctx.page, ctx.state.before as any[])) return;
          }
          throw new Error("no level could be filled with buried crew");
        },
      },
      { expect: "Out of room. Tap to undo your last send.", caption: "Out of room", highlight: true },
      {
        caption: "Every pad waiting",
        run: async (ctx: any) => {
          const n = await ctx.page.evaluate(() => ({
            pads: document.querySelectorAll("#pads .pad").length,
            waiting: document.querySelectorAll("#pads .pad.waiting .crew.asleep").length,
          }));
          if (n.waiting !== n.pads) throw new Error(`${n.waiting} of ${n.pads} pads show a sleeping crew member`);
        },
      },
      {
        caption: "The message fits a phone held sideways",
        run: async (ctx: any) => {
          const size = ctx.page.viewportSize() ?? { width: 1280, height: 800 };
          try {
            await ctx.page.setViewportSize({ width: 560, height: 390 });
            await ctx.page.waitForTimeout(400);
            await inside(ctx.page, "#banner", "the out-of-room message");
          } finally {
            await ctx.page.setViewportSize(size);
            await ctx.page.waitForTimeout(400);
          }
        },
      },
      { click: "#stage", caption: "Tap to undo" },
      {
        caption: "Back to before the last send",
        run: async (ctx: any) => {
          const before = ctx.state.before as any[];
          if (before.length < 2) throw new Error(`only ${before.length} sends were made`);
          await ctx.page.waitForTimeout(300);
          same(await where(ctx.page), before[before.length - 1], "after the tap");
        },
      },
      { click: "#undo", caption: "Undo once more" },
      {
        caption: "And the send before that",
        run: async (ctx: any) => {
          const before = ctx.state.before as any[];
          await ctx.page.waitForTimeout(300);
          same(await where(ctx.page), before[before.length - 2], "after the undo button");
        },
      },
      { click: "#again", caption: "Start it again" },
      { caption: "The level starts over", run: async (ctx: any) => { await whole(ctx.page, ctx.state.level as number, ctx.state.crew as number); } },
      {
        caption: "Undo brings back popped cubes and shots in the air",
        run: async (ctx: any) => {
          const end = Date.now() + 30_000;
          for (;;) {
            const ok = await ctx.page.evaluate(() => {
              const st = (window as any).crumble.board;
              return st.cleared > 0 && st.flying.length > 0 && st.slots.some((s: any) => !s) &&
                st.columns.some((c: any[]) => c.length && st.exposed[c[0].color].size > 0);
            });
            if (ok) break;
            if (Date.now() > end) throw new Error("no moment with cubes popped, shots in the air and a ready crew member to send");
            await ctx.page.waitForTimeout((await send(ctx.page, "can-hit")) ? 120 : 80);
          }
          // The board is read and the send made in one go, so not a tick passes in between; the
          // same for the undo and the board it gives back.
          const was = await ctx.page.evaluate(() => {
            const g = (window as any).crumble, st = g.board;
            const before = g.snapshot();
            const i = st.columns.findIndex((c: any[]) => c.length && st.exposed[c[0].color].size > 0);
            (document.querySelectorAll("#queues .col")[i].querySelector("button.front") as HTMLElement).click();
            return { before, sends: g.sends };
          });
          if (was.sends !== was.before.sends + 1) throw new Error("the send did not go");
          await ctx.page.waitForTimeout(500);
          const back = await ctx.page.evaluate(() => {
            (document.getElementById("undo") as HTMLElement).click();
            const g = (window as any).crumble;
            return { now: g.snapshot(), drawn: g.drawn, cubes: g.board.cells.filter(Boolean).length, flying: g.board.flying.length };
          });
          same(back.now, was.before, "after the undo", [...BOARD, "tick", "sends"]);
          if (back.drawn.shots !== back.flying) throw new Error(`${back.drawn.shots} shots drawn in the air for ${back.flying} in the rules`);
          if (back.drawn.cubes !== back.cubes) throw new Error(`${back.drawn.cubes} cubes drawn for ${back.cubes} on the board`);
          if (back.now.undos !== was.before.undos + 1) throw new Error("the undo was not counted");
        },
      },
    ],
  },
];
