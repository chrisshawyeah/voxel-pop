# Crumble Crew, levels only

A cube-popping puzzle. A sculpture made of coloured cubes turns in the middle. Tap the front
crew member of a line to send it up to a launch pad, where it pops every cube of its colour
it can reach until its number runs out. Clear every cube to win. If every pad is full and
none of them can hit anything, you are out of room and the level starts again.

There are no coins, power-ups, menus or ads. Just 20 levels.

Play: https://chrisshawyeah.github.io/voxel-pop/

- The arrows at the top go to the previous and next level. Tapping the level's name restarts it.
- `?level=7` at the end of the address opens level 7.
- Drag the sculpture to turn it.

## Change it

No build step and nothing to install. Every file is plain JavaScript the browser loads as is.

| To change | Edit |
|---|---|
| The levels: order, how many crew, pads, hidden crew, how hard | `js/levels.js`, the `LEVELS` list at the top. Every setting is explained there. |
| The sculptures, or add your own | `js/models.js`. Each one is a short function; the top of the file says how. |
| The colours | `COLORS` at the top of `js/models.js` |
| The rules: what can be hit, when you are out of room | `js/logic.js` |
| What a win or a loss does, shot speed | `js/main.js` (`FIRE_GAP`, `NEXT_AFTER`, `win()`, `jam()`) |
| The look of the crew, pads and top bar | `css/game.css` |
| Sounds | `js/audio.js` (every sound is made in code) |
| The 3D look: cubes, lights, camera, turn speed | `js/render.js` |

To try a change on your own computer, serve the folder and open it (the page loads modules,
so opening `index.html` straight from the disk does not work):

    npx serve .

Then check that every level can still be dealt and won:

    npm test

`node tools/difficulty.mjs` prints, for each level, how often a careful and a hasty test
player win it. `node tools/pick-deals.mjs 12` suggests `deal`, `flip` and `mix` values for
level 12 that land near its `target`.

A push to `main` runs the checks and puts the game live at the link above.

## Ideas to try

- A level with 3 pads (`pads: 3`) on a small sculpture.
- A sculpture with one colour buried deep inside two others.
- Crew that are linked and must go up together, or three of a colour that merge into one big one.
- Big cubes that need several hits.
