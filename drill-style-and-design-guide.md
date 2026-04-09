# ChessSight — Drill Style & Design Guide

This document captures the UI/UX conventions used across all ChessSight drills.
Future agents should follow these patterns when adding or modifying drills.

---

## 1. Screen Layout & Centering

Every drill screen must be listed in the CSS selector that enforces centering:

```css
#screen-checks, #screen-captures, #screen-loose, #screen-under,
#screen-threats, #screen-queen, #screen-knight,
#screen-discipline, #screen-dlm {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1rem 1rem 1.5rem;
  gap: 0.75rem;
}
```

**If you add a new drill screen and it is not in this list, the board will be left-aligned instead of centered.**

All child elements that should match the board width use:
```css
max-width: calc(var(--board-size) + 4px);
width: 100%;
```

This applies to `.drill-top`, `.drill-current-stats`, `.disc-panel`, etc.

### Board size

```css
--board-size: min(600px, 90vw, calc(100vh - 280px));
```

This caps at 600px on large screens, scales with viewport width on narrow screens,
and leaves ~280px of vertical space for surrounding UI elements.

### Standard drill structure (top → bottom)

1. `.drill-top` — drill name (left) + session stats / DONE button (right)
2. `.drill-board-wrap > div#X-board` — the chessboard
3. `.drill-current-stats` — puzzle timer, miss counter, SHOW button (count/click drills)
4. `.answer-row` or `.disc-panel` — digit buttons or phase-specific controls
5. `.drill-rule` / `<p class="drill-rule">` — muted explanatory text, 0.75rem

---

## 2. The `drill-top` Bar

```html
<div class="drill-top">
  <div class="drill-top-left">
    <h2>Drill Name</h2>
    <span id="X-puzzle-num">#1</span>          <!-- puzzle counter -->
    <span id="X-diff" class="drill-difficulty"></span>  <!-- optional difficulty badge -->
  </div>
  <div class="drill-top-right">
    <span id="X-session-time" class="session-stat"></span>  <!-- avg time -->
    <span id="X-session-acc"  class="session-stat"></span>  <!-- accuracy % -->
    <button id="btn-X-done">DONE</button>
  </div>
</div>
```

- `h2` is accent-red (`var(--accent)`), 1.1rem, white-space: nowrap.
- Session stats are muted/monospace, updated after each puzzle.
- The DONE / SHOW / Resign buttons sit in `.drill-top-right`.

---

## 3. Feedback Color Conventions

### Button-based answers (digit buttons in Count Checks / Count Captures)

| State | CSS class | Color |
|-------|-----------|-------|
| Unselected | *(default)* | Dark bg, muted border |
| Hovered | — | `#1a5ca8` blue |
| Selected (pending) | `.selected` | `#3a9fd0` blue |
| Correct answer clicked | `.correct` | `#27ae60` green |
| Wrong answer clicked | `.wrong` / `.incorrect` | `#8b1a2a` / `#6e1b1b` dark red |

**Key rule:** A correct click turns green immediately on click, not on submit.
A wrong click turns red immediately and **stays red** across retries — the persistent
red is intentional negative reinforcement showing the user made a miss that turn.

When both sides are answered correctly, the correct buttons gain `.pulsing` and
animate green for ~2 seconds before auto-advancing:

```css
@keyframes disc-correct-pulse {
  0%, 100% { background: #27ae60; box-shadow: none; }
  50%       { background: #52d68a; box-shadow: 0 0 8px #52d68a; }
}
.disc-digit-btn.correct.pulsing {
  animation: disc-correct-pulse 0.5s ease-in-out infinite;
}
```

`resetDigitRow()` must clear `selected`, `correct`, `wrong`, and `pulsing` classes.

### SVG board-square overlays

SVG `<rect>` elements are appended directly to the board's `<svg>` with a
`data-disc-sq` (or `data-X-sq`) attribute so they can be bulk-removed.

| Meaning | CSS class | Color |
|---------|-----------|-------|
| Correct square clicked | `.loose-sq-found`, `.queen-sq-correct`, `.dlm-sq-found` | Green semi-transparent |
| Missed/wrong square | `.loose-sq-missed` | Red, pulsing red↔orange |
| Invalid click | `.loose-sq-invalid`, `.dlm-sq-invalid` | Red flash, fades out |
| Solution reveal (correct) | `.queen-sq-correct` | Green semi-transparent |
| Solution reveal (wrong) | `.queen-sq-incorrect`, `.queen-sq-flash` | Red, pulsing |

Pulsing missed squares:
```css
@keyframes disc-missed-flash {
  0%, 100% { fill: rgba(220, 50, 50, 0.55); stroke: #dc3232; }
  50%       { fill: rgba(230, 130, 0, 0.55); stroke: #e68200; }
}
.loose-sq-missed { animation: disc-missed-flash 0.5s ease-in-out infinite; }
```

Invalid-click squares use a one-shot `flash-red` animation that fades and
removes itself after ~0.5–0.6s. Do not use infinite animation for invalid clicks.

---

## 4. Advancing to the Next Puzzle / Phase

There are three patterns depending on the drill type:

### 4a. Auto-advance (all items found, no misses)

Used when the answer is unambiguous and the user got everything right.

- **Count drills (checks, captures):** both digit rows correct → 2-second green
  pulse → auto-advance to next phase / puzzle. No submit button needed.
- **Loose pieces (all found):** DONE clicked → found squares pulse green 2s →
  auto-advance to next phase.
- **Spiral Vision / Queen Attack (all squares found):** auto-advance immediately
  (no delay needed; the last correct click triggers it).

### 4b. Click-to-continue (misses occurred)

Used when there are missed items the user needs to see before continuing.

- An SVG text overlay "Click to continue" appears centered on the board.
- A `waitingXContinue` flag is set to `true`.
- The relevant board-click handler checks the flag first and handles the
  continue action before processing normal click logic.
- **Critically:** the DONE button (if still visible) must also check the flag
  so a second DONE press works as a continue. Users naturally tap DONE again.

Example (`looseDone` in `discipline.js`):
```javascript
function looseDone() {
  if (waitingLooseContinue) {          // second DONE tap → continue
    waitingLooseContinue = false;
    clearContinueMsg(); clearSqMarks(); setFeedback('');
    if (isGameActive) enterPhase(PHASE.CANDIDATES);
    return;
  }
  // ... normal DONE logic
  if (missed === 0) {
    flashFoundSquares();
    setTimeout(() => { clearSqMarks(); enterPhase(PHASE.CANDIDATES); }, 2000);
  } else {
    showContinueMsg();
    waitingLooseContinue = true;
  }
}
```

### 4c. SHOW button (solution reveal)

Used in drills where the user explicitly requests the answer.

- Clicking SHOW reveals correct squares (green) and missed squares (red/pulsing).
- After the reveal the drill auto-advances after a short delay, OR uses
  click-to-continue if the set of missed items is large enough to warrant review.
- SHOW increments the miss counter.

---

## 5. Positive vs. Negative Reinforcement

| Scenario | Feedback |
|----------|----------|
| All correct, no misses | Green pulse animation on all correct items, then auto-advance |
| Some missed | **Only** missed items flash (red/orange pulse). Correct items stay static so red draws full visual attention |
| Wrong digit clicked | Button turns dark red, stays red — shows the user had a miss this turn |
| Wrong board square clicked | One-shot red flash on that square, fades immediately |

This asymmetry is intentional: green is rewarding and fleeting; red is persistent
and attention-grabbing. Do not show green on correct items at the same time as
showing red on missed items — the red loses impact.

---

## 6. Drill-specific Patterns

### Count Checks / Count Captures (count drills)
- 0–9 digit buttons per color (White / Black rows).
- Click correct digit → green. Click wrong → red (stays). Both correct → 2s green
  pulse → auto-advance. No SUBMIT button.
- `checksFirstTry` / `capsFirstTry` incremented only if no wrong clicks that turn.
- Miss counters increment at click time, not submit time.

### Loose Pieces / Underguarded (board-click drills)
- User clicks squares on board; marks appear in real-time.
- Click already-marked square → un-marks it (toggle).
- Click wrong square → one-shot red flash, miss counted.
- DONE reveals missed squares in red pulsing; if none missed, flashes found
  squares green for 2s and auto-advances. If any missed, waits for click.

### Queen Attack / Spiral Vision (queen-placement drills)
- User clicks empty squares to place a notional queen.
- Wrong click → one-shot red flash on that square.
- Last correct click triggers auto-advance (no explicit DONE needed).
- SHOW reveals: correct squares green, missed squares pulsing red.
- Spiral Vision: 63-position spiral session with cumulative timer; stores
  `elapsed / 63` (seconds per position) in history for chart comparability.

### Knight Route
- User clicks a path of squares; each click highlights the route.
- Feedback on completion, not per-click.

### Move Discipline (phase-based full game)
- Sequential phases per player turn: Checks → Captures → Loose → Candidates → Move.
- Phase indicator shows `STEP N / 4 — DESCRIPTION` at 1.1rem.
- Digit buttons for counts (same green/red pattern as count drills).
- Loose phase uses board-click pattern with DONE button.
- Candidates phase shows a checklist and enables board move input immediately
  (no "Done Thinking" button — the act of moving ends the phase).
- Single legal move: skip all phases, show message, enable board input.
- BOOK button (first 5 turns): skips all discipline phases for that turn.

---

## 7. Typography Scale

| Element | Size | Notes |
|---------|------|-------|
| Header h1 | 1.5rem | Accent red |
| Drill heading h2 | 1.1rem | Accent red, in `.drill-top-left` |
| Phase indicator | 1.1rem | Bold, muted, letter-spaced |
| Session stats | 0.8rem | Muted, monospace |
| Panel labels / questions | 0.85–1rem | Centered |
| Candidates checklist | 1rem | Left-aligned, `line-height: 1.9` |
| Candidates CTA | 1.1rem | Bold, accent red, centered |
| `drill-rule` explanatory text | 0.75rem | Muted, centered, wrapping |
| Attribution lines | 0.7rem | Muted, italic |
| Version label | 0.62rem | Muted, monospace |

---

## 8. CSS Custom Properties

```css
:root {
  --bg:        #1a1a2e;   /* page background */
  --surface:   #16213e;   /* header / card surface */
  --surface2:  #0f3460;   /* border / secondary surface */
  --accent:    #e94560;   /* red: headings, CTAs, errors */
  --text:      #eaeaea;   /* primary text */
  --text-muted:#888;      /* secondary text, labels */
  --white-side:#f0d9b5;   /* light square color */
  --black-side:#2c2c2c;   /* dark square color */
  --board-size: min(600px, 90vw, calc(100vh - 280px));
}
```

---

## 9. Common Gotchas

- **New screen not centered?** Add its `#screen-X` id to the drill screen
  CSS selector (see Section 1).
- **`initDrill` crashes on load?** An `addEventListener` call references an
  element that was removed from the HTML. Check for stale button IDs.
- **Board coordinate mapping with black orientation:** `sqFromClick()` and
  `sqToXY()` must branch on `boardOrientation === COLOR.white` to flip file/rank
  when the player is Black.
- **IDB schema changes:** bump `DB_VERSION` and guard new stores with
  `if (!db.objectStoreNames.contains(storeName))` in `onupgradeneeded`.
- **Version numbers:** update `<title>ChessSight vX.X.N</title>` AND
  `<span class="version-label">vX.X.N</span>` in every commit.
  Also update `CLAUDE.md` **Current version** line.
