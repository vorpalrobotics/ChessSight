// ─── Drill help text ─────────────────────────────────────────────────────────
// One entry per drill. Add a <span class="drill-info-btn" data-help="key">
// inside the matching mode-card in index.html to surface the help button.

export const DRILL_HELP = {
  checks: {
    title: 'Checks Drill',
    body: `<p class=helpText>A position appears with pieces for both sides. Count every legal checking move available for both White and Black.</p>
<p class=helpText>Enter your counts using the number buttons that appear below the board.</p>
<p class=helpText>Note that for pawn promotions, if any possible promotion would give check that just counts once. For example if a pawn could promote to either a queen or bishop to give check that counts as one checks. (If a pawn could promote by either capturing or moving forward, and either a rook or queen would check in both those cases, that counts as two checks because there are two different promotion squares the pawn could move to).</p>
<p class=helpText>For discovered checks every way the piece could move would also count as a separate check, for example if a knight had 8 legal moves and by moving revealed a discovered check that would count for 8 checks.</p>
<p class=helpText>This drill builds the habit of scanning for all checking threats in a position before committing to a move — an essential skill for spotting tactical opportunities.</p>`,
  },

  captures: {
    title: 'Captures Drill',
    body: `<p class=helpText>A position appears with pieces for both sides. Count every legal capturing move available for both White and Black.</p>
<p class=helpText>Enter your count using the number buttons. Once you enter both counts, the position is scored and auto-advances.</p>
<p class=helpText>Every capture counts, including pawn captures, regardless of whether the capture is a good trade or a losing one. En passant captures count too when available. Note that if two different pieces can capture the same opponent's piece that counts as two captures.</p>
<p class=helpText>If a piece is pinned against a King it cannot move, and therefore has no captures, so be careful about this situation.</p>
<p class=helpText>Strong players always know how many captures are on the board before deciding on a move. This drill builds that automatic scanning habit.</p>`,
  },

  loose: {
    title: 'Loose Pieces Drill',
    body: `<p class=helpText>A position appears and you must click every <em>loose</em> piece on the board for both White and Black. Once all loose pieces are clicked, the puzzle is scored and auto-advances.</p>
<p class=helpText>A loose piece is one that has <em>no defenders at all</em>. It doesn't matter whether the piece is currently under attack: if nothing guards it, it's loose and a potential target.</p>
<p class=helpText>Loose pieces are tactical accidents waiting to happen. Noticing them is the first step to avoiding blunders and spotting your opponent's weaknesses.</p>`,
  },

  under: {
    title: 'Underguarded Drill',
    body: `<p class=helpText>A position appears and you must click every <em>underguarded</em> piece for both White and Black. Once all are identified, the position is scored and auto-advances to the next position.</p>
<p class=helpText>A piece is underguarded when <em>the number of pieces defending it is less than or equal to the number of pieces attacking it</em>.</p>
<p class=helpText>Similar to loose pieces, underguarded pieces are vulnerable to being won by a sequence of exchanges or other tactics.</p>
<p class=helpText>Note that a piece is underguarded even if capturing it immediately would lose material. For example, if a Knight is defended only by a pawn and attacked only by a Queen, you wouldn't typically want to make that capture as the Queen would be lost for a Knight. However, the Knight in this example is still considered an underguarded piece, because tactics are more likely to be available in this situation.</p>
<p class=helpText>This drill sharpens your eye for structural weaknesses that often go unnoticed — the foundation for spotting winning exchanges and combination setups.</p>`,
  },

  knight: {
    title: 'Knight Route Drill',
    body: `<p class=helpText>A knight appears on the board along with a target square. Your job is to click the squares that form the <strong>shortest possible route</strong> for the knight to reach the target. There may also be pawns on the board, and you may not capture any enemy pawn or move to any square guarded by an enemy pawn.</p>
<p class=helpText>Click each intermediate square in order. The drill checks whether your chosen path is optimal — not just any path, but a path that has the minimum number of moves necessary. Note that there may be more than one minimal path, you only need to find one of them to solve the position.</p>
<p class=helpText>If your path becomes longer than the optimal path then clicked squares will not be green and each extra square beyond the optimal route is scored as an additional miss.</p>
<p class=helpText>Knights are the trickiest piece to visualize. This drill trains you to instantly see knight distances and outpost routes, which is critical for endgames and piece coordination.</p>`,
  },

  queen: {
    title: 'Queen Attack Drill',
    body: `<p>A queen and several enemy pieces are on the board. Find a single queen move that achieves a <strong>fork</strong>, <strong>pin</strong>, or <strong>skewer</strong> against a rook, bishop, or knight. Once you have identified all such squares, the position is scored and auto-advances.</p>
<p class=helpText>A fork attacks two pieces at once. A pin immobilizes a piece because moving it would expose a more valuable piece behind it. A skewer forces a valuable piece to move, exposing a lesser piece behind it to capture. Note that even pins or skewers where an enemy piece could move to guard the skewered piece will count in this drill, because in a real position this could still lead to winning tactics.</p>
<p class=helpText>The queen is the most powerful tactical piece. This drill builds the pattern recognition to spot queen tactics instantly in real games.</p>`,
  },

  hanggrab: {
    title: 'Hang Grab Drill',
    body: `<p class=helpText>A position appears with a White piece and several Black pieces. Some Black pieces may be <em>hanging</em> (completely undefended), meaning White can capture them for free. Once all hanging pieces are identified, the position is scored and auto-advances.</p>
<p class=helpText>Click every hanging Black piece you can find. If nothing is free to capture, click the <strong>PASS</strong> button instead. Clicking a piece that isn't truly free counts as a miss.</p>
<p class=helpText>Instantly recognizing undefended pieces — and resisting the urge to grab pieces that aren't actually free — is one of the most important practical skills in chess.</p>`,
  },

  bb: {
    title: 'Blunder Buster Drill',
    body: `<p class=helpText>Study the position before Black moves, then tap the board when you're ready. Black will play a move — <em>usually</em> a blunder that leaves a piece hanging.</p>
<p class=helpText>After the move animates, click the piece that Black left undefended. If nothing is actually free to grab, click the PASS button instead.</p>
<p class=helpText>This drill trains an important skill in chess (especially speed chess): instantly spotting the piece your opponent just hung. Unlike the Hang Grab drill, this drill emphasizes noticing what changed due to an opponent's move.</p>`,
  },

  mix: {
    title: 'Mix Drill',
    body: `<p class=helpText>Mix combines several drills into a single randomised session. Use the checkboxes to choose which drill types to include, then start the session.</p>
<p class=helpText>Puzzles from each selected drill appear in random order. This keeps you on your toes — you won't know whether the next puzzle asks you to spot a check, grab a hanging piece, or find a knight route until it appears. The drill type is announced with a large animated label so you can't miss it.</p>
<p class=helpText>The <strong>Positions in Mixed Drill</strong> field shows how many puzzles the session will run. It defaults automatically based on the <em>Positions per drill</em> and <em>Multiply positions for Mix Drill</em> settings, but you can change it before starting.</p>`,
  },

  memory: {
    title: 'Memory Drill',
    body: `<p>A position is shown for a few seconds, then the board is cleared. Your job is to reconstruct the position by dragging pieces to their correct positions.</p>
<p class=helpText>Select the piece type from the panel, then click the destination square. Repeat until you've placed everything you remember. The drill then reveals the original position so you can compare.</p>
<p class=helpText>Calculation starts with the ability to hold a position accurately in your mind. This drill builds the mental board that strong players use to calculate variations.</p>`,
  },

  dlm: {
    title: 'Spiral Vision Drill',
    body: `<p class=helpText>Inspired by Michael de La Maza's book <em>Rapid Chess Improvement</em>, this drill presents 63 board positions one at a time. For each position, find every <strong>queen fork</strong>, <strong>pin</strong>, and <strong>skewer</strong> that White's queen can deliver.</p>
<p class=helpText>Click each target square where the queen could be placed to execute a tactic. If no such move exists, click <strong>PASS</strong>. Work through all 63 positions as quickly and accurately as possible.</p>
<p class=helpText>Repeated cycles of these positions build deep, automatic pattern recognition for the most common queen tactics — the same patterns that appear over and over in real games at every level.</p>
<p class=helpText>(Note: this drill is slightly different from the La Maza version because it also asks you to find pins in addition to forks and skewers. La Maza recommended doing his version of this drill every day for 14 consencutive days.)`,
  },

  discipline: {
    title: 'Move Discipline Drill',
    body: `<p class=helpText>Play a full game against the computer engine, but with a structured thinking requirement before every move: count the checks, captures, and loose pieces available to both sides.</p>
    <p class=helpText>This is time consuming but will help build habits that will become automatic and fast with practice.</p>
<p class=helpText>Before each move you must complete the three tactical scans. This enforces the habit of systematic board evaluation — the core of what grandmasters call the <em>thought process</em>.</p>
<p class=helpText>For early moves you may tap the BOOK button to skip the analysis phases. Later in the game if the position becomes trivial, like a simple ladder mate, you can click the SKIP button.</p>
<p class=helpText>If you tap END DRILL and a level 20 engine evaluates that the position is two pawns or more in the opponent's favor this will count as a loss. You may also tap RESIGN to explicitly resign the position.</p>
<p class=helpText>Many blunders happen because players move without checking what threats exist (their own or their opponents). This drill makes thorough scanning automatic, so you never overlook a tactic again.</p>`,
  },

  history: {
    title: 'History',
    body: `<p class=helpText>History shows charts of your drill performance over time. The Graph tab shows two charts: <strong>average time per puzzle</strong> (lower is better) and <strong>accuracy</strong> as a percentage of first-try correct answers (higher is better).</p>
<p class=helpText>Each data point represents one day's session. Use this to track improvement over weeks and spot which drills need more attention.</p>
<p class=helpText>The Radar tab gives a quick snapshot of your relative accuracy across all drills as an average over the time period you select.</p>
<p class=helpText>The Goals tab allows you to set goals on your performance, and after each session will trigger a message if you met your goal.`,
  },

  settings: {
    title: 'Settings',
    body: `<p class=helpText><strong>Positions per drill</strong> sets how many puzzles are served before the session ends and you see the summary screen. Set it to Unlimited to keep drilling until you tap END DRILL manually.</p>
<p class=helpText><strong>Multiply positions for Mix Drill</strong> — when checked, the Mix drill automatically multiplies the Positions per drill value by the number of drill types you select. For example, if Positions per drill is 5 and you select 4 drill types, the Mix session will run for 20 puzzles. This way each drill type gets roughly equal representation. You can always override the final count on the Mix selection screen before starting.</p>
<p class=helpText>Settings are saved locally in your browser and persist between sessions.</p>`,
  },

  cloudsync: {
    title: 'Cloud Sync',
    body: `<p class=helpText>Cloud Sync connects ChessSight to your Vimsy account so your drill history is backed up and available across devices. Sign in with your Google account to enable sync.</p>
<p class=helpText>Once connected, you may tap <strong>Sync to Vimsy</strong> to upload today's results, however Chess Sight will upload automatically from time to time. The log below the button shows the status of recent sync attempts and can be helpful for debugging any syncing issues.</p>
<p class=helpText>Your data is stored privately under your Google firebase account and is not shared with other users.</p>`,
  },

  drillButtonInfo: {
    title: 'Other Drill Buttons',
    body: `<p class=helpText>These buttons are common to drills:</p>
    <ul>
    <li>⏸(pause): Allows you to pause the current position, in case you get interupted and want to stop the timer.</li>
    <li>END DRILL: Ends the drill and shows the summary screen for any positions you have completed. The current position won't count. Use this if you are done with the session earlier than your "Positions per drill" setting.</li>
    <li>← Back: The BACK button is like END DRILL but it immediately goes back to the main screen without showing a summary of any positions you have completed.</li>
    <li>SHOW: Most drills have a SHOW button that will show you the solution in case you're stuck. However, any solution you have not found is marked as a miss for scoring purposes if you use the SHOW button.</li>`,
  }
};

// ─── Drill walkthrough steps ──────────────────────────────────────────────────
// DRILL_WALKTHROUGH holds drill-specific intro steps keyed by drill name.
// common holds steps shared by nearly every drill; targets use {drill} as a
// placeholder that buildWalkthrough() replaces with the actual drill key.
//
// Step shape: { text, target?, arrowAlign? }
//   target:     CSS selector to spotlight (null = centred dark overlay)
//   arrowAlign: 'center-right' (62%) | 'right' (75%) | 'far-right' (85%) | omit for centred

export const DRILL_WALKTHROUGH = {

  // ── Shared steps appended to every drill walkthrough ─────────────────────
  common: [
    {
      text: 'Stuck? Tap <strong>SHOW</strong> to reveal the answer — anything you hadn\'t solved yet will be marked as a miss.',
      target: '#btn-{drill}-show',
      arrowAlign: 'right',
    },
    {
      text: 'Phone ringing? Press the <strong>⏸</strong> button to stop the clock until you\'re free.',
      target: '#screen-{drill} .drill-pause-btn',
      arrowAlign: 'right',
    },
    {
      text: 'Done? Tap <strong>END DRILL</strong> to finish this run. (Your run will also end when the "Positions per Drill" setting is reached.)',
      target: '#btn-{drill}-done',
      arrowAlign: 'far-right',
    },
  ],

  // ── Drill-specific intro steps ────────────────────────────────────────────
  checks: [
    {
      text: 'Count every legal checking move available for <strong>both White and Black</strong> — not just one side!',
      target: null,
    },
    {
      text: 'Tap a number to enter White\'s check count as well as Black\'s. The puzzle scores automatically once both counts are entered.',
      target: '#screen-checks .drill-answer-panel',
    },
  ],

  captures: [
    {
      text: 'Count every legal capturing move available for <strong>both White and Black</strong> — not just one side!',
      target: null,
    },
    {
      text: 'Tap a number to enter White\'s capture count as well as Black\'s. The puzzle scores automatically once both counts are entered.',
      target: '#screen-captures .drill-answer-panel',
    },
  ],

  loose: [
    {
      text: 'A <strong>loose piece</strong> has zero defenders — it doesn\'t matter whether it\'s currently under attack. If nothing guards it, it\'s loose.',
      target: null,
    },
    {
      text: 'Tap directly on every loose piece you see, for <strong>both sides</strong>. The puzzle scores and advances once all loose pieces are found.',
      target: null,
    },
  ],

  under: [
    {
      text: 'An <strong>underguarded piece</strong> has fewer defenders than attackers. Even one attacker with no defenders counts — it\'s a weakness waiting to be exploited.',
      target: null,
    },
    {
      text: 'Tap directly on every underguarded piece you see, for <strong>both sides</strong>. The puzzle scores and advances once all are found.',
      target: null,
    },
  ],

  knight: [
    {
      text: 'A knight needs to reach the highlighted target square. Find the <strong>shortest possible route</strong> — the fewest moves to get there. There may be more than one shortest path; you just need to find one.',
      target: null,
    },
    {
      text: 'Tap each square the knight passes through, in order. Squares light up <strong>green</strong> as long as your route stays optimal. If the highlights stop, you\'ve gone longer than the shortest path.',
      target: null,
    },
    {
      text: 'If enemy pawns are on the board, you can\'t land on any square they guard — and you can\'t capture them either. Route around them.',
      target: null,
    },
  ],

  queen: [
    {
      text: 'Find every square the queen can move to in order to deliver a <strong>fork</strong> (attacks both the king and the other piece), <strong>pin</strong> (the piece can\'t move without exposing the king behind it), or <strong>skewer</strong> (checks the king, forcing it to move and expose the piece behind it). Click each target square on the board — the puzzle auto-advances once all are found.',
      target: null,
    },
    {
      text: 'If you think there are no solutions, tap <strong>PASS</strong>.',
      target: '#btn-queen-complete',
      arrowAlign: 'right',
    },
  ],
};

// Returns the full step list for a drill: drill-specific steps followed by
// the common steps with {drill} placeholders resolved.
export function buildWalkthrough(drillKey) {
  const specific = DRILL_WALKTHROUGH[drillKey] ?? [];
  const common   = DRILL_WALKTHROUGH.common.map(step => ({
    ...step,
    target: step.target?.replace('{drill}', drillKey) ?? null,
  }));
  return [...specific, ...common];
}
