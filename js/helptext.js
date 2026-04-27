// ─── Drill help text ─────────────────────────────────────────────────────────
// One entry per drill. Add a <span class="drill-info-btn" data-help="key">
// inside the matching mode-card in index.html to surface the help button.

export const DRILL_HELP = {
  checks: {
    title: 'Checks Drill',
    body: `<p>A position appears with pieces for both sides. Count every legal checking move available — first for White, then for Black.</p>
<p>Enter your count using the number buttons that appear below the board. Discovered checks and double checks each count as one checking move. Only moves that put the opponent's king in check right now count — not moves that merely threaten a future check.</p>
<p>This drill builds the habit of scanning for all checking threats in a position before committing to a move — an essential skill for spotting tactical opportunities.</p>`,
  },

  captures: {
    title: 'Captures Drill',
    body: `<p>A position appears with pieces for both sides. Count every legal capturing move available — first for White, then for Black.</p>
<p>Enter your count using the number buttons. Every capture counts, including pawn captures, regardless of whether the capture is a good trade or a losing one. En passant captures count too when available.</p>
<p>Strong players always know how many captures are on the board before deciding on a move. This drill builds that automatic scanning habit.</p>`,
  },

  loose: {
    title: 'Loose Pieces Drill',
    body: `<p>A position appears and you must click every <em>loose</em> piece on the board — first all of White's loose pieces, then all of Black's (or vice versa, as prompted).</p>
<p>A loose piece is one that has <strong>no defenders at all</strong>. It doesn't matter whether the piece is currently under attack — if nothing guards it, it's loose and a potential target.</p>
<p>Loose pieces are tactical accidents waiting to happen. Keeping track of them is the first step to avoiding blunders and spotting your opponent's weaknesses.</p>`,
  },

  under: {
    title: 'Underguarded Drill',
    body: `<p>A position appears and you must click every <em>underguarded</em> piece — first for White, then for Black (or vice versa).</p>
<p>A piece is underguarded when the number of pieces defending it is less than the number of pieces attacking it. Such pieces are vulnerable to being won by a sequence of exchanges.</p>
<p>This drill sharpens your eye for structural weaknesses that often go unnoticed — the foundation for spotting winning exchanges and combination setups.</p>`,
  },

  knight: {
    title: 'Knight Route Drill',
    body: `<p>A knight appears on the board along with a target square. Your job is to click the squares that form the <strong>shortest possible route</strong> for the knight to reach the target.</p>
<p>Click each intermediate square in order. The drill checks whether your chosen path is optimal — not just any path, but the minimum number of moves.</p>
<p>Knights are the trickiest piece to visualize. This drill trains you to instantly see knight distances and outpost routes, which is critical for endgames and piece coordination.</p>`,
  },

  queen: {
    title: 'Queen Attack Drill',
    body: `<p>A queen and several enemy pieces are on the board. Find a single queen move that achieves a <strong>fork</strong>, <strong>pin</strong>, or <strong>skewer</strong> against a rook, bishop, or knight.</p>
<p>A fork attacks two pieces at once. A pin immobilizes a piece because moving it would expose a more valuable piece behind it. A skewer forces a valuable piece to move, exposing a lesser piece behind it to capture.</p>
<p>The queen is the most powerful tactical piece. This drill builds the pattern recognition to spot queen tactics instantly in real games.</p>`,
  },

  hanggrab: {
    title: 'Hang Grab Drill',
    body: `<p>A position appears with a White piece and several Black pieces. Some Black pieces may be <em>hanging</em> — meaning White can capture them for free (no recapture possible).</p>
<p>Click every hanging Black piece you can find. If nothing is free to capture, click the <strong>PASS</strong> button instead. Clicking a piece that isn't truly free counts as a miss.</p>
<p>Instantly recognizing undefended pieces — and resisting the urge to grab pieces that aren't actually free — is one of the most important practical skills in chess.</p>`,
  },

  bb: {
    title: 'Blunder Buster Drill',
    body: `<p>Study the position before Black moves, then tap the board when you're ready. Black will play a move — a blunder that leaves a piece hanging.</p>
<p>After the move animates, click the piece that Black left undefended. If the position is a <strong>PASS</strong> (nothing is actually free to grab), click the PASS button instead.</p>
<p>This drill trains the most important defensive skill in chess: spotting the piece your opponent just hung. Missing a free piece is one of the most common — and most avoidable — mistakes at every level.</p>`,
  },

  mix: {
    title: 'Mix Drill',
    body: `<p>Mix combines several drills into a single randomised session. Use the checkboxes to choose which drill types to include, then start the session.</p>
<p>Puzzles from each selected drill appear in random order. This keeps you on your toes — you won't know whether the next puzzle asks you to spot a check, grab a hanging piece, or find a knight route until it appears.</p>
<p>Mixed practice is the most realistic training mode because real games don't announce which tactic is coming next.</p>`,
  },

  memory: {
    title: 'Memory Drill',
    body: `<p>A position is shown for a few seconds, then the board is cleared. Your job is to reconstruct the position by clicking squares to place each piece back where it was.</p>
<p>Select the piece type from the panel, then click the destination square. Repeat until you've placed everything you remember. The drill then reveals the original position so you can compare.</p>
<p>Board vision and piece coordination start with the ability to hold a position in your mind. This drill builds the mental board that strong players use to calculate variations.</p>`,
  },

  dlm: {
    title: 'Spiral Vision Drill',
    body: `<p>Inspired by Michael de La Maza's <em>Rapid Chess Improvement</em>, this drill presents 64 board positions one at a time. For each position, find every <strong>queen fork</strong>, <strong>pin</strong>, and <strong>skewer</strong> that White's queen can deliver.</p>
<p>Click each target square where the queen can land to execute a tactic. If no such move exists, click <strong>No Solution</strong>. Work through all 64 positions as quickly and accurately as possible.</p>
<p>Repeated cycles of these positions build deep, automatic pattern recognition for the most common queen tactics — the same patterns that appear over and over in real games at every level.</p>`,
  },

  discipline: {
    title: 'Move Discipline Drill',
    body: `<p>Play a full game against the computer engine, but with a structured thinking requirement before every move: count the checks, captures, and loose pieces available to both sides.</p>
<p>Before each move you must complete the three tactical scans. This enforces the habit of systematic board evaluation — the core of what grandmasters call the <em>thought process</em>.</p>
<p>Most blunders happen because players move without checking what threats exist. This drill makes thorough scanning automatic, so you never overlook a tactic again.</p>`,
  },
};
