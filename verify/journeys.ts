// The main flow of the levels-only game: win a level, move between levels, run out of room.
// The game is a canvas, so play goes through the same buttons a finger taps (the front of each
// line), chosen by reading the board the game exposes as window.crumble.

// Taps the front of one line: `good` picks a colour that can be hit now, otherwise one that cannot.
const tap = async (page: any, good: boolean) =>
  page.evaluate((good: boolean) => {
    const g = (window as any).crumble;
    const st = g.board;
    if (g.state !== "play" || st.slots.every((s: any) => s)) return false;
    const fronts = st.columns.map((c: any[], i: number) => ({ i, s: c[0] })).filter((f: any) => f.s);
    const open = (f: any) => st.exposed[f.s.color].size > 0;
    const pick = fronts.find((f: any) => (good ? open(f) : !open(f)));
    if (!pick) return false;
    const btn = document.querySelectorAll("#queues .col")[pick.i].querySelector("button.front") as HTMLElement;
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    return true;
  }, good);

const state = (page: any) => page.evaluate(() => ({ s: (window as any).crumble.state, level: (window as any).crumble.level }));

export const journeys = [
  {
    name: "01-win",
    description: "Play level 1 to the end; the next level starts by itself.",
    tag: "Win a level",
    intro: "Maya sends her crew up one at a time until the toadstool is gone.",
    steps: [
      { goto: "/voxel-pop/?level=1", caption: "Level 1" },
      { expect: "Level 1", caption: "Toadstool" },
      { run: async (ctx: any) => { await tap(ctx.page, true); await ctx.page.waitForTimeout(200); await tap(ctx.page, true); await ctx.page.waitForTimeout(200); await tap(ctx.page, true); } },
      { expect: "#pads .pad .crew", caption: "Crew on the pads" },
      {
        caption: "Popping every cube",
        run: async (ctx: any) => {
          const end = Date.now() + 150_000;
          while (Date.now() < end) {
            const now = await state(ctx.page);
            if (now.s === "won" || now.level !== 0) return;
            if (now.s === "jam") throw new Error("level 1 ran out of room with a careful player");
            await tap(ctx.page, true);
            await ctx.page.waitForTimeout(350);
          }
          throw new Error("level 1 was not won in 150 seconds");
        },
      },
      { expect: "Level 2", caption: "Next level starts", highlight: true },
    ],
  },
  {
    name: "02-levels",
    description: "The arrows move between levels and the name restarts one.",
    tag: "Pick a level",
    intro: "Maya skips ahead with the arrows, then restarts the level she lands on.",
    steps: [
      { goto: "/voxel-pop/?level=3", caption: "Level 3" },
      { click: "#next", caption: "Next level" },
      { expect: "Level 4", caption: "Level 4" },
      { click: "#prev", caption: "Back one" },
      { click: "#prev", caption: "Back again" },
      { expect: "Level 2", caption: "Level 2", highlight: true },
      { run: async (ctx: any) => { await tap(ctx.page, true); await ctx.page.waitForTimeout(200); await tap(ctx.page, true); } },
      { expect: "#pads .pad .crew", caption: "Crew go up" },
      { click: "#again", caption: "Start it again" },
      {
        caption: "Fresh level",
        run: async (ctx: any) => {
          const pads = await ctx.page.evaluate(() => (window as any).crumble.board.slots.filter((s: any) => s).length);
          if (pads !== 0) throw new Error("restart left crew on the pads");
        },
      },
    ],
  },
  {
    name: "03-out-of-room",
    description: "Fill every pad with crew that cannot hit anything; a tap restarts the level.",
    tag: "Out of room",
    intro: "Maya sends up crew whose colours are still buried, and runs out of room.",
    steps: [
      { goto: "/voxel-pop/?level=20", caption: "The last level" },
      {
        caption: "Wrong crew, every pad",
        run: async (ctx: any) => {
          for (const level of [20, 16, 19, 10]) {
            await ctx.page.evaluate((n: number) => (window as any).crumble.start(n - 1), level);
            const end = Date.now() + 25_000;
            while (Date.now() < end) {
              if ((await state(ctx.page)).s === "jam") return;
              if (!(await tap(ctx.page, false))) await ctx.page.waitForTimeout(400);
              else await ctx.page.waitForTimeout(250);
            }
          }
          throw new Error("could not run out of room on levels 20, 16, 19 or 10");
        },
      },
      { expect: "Out of room. Tap to try again.", caption: "Out of room", highlight: true },
      { click: "#stage", caption: "Tap to try again" },
      {
        caption: "The level starts over",
        run: async (ctx: any) => {
          const now = await ctx.page.evaluate(() => ({ s: (window as any).crumble.state, pads: (window as any).crumble.board.slots.filter((x: any) => x).length }));
          if (now.s !== "play" || now.pads !== 0) throw new Error(`after the tap: ${JSON.stringify(now)}`);
        },
      },
    ],
  },
];
