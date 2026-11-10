# Crumble Crew, levels only

A cube-popping puzzle. A sculpture made of coloured cubes turns in the middle. Tap the front
crew member of a line to send it up to a launch pad, where it pops cubes of its colour until
its number runs out. A crew member can only hit a cube with nothing on top of it, so the
sculpture is eaten from the top down; one whose colour is still buried waits on its pad,
taking room, until the cubes above are gone. Clear every cube to win. If every pad is full and
none of them can hit anything, you are out of room: a tap takes back your last send, and another
tap the one before, back to the start of the level if need be.

The crew show what they can reach. A crew member is *ready* (bright, a white rim and a glow,
eyes up, and at the front of a line a small hop) when its colour has a cube with nothing on top
that no shot has taken yet, so it pops the moment it is up. It is *asleep* (dim, eyes shut, a
"zz") when every cube of its colour is under something else, so sent now it would only park.
On a pad, a sleeping crew member's pad turns dashed: it is waiting, not broken. Both come from
the same test the rules use (`st.exposed` in `js/logic.js`) and switch the moment it changes;
only the glow fades.

Under each front's number is what sending it now would do: a tick when it will *finish* (fire its
whole number and free its pad), or "23 left" in a dashed box, like a waiting pad, when it would
*park* with 23 still to fire. It is the rules run on a copy of the board (`forecast()` in
`js/logic.js`), with the crew already on the pads and the shots in the air, so it is exactly what
happens if nothing else is sent after it. It is worked out again whenever the board changes, and
hidden while every pad is taken.

Tapping a crew member behind the front opens that whole line, front to back (a "?" stays a "?",
and a line with a "?" lists which crew the "?"s are among); any tap closes it and sends nobody.
"+4" under a line's third crew member means four more behind it.

Levels 1 to 3 teach, one line at a time: "Tap the front crew" until the first send, then, the
first time a crew member sleeps on a pad, "Sleeping crew keep a pad. Clear the cubes above their
colour." until that crew member wakes. The browser remembers both, so they are shown once.

There are no coins, power-ups, menus or ads. Just 20 levels.

Play: https://chrisshawyeah.github.io/voxel-pop/

- The undo button at the top left takes back the last send at any time: the cubes come back, the
  crew member goes back to the front of its line, the pads and the shots in the air are as they
  were. It is dim when there is nothing to take back.
- The arrows at the top go to the previous and next level. Tapping the level's name restarts it.
- The bar under the level's name shows how much of the sculpture is gone; it flashes and chimes
  when a colour is cleared.
- The speaker at the top right turns sound and the buzz on or off; the choice is remembered.
- Clearing level 20 shows "All 20 cleared" when every level has been won since the last time it
  said so (`crumble-crew.cleared-levels` keeps one bit per level), and "Level 20 cleared"
  otherwise; it stays until a tap starts level 1 again. How many times every level has been
  cleared is kept apart from the level being played (`crumble-crew.all-cleared`).
- A level in progress is kept in the browser's storage after every send (`crumble-crew.attempt`:
  the sends and their ticks, played again on load), so a page the phone stopped in the
  background comes back where it was, undo and all.
- A new version of the game loads only at a level boundary: a level with nothing sent yet, the
  next level after a win, or the ending. The page checks for one when it comes back into view,
  and the iPhone app asks it to when it comes back to the front (`checkForUpdate()` in
  `js/main.js`).
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
| Undo, and the attempt kept in storage | `Attempt` in `js/logic.js` (a copy of the board before each send; `replay()` rebuilds it from the sends); `undo()`, `saveAttempt()` in `js/main.js` |
| Ready and asleep crew, the finishes-or-parks mark, the progress bar | `showReach()`, `forecastNow()` and `progress()` in `js/main.js` (the forecast itself is `forecast()` in `js/logic.js`); their look in `css/game.css` |
| The line preview, the hints on levels 1 to 3 | `preview()` and `teach()` in `js/main.js` |
| When a new version loads | `checkForUpdate()` and `reloadAt()` in `js/main.js` |
| The look of the crew, pads, top bar and short-window layout | `css/game.css` |
| Sounds | `js/audio.js` (every sound is made in code). Ordinary pops are soft and at most about 9 a second (`POP_GAP`); the bright rising notes are for a crew member finishing, a colour cleared and a win. |
| The 3D look: cubes, lights, camera, turn speed | `js/render.js` (`FLING` and `AUTO_REST` for turning by hand) |

To try a change on your own computer, serve the folder and open it (the page loads modules,
so opening `index.html` straight from the disk does not work):

    npx serve .

Each level is dealt from its line in `js/levels.js`; the game never searches. Test players in
`tools/players.mjs` measure a level: a *planning* player that searches for a winning order
knowing only what the screen shows (every line, through the preview, and a "?" as unknown until
it reaches the front), and a *greedy* player that sends any crew member that can shoot right
now. A level is right when the planning player wins it with a line that also wins when the
sends overlap in time (played 0, 150, 300 and 600 ms apart with the game's landing pause, shots
still in the air: `playLine()`), and the greedy player wins about as often as the level's
`greedy` band says. A *hasty greedy* player, tapping whatever is ready every 150 ms, is measured
too and printed beside it (no band; it shows how much rushing costs).

After changing a level's settings, pick a deal for them, then check every level:

    node tools/pick-deals.mjs 12            # level 12: prints its new line to copy in
    node tools/pick-deals.mjs 12 --write    # ... and writes it into js/levels.js
    node tools/pick-deals.mjs --write       # every level, written into js/levels.js
    npm test

`node tools/pick-deals.mjs 12 --set='{"crew":[40,70],"cols":4}'` tries other settings without
editing the file. Deals with more than 30 crew are skipped. `node tools/difficulty.mjs` prints
every level's size, crew, whether the planning player wins, whether its line holds when the sends
overlap, and the greedy and hasty greedy win rates against the band.

A push to `main` runs the checks and puts the game live at the link above.

## Ideas to try

- Colours in flat layers make crew wait; upright stripes do not, since a crew member digs straight
  down its own colour (the fish had upright stripes and nobody ever waited, so it has flat bands now).
- Crew that are linked and must go up together, or three of a colour that merge into one big one.
- Big cubes that need several hits.
