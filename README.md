# Crumble Crew, levels only

A cube-popping puzzle. A sculpture made of coloured cubes turns in the middle. Tap the front
crew member of a line to send it up to a launch pad, where it pops cubes of its colour until
its number runs out. A crew member can only hit a cube with nothing on top of it, so the
sculpture is eaten from the top down; one whose colour is still buried waits on its pad,
taking room, until the cubes above are gone. Clear every cube to win. If every pad is full and
none of them can hit anything, you are out of room: a tap takes back your last send, and another
tap the one before, back to the start of the level if need be.

Undo is unlimited, but a level won with no undo at all is a *clean clear*: the win says
"Toadstool popped! Clean clear", and the level keeps one small star beside its name in the top
bar. Undos are counted for the attempt (a restart of the level starts the count again); taking
back a send never lowers the count, and it survives a reload.

The crew show what they can reach. The front of a line is *ready* (a white rim and a glow, eyes
up) when its colour has a cube with nothing on top that no shot has taken yet, so it pops the
moment it is up; otherwise it is *covered* and looks plain. On a pad, a crew member with nothing
to hit is *asleep* (dim, eyes shut, a "zz") and its pad turns dashed: it is waiting, not broken.
All of it comes from the same test the rules use (`st.exposed` in `js/logic.js`) and switches
the moment it changes; only the glow fades.

What sending a front now would do is the rules run on a copy of the board (`forecast()` in
`js/logic.js`), with the crew already on the pads and the shots in the air, if no more crew are
sent after it: it *finishes* (fires its whole number and frees its pad) or *parks* with some still
to fire, and it may *strand* crew already on a pad: ones that would have finished without this
send and now park ("finishes; strands red 12": the red crew member on a pad would be left with 12).
Under every front it shows as a tick (finishes and strands nobody), "parks 23", or "strands" (it
finishes, but leaves someone parked), the last two in a dashed box like a waiting pad. In words,
"finishes; strands red 12" over "with no more sends", it appears above a front while the
front is pressed and held (300 ms; that press sends nobody, a quick tap still sends at once),
while a mouse is over it, or while it has keyboard focus; screen readers hear it in the front's
name. It wraps to stay on the screen however many crew a send strands. It is worked out again
whenever the board changes and, while shots are in the air, on every
tick, so it is right the moment it shows. It is hidden while every pad is taken ("no free pad"
when asked). Levels 1 to 3 always show the marks under the fronts. From level 4 they show too, with
the line "Hold a front crew to preview. Tap to send.", until the player has held a front (or kept
a mouse or the keyboard on one) for 300 ms while it showed a real forecast (the page in view and a
pad free, not "no free pad"); from then on, from level 4, a front shows only ready or
covered and the words come when asked. The browser remembers it (`crumble-crew.taught`), so a
player who starts on a late level is taught the same way. A crew member already on a pad shows
"parks 23" as soon as a later send has made it certain to park (`fates()` in `js/logic.js`).

Tapping a crew member behind the front opens that whole line, front to back (a line with a "?"
lists which crew the "?"s are among); any tap closes it and sends nobody. Once the crew still
hidden are all the same crew, there is nothing left to guess and they are shown as themselves
(`revealLone()` in `js/logic.js`), so a level dealt with one hidden crew member shows no "?".
"+4" under a line's third crew member means four more behind it.

The lessons, one line at a time: "Tap the front crew" on levels 1 to 3 until the first send; on
level 1, just after it, what the tick means, for 2.5 seconds; on any level, the first time a crew
member sleeps on a pad, "Sleeping crew keep a pad. Clear the cubes above their colour." until that
crew member wakes (and at least 2.5 seconds); and from level 4 the line about holding a front,
until the first hold. Only time on screen counts toward the 2.5 seconds: not while the line is
hidden (out of room, a win, a message over it, the page in the background). The browser
remembers each once it has been seen (`crumble-crew.taught`).

The rules and the shots run three times as fast only while there is nothing to send (every pad
taken, or every line empty); with a pad free and crew in a line they run at normal speed however
long the player takes to choose. They drop back to normal the moment a finger goes down (and stay
there while it is down, even with every pad taken), and never run faster than normal while a crew
member is still landing on its pad, so its flight up always ends before its first shot (`pace()`
in `js/logic.js`).

There are no coins, power-ups, menus or ads. Just 20 levels.

Play: https://chrisshawyeah.github.io/voxel-pop/

- The undo button at the top left takes back the last send at any time: the cubes come back, the
  crew member goes back to the front of its line, the pads and the shots in the air are as they
  were. It is dim when there is nothing to take back.
- The arrows at the top go to the previous and next level. A level left half-played is kept, as
  it was, and comes back when you return to it. Tapping the level's name restarts it from
  scratch and forgets what was kept.
- The bar under the level's name shows how much of the sculpture is gone; it flashes and chimes
  when a colour is cleared.
- The speaker at the top right turns sound and the buzz on or off; the choice is remembered.
- "All 20 cleared" shows the moment every level has been won since the last time it said so,
  whichever level was the last one missing (`crumble-crew.cleared-levels` keeps one bit per
  level, and the game keeps it in memory too, so it works for a visit with storage blocked).
  Winning level 20 before that shows "Level 20 cleared". Under either, how many levels have their
  clean-clear star ("7 of 20 clean clears"), or "All 20 clean" once every one has. Either stays
  until a tap starts level 1.
  How many times every level has been cleared is `crumble-crew.all-cleared`; the clean clears,
  one bit per level, `crumble-crew.clean-levels`.
- Each level being played is kept in the browser's storage (`crumble-crew.attempt.7` for level 7),
  and in memory for the visit, so the arrows bring it back even when storage is blocked or full:
  the sends and their ticks with a check of the board after each, the undos, and the moment it was
  left with a check of the board then. It is saved after every send and undo, when the page is
  hidden or closed, and when you move to another level, so a page the phone stopped in the
  background comes back exactly as it was, undo and all. A save from an older version of the level
  (its settings, sculpture, deal or the rules changed: `levelPrint()` in `js/levels.js`, `RULES` in
  `js/logic.js`) is turned down with "Level changed. Restarted.", and a broken one can never stop
  the game: every field and tick is checked and bounded (`Attempt.restore()` in `js/logic.js`).
  The single attempt very old versions kept carries no fingerprint, so its level starts again with
  the same message.
- A new version of the game loads only at a level boundary: a level with nothing sent or undone,
  the start of another level, or the ending, and only once every one of its files has been
  fetched whole; otherwise the old version plays on and it tries again later. The page checks as
  it loads, when it comes back into view, and when the iPhone app comes back to the front
  (`checkForUpdate()` in `js/main.js`). A reload that comes back as the old version (a stale
  cache) is tried again after a minute, never in a loop. Restarting a level just as a new version
  loads restarts it in the new version too.
- `?level=7` at the end of the address opens level 7 once; the address then forgets it, so a
  reload comes back to the level being played. A number that is not a whole level from 1 to 20 is
  rounded and kept inside that range; when the browser blocks storage the game plays on and the
  address follows the level being played instead.
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
| What a win, a clean clear, a loss and the ending do, shot speed | `js/main.js` (`FIRE_GAP`, `LAND`, `NEXT_AFTER`, `win()`, `ending()`, `jam()`, `tick()`); how long a shot flies is `FLIGHT` in `js/logic.js` |
| The 3x speed-up: when, and how fast | `pace()` and `FAST` in `js/logic.js` (the game and the timed test players both ask it before every tick) |
| Undo, the undo count, and the attempt kept in storage | `Attempt` in `js/logic.js` (a copy of the board before each send; `save()` and `restore()`); `undo()`, `saveAttempt()`, `savedAttempt()` in `js/main.js`. Change `RULES` in `js/logic.js` when a rules change makes old saves wrong |
| Ready and covered fronts, asleep crew, the forecast marks and words, press and hold, the progress bar | `showReach()`, `forecastFor()`, `frontEvents()`, `inspect()` and `progress()` in `js/main.js` (`HOLD_MS`; `marksShown()`: levels up to `TEACH_UNTIL` always, the rest until the first hold); the forecast itself, strands and all, is `forecast()` and `fates()` in `js/logic.js`; their look in `css/game.css` |
| The line preview, the lessons, the star | `preview()`, `teach()` and `showStar()` in `js/main.js` |
| When a new version loads | `checkForUpdate()` and `reloadAt()` in `js/main.js` (`FRESH` lists every file that must come through first) |
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
sends overlap in time (played 0, 150, 300 and 600 ms apart with the game's landing pause and the
game's own clock, the 3x speed-up included, shots still in the air, each tap at its real time,
between two ticks when that is when it falls: `playLine()` on `onClock()`),
and the greedy player wins about as often as the level's `greedy` band says. Beside it: a *hasty
greedy* player, tapping whatever is ready every 150 ms (it may win at most 10 points more than
the greedy one, and from level 2 on it must lose sometimes); a *forecast follower* that sends
whatever the forecast says finishes and strands nobody, waiting for the pads to stop
(`forecastFirst`) or tapping every 150 ms (`hastyForecast`); and the same follower with undo,
taking back its last send when out of room and never trying a lost board twice, at most 50 undos
(`backtrack`). A level with `opening: 'park'` (levels 2 and 3) must have most greedy plays park
someone in their first three sends. And a winning line, sent the moment a pad frees, must take at
most 30 seconds to fire (`firingTime()`, on the game's clock).

The curve is the forecast follower's win rate, level by level: each level's `follow` band in
`js/levels.js`, and `undos`, the most undos the follower with undo may need in its median won play.
Levels 1 to 3 teach (95 to 100%), 4 to 8 rise gently (within 75 to 90%), 9 to 14 are the middle
(within 45 to 70%), 15 to 20 are hard (within 25 to 45%), each band a little lower than the one
before, and level 17, the melon, is the one breather (60 to 80%). No level may be more than 20
points easier for the follower than the level before it, except a level whose band sits wholly
above the one before (the breather); the median undos stay at most 3 up to level 12 and at most 6
after, and from one level to the next rise by at most 3 and fall by at most 1 (the breather left
out). The median jumps from 0 to a level's full depth once the follower wins less than half the
time, which is why the first hard level may rise by 3.
`curveMisses()` in `tools/players.mjs` checks it all; the tests and the deal picker both use it.

Levels 2 and 3 open on purpose with parking and unlocking: the duck has bath foam over its back
(the yellow under it waits), the penguin a red scarf (the head above and the body below wait on
it), each with four pads and ten crew. Level 17, the melon, is a small breather between the
dolls and the castle.

After changing a level's settings, pick a deal for them, then check every level:

    node tools/pick-deals.mjs 12            # level 12: prints its new line to copy in
    node tools/pick-deals.mjs 12 --write    # ... and writes it into js/levels.js
    node tools/pick-deals.mjs --write       # every level, written into js/levels.js
    npm test

The picker keeps a deal that passes everything above, the curve included, against the levels
next to it as they are stored; when none does, the one that misses least, and it says what it
misses. A level's neighbours can change what fits it, so after picking a level pick the ones
beside it again if `npm test` says the curve breaks there.
`node tools/pick-deals.mjs 12 --set='{"crew":[40,70],"cols":4}'` tries other settings without
editing the file, and `node tools/pick-deals.mjs 12 --list` prints every deal it finds with its
measures instead of stopping at the first, then how many it listed (it picks none). Deals with
more than 30 crew are skipped. `node tools/difficulty.mjs` prints every
level's size, crew, pads, "?" on screen, whether the planning player wins with a line that holds,
the greedy rate against its band, the hasty greedy, forecast follower (waiting, against `follow`,
and hasty) and undoing forecast follower rates, the follower's median undos (against `undos`) and
sends, how long the winning line fires, and at the end every place the curve breaks
(`node tools/difficulty.mjs 17` for one level).

A push to `main` runs the checks and puts the game live at the link above.

## Ideas to try

- Colours in flat layers make crew wait; upright stripes do not, since a crew member digs straight
  down its own colour (the fish had upright stripes and nobody ever waited, so it has flat bands now).
- Crew that are linked and must go up together, or three of a colour that merge into one big one.
- Big cubes that need several hits.
