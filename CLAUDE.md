# ChessSight — Standing Instructions for Claude Code

## Project
Chess training web app deployed at vorpalrobotics.github.io/ChessSight.
Static site (HTML/CSS/ES modules), no build step. GitHub Pages serves from `main`.

## Version number
`index.html` has `<title>ChessSight vN</title>`.
**Increment N by 1 before every commit.** This lets the user verify GitHub Pages
has deployed the latest version by checking the browser tab title.
Current version after the most recent commit is tracked in this file:

**Current version: v42**

## Commit & push discipline
- Develop on branch `claude/fix-engine-counter-moves-2O7sZ`, but always also push to `main`
  (GitHub Pages deploys from `main`).
- Use descriptive commit messages; include the session URL footer.

## Key libraries (all via CDN, no npm install)
- **cm-chessboard v8** — `Chessboard`, `COLOR`, `Arrows`, `Markers` extensions
- **chess.js v1** — `Chess`; use `moves({ verbose:true })`, `attackers(sq, color)`
- **Chart.js v4** — imported as ESM (`chart.js@4/+esm`) in app.js

## Architecture
- `js/app.js` — screen routing, engine mode, hamburger/modals, Chart.js history
- `js/checks.js`, `captures.js`, `loose.js`, `under.js`, `forks.js` — drill modules
- `js/storage.js` — IndexedDB helpers (`upsertDrillDay`, `getAllRecords`)
- `css/style.css` — all styles (dark theme, CSS custom properties)
- `index.html` — single-page app, all screens as `div.screen`

## Drill pattern
Every drill module exports `initDrill(navigateFn)` and `startDrill()`.
Board is created once (lazy) with `new Chessboard(...)` and reused via `setPosition`.
SHOW button toggles solution overlay (arrows for moves, SVG rects for piece-based drills).
Arrow labels are placed at 75% along the line (near the arrowhead).

## IDB storage key
Compound key `[date, drill]` in store `drillDays`.
`upsertDrillDay(drill, { seconds, correct, misses, puzzleId })` accumulates daily totals.

## Hamburger menu items
- **About** — attribution modal
- **History** — Chart.js progress charts (avg time + accuracy per drill)
- **Debug** — raw IDB data table (remove before customer release)

## Fork drill definition
A fork move attacks 2+ enemy pieces that are each:
- The king (always qualifies), OR
- Strictly lower value than the forking piece (P=1, N/B=3, R=5, Q=9, K=∞), OR
- Loose (zero defenders in the post-move position)
AND the attack must be newly created by the move (piece did not already attack
that square before moving).
