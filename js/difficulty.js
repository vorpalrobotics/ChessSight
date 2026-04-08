// ─── Difficulty scoring for each drill type ───────────────────────────────────
// All functions return a raw score clamped to [1, 5] (higher = harder).

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Checks drill: check count is the dominant driver.
// Piece density adds only a small bonus scaled to zero when checks are few —
// in a locked pawn structure, lots of pieces don't make zero checks harder.
//   0 checks → 1.0 (Easy)
//   1 check  → 1.5 (Easy)
//   2 checks → 2.0 (Easy)
//   3 checks → 2.6 (Medium)
//   4 checks → 3.2 (Medium)
//   5 checks → 3.8 (Hard)
//   6+ checks → 4.4+ (Hard)
export function scoreChecksDifficulty(fen, totalChecks) {
  const pieceCount = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
  const checkBase  = totalChecks <= 2
    ? 1.0 + totalChecks * 0.5
    : 2.0 + (totalChecks - 2) * 0.6;
  const checkScale = Math.min(1, totalChecks / 3);  // 0 when no checks, 1 at 3+
  const density    = Math.max(0, (pieceCount - 12) * 0.05) * checkScale;
  return clamp(checkBase + density, 1, 5);
}

// Knight Route: driven by path length + pawn obstacles.
export function scoreKnightDifficulty({ optimalDist, whitePawns, blackPawns }) {
  const distBase  = (optimalDist - 2) / 4 * 3;   // dist 2→0 … dist 6→3
  const wPenalty  = whitePawns.size * 0.15;        // max ~1.2
  const bPenalty  = blackPawns.size * 0.25;        // max ~2.0
  return clamp(1 + distBase + wPenalty + bPenalty, 1, 5);
}

// Count drills (captures / loose / under):
// primary driver is total answer count, secondary is board density + queen presence.
export function scoreCountDifficulty(fen, totalAnswer) {
  const board      = fen.split(' ')[0];
  const pieceCount = board.replace(/[^a-zA-Z]/g, '').length;
  const hasQueen   = /[qQ]/.test(board);
  const base       = totalAnswer * 0.7;
  const density    = Math.max(0, (pieceCount - 12) * 0.08);
  const queenBonus = hasQueen ? 0.4 : 0;
  return clamp(1 + base + density + queenBonus, 1, 5);
}

// Queen Attack: number of valid target squares is the main driver.
export function scoreQueenDifficulty({ valid }) {
  return clamp(0.5 + valid.length * 0.9, 1, 5);
}

// Human-readable label + CSS class.
export function diffLabel(score) {
  if (score < 2.2) return { text: 'Easy',   cls: 'diff-easy'   };
  if (score < 3.6) return { text: 'Medium', cls: 'diff-medium' };
  return             { text: 'Hard',   cls: 'diff-hard'   };
}
