# Crumble Crew, levels only

A cube-popping puzzle. A sculpture made of coloured cubes turns in the middle. Tap the front
crew member of a line to send it up to a launch pad, where it pops cubes of its colour until
its number runs out. A crew member can only hit a cube with nothing on top of it, so the
sculpture is eaten from the top down; one whose colour is still buried waits on its pad,
taking room, until the cubes above are gone. Clear every cube to win. If every pad is full and
none of them can hit anything, you are out of room and the level starts again.

The crew show what they can reach. A crew member is *ready* (bright, a white rim and a glow,
eyes up, and at the front of a line a small hop) when its colour has a cube with nothing on top
that no shot has taken yet, so it pops the moment it is up. It is *asleep* (dim, eyes shut, a
"zz") when every cube of its colour is under something else, so sent now it would only park.
On a pad, a sleeping crew member's pad turns dashed: it is waiting, not broken. Both come from
the same test the rules use (`st.exposed` in `js/logic.js`) and change the moment a shot lands.
Level 1 says "Tap the front crew" and "Crew pop the top cubes of their colour" until the first
send; tapping a crew member behind the front makes the front of its line jump.

There are no coins, power-ups, menus or ads. Just 20 levels.

Play: https://chrisshawyeah.github.io/voxel-pop/

- The arrows at the top go to the previous and next level. Tapping the level's name restarts it.
- The bar under the level's name shows how much of the sculpture is gone; it flashes and chimes
  when a colour is cleared.
- The speaker at the top right turns sound and the buzz on or off; the choice is remembered.
- Clearing level 20 shows "All 20 cleared", which stays until a tap starts level 1 again. How
  many times every level has been cleared is kept apart from the level being played
  (`crumble-crew.all-cleared` in the browser's storage).
- `?level=7` at the end of the address opens level 7. A number that is not a whole level from 1
  to 20 is rounded and kept inside that range; the game plays on when the browser blocks storage.
- Drag the sculpture to turn it. A flick keeps turning a little, never fast, and the slow
  automatic turn waits a second after a drag.
- The crew buttons work with a tap, a click, or Tab then Enter or Space.
- In a short window (a phone held sideways, a short laptop window) the sculpture sits beside the
  pads and lines.

## Change it

No build step and nothing to install. Every file is plain JavaScript the browser loads as is.

| To change | Edit |
|---|---|
| The levels: order, crew sizes, lines, pads, hidden crew, how hard | `js/levels.js`, the `LEVELS` list at the top. Every setting is explained there. After a change, pick a new deal (below). |
| The sculptures, or add your own | `js/models.js`. Each one is a short function; the top of the file says how. |
| The colours | `COLORS` at the top of `js/models.js`. No two colours in one sculpture should be easy to mix up, since crew are told apart by colour alone. |
| The rules: what can be hit, which cube a shot takes, when you are out of room | `js/logic.js` |
| What a win, a loss and the ending do, shot speed | `js/main.js` (`FIRE_GAP`, `LAND`, `NEXT_AFTER`, `win()`, `ending()`, `jam()`); how long a shot flies is `FLIGHT` in `js/logic.js` |
| Ready and asleep crew, the progress bar, the hint on level 1 | `showReach()`, `progress()` and `start()` in `js/main.js`; their look in `css/game.css` |
| The look of the crew, pads, top bar and short-window layout | `css/game.css` |
| Sounds | `js/audio.js` (every sound is made in code). Ordinary pops are soft and at most about 9 a second (`POP_GAP`); the bright rising notes are for a crew member finishing, a colour cleared and a win. |
| The 3D look: cubes, lights, camera, turn speed | `js/render.js` (`FLING` and `AUTO_REST` for turning by hand) |

To try a change on your own computer, serve the folder and open it (the page loads modules,
so opening `index.html` straight from the disk does not work):

    npx serve .

Each level is dealt from its line in `js/levels.js`; the game never searches. Two test players
in `tools/players.mjs` measure a level: a *planning* player that searches for a winning order
(and treats every "?" as unknown until it reaches the front), and a *greedy* player that sends
any crew member that can shoot right now. A level is right when the planning player wins it and
the greedy player wins about as often as the level's `greedy` band says.

After changing a level's settings, pick a deal for them, then check every level:

    node tools/pick-deals.mjs 12            # level 12: prints its new line to copy in
    node tools/pick-deals.mjs --write       # every level, written into js/levels.js
    npm test

`node tools/pick-deals.mjs 12 --set='{"crew":[40,70],"cols":4}'` tries other settings without
editing the file. `node tools/difficulty.mjs` prints every level's size, crew, whether the
planning player wins and the greedy player's win rate against its band.

A push to `main` runs the checks and puts the game live at the link above.

## Ideas to try

- A sculpture with colours in flat layers rather than upright stripes: a crew member digs straight
  down its own colour, so upright stripes (the fish) never make anyone wait.
- Crew that are linked and must go up together, or three of a colour that merge into one big one.
- Big cubes that need several hits.
