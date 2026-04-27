// ─── Drill help text ─────────────────────────────────────────────────────────
// One entry per drill. Add a <span class="drill-info-btn" data-help="key">ⓘ</span>
// inside the matching mode-card in index.html to surface the help button.

export const DRILL_HELP = {
  checks: {
    title: 'Checks Drill',
    body: `<p>A position appears with pieces for both sides. Count every legal checking move available — first for White, then for Black.</p>
<p>Enter your count using the number buttons that appear below the board. Discovered checks and double checks each count as one checking move. Only moves that put the opponent's king in check right now count — not moves that merely threaten a future check.</p>
<p>This drill builds the habit of scanning for all checking threats in a position before committing to a move — an essential skill for spotting tactical opportunities.</p>`,
  },

  // captures: { title: 'Captures Drill', body: `...` },
  // loose:    { title: 'Loose Pieces Drill', body: `...` },
  // under:    { title: 'Underguarded Drill', body: `...` },
  // knight:   { title: 'Knight Vision Drill', body: `...` },
  // queen:    { title: 'Queen Vision Drill', body: `...` },
  // hanggrab: { title: 'Hang Grab Drill', body: `...` },
  // bb:       { title: 'Blunder Buster Drill', body: `...` },
  // mix:      { title: 'Mix Drill', body: `...` },
  // memory:   { title: 'Memory Drill', body: `...` },
  // dlm:      { title: 'Spiral Vision Drill', body: `...` },
};
