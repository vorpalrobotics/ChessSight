# ChessSight — Standing Instructions for Claude Code

## Project
Chess training web app deployed at vorpalrobotics.github.io/ChessSight.
Static site (HTML/CSS/ES modules), no build step. GitHub Pages serves from `main`.

## Version number
`index.html` has `<title>ChessSight vX.Y.Z</title>`.
**Update the version before every commit.** This lets the user verify GitHub Pages
has deployed the latest version by checking the browser tab title.
Current version after the most recent commit is tracked in this file:

**Current version: v0.1.75**

## Version format
Version is `v0.MAJOR.MINOR` derived from the git commit count N:
- MAJOR = floor(N / 100)
- MINOR = N mod 100

So commit 100 → v0.1.0, commit 150 → v0.1.50, commit 200 → v0.2.0.
Get the commit count with: `git rev-list --count HEAD`
Update both `<title>ChessSight vX.Y.Z</title>` and `<span class="version-label">vX.Y.Z</span>` in index.html.

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
- `js/checks.js`, `captures.js`, `loose.js`, `under.js`, `threats.js`, `queen.js` — drill modules
- `js/storage.js` — IndexedDB helpers (`upsertDrillDay`, `getAllRecords`)
- `css/style.css` — all styles (dark theme, CSS custom properties)
- `index.html` — single-page app, all screens as `div.screen`

## Drill pattern
Every drill module exports `initDrill(navigateFn)` and `startDrill()`.
Board is created once (lazy) with `new Chessboard(...)` and reused via `setPosition`.
SHOW button toggles solution overlay (arrows for moves, SVG rects for piece-based drills).
Arrow labels are placed at 75% along the line (near the arrowhead).

## Drill screen layout (standard for all drills)
Every drill screen follows this top-to-bottom order:

```
drill-top
  drill-top-left:  h2 title · puzzle-num · drill-difficulty
  drill-top-right: ⏸ pause · END DRILL (small)
drill-board-wrap > #*-board
drill-answer-panel  (count drills only: digit button rows W / B)
drill-current-stats: timer · misses · action buttons (DONE / SHOW)
#*-status           (italic muted status text, no min-height on count drills)
#*-session-stats    (hidden until first puzzle completes)
  .session-label "Session:"
  #*-session-time  "Avg X:XX"
  #*-session-acc   "Acc XX%"
p.drill-rule
```

### Key rules
- **Session stats** live in `#*-session-stats.drill-session-stats` below all controls,
  NOT in `drill-top-right`. Start hidden (`class="drill-session-stats hidden"`).
  Call `updateSessionStats()` both on puzzle completion AND at the start of each new
  puzzle load so stats appear as soon as the user advances (even via NEXT/board click).
  `resetDrill()` re-adds the `hidden` class and clears the span text.
- **Action buttons** for click drills are DONE and SHOW (never COMPLETE or CONTINUE).
  After puzzle completion the button label stays DONE — do not rename it.
- **END DRILL button**: `font-size: 0.65rem; padding: 0.25rem 0.6rem` (smaller than normal).
- **drill-top-right gap**: `0.4rem` (tight — only pause + END DRILL buttons live there now).
- **Per-puzzle result lines** (`#*-result`) have been removed from all drills — they
  were redundant with the stats bar. Do not add them to new drills.
- **`min-height: 1em`** on `#*-status` is kept for click drills (loose, under, queen,
  knight, hanggrab) but removed from count drills (checks, captures) where it caused
  dead space after the SHOW button.

## IDB storage key
Compound key `[date, drill]` in store `drillDays`.
`upsertDrillDay(drill, { seconds, correct, misses, puzzleId })` accumulates daily totals.

## Hamburger menu items
- **About** — attribution modal
- **History** — Chart.js progress charts (avg time + accuracy per drill)
- **Debug** — raw IDB data table (remove before customer release)

## Threats drill definition
A threat move is a legal move where, after making it, the moved piece:
- Attacks an enemy piece of strictly greater value (lesser attacks greater), OR
- Attacks a loose (zero-defender) enemy piece (free capture next turn), OR
- Sets up checkmate in 1 (colorChar has a mating move available)
Kings are excluded from the first two categories (those are checks).
Pawn promotions to the same square count as one threat move.
The threatening piece's landing square must be safe: no enemy piece of strictly
lesser value may immediately recapture it (same rule as forks v46).
(P=1, N/B=3, R=5, Q=9)
