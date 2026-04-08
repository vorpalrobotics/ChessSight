import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { upsertDrillDay } from './storage.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function fileOf(sq) { return sq.charCodeAt(0) - 97; }   // 'a'→0
function rankOf(sq) { return parseInt(sq[1]) - 1; }      // '1'→0 (0-indexed)
function sqName(f, r) { return String.fromCharCode(97 + f) + (r + 1); }

// Squares strictly between sq1 and sq2 along the same rank/file/diagonal.
// Returns [] if not collinear or adjacent.
function squaresBetween(sq1, sq2) {
  const f1 = fileOf(sq1), r1 = rankOf(sq1);
  const f2 = fileOf(sq2), r2 = rankOf(sq2);
  const df = f2 - f1, dr = r2 - r1;
  if (df === 0 && dr === 0) return [];
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return [];
  const steps = Math.max(Math.abs(df), Math.abs(dr));
  const sf = Math.sign(df), sr = Math.sign(dr);
  const result = [];
  for (let i = 1; i < steps; i++) result.push(sqName(f1 + i * sf, r1 + i * sr));
  return result;
}

// Does a queen (any line) at `from` attack `to`, with `occupied` squares blocking?
function lineAttacks(from, to, occupied) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (df === 0 && dr === 0) return false;
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return false;
  return !squaresBetween(from, to).some(sq => occupied.has(sq));
}

// Does a rook (rank/file only) at `from` attack `to`, with `occupied` squares blocking?
function rookAttacks(from, to, occupied) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (df !== 0 && dr !== 0) return false;
  return lineAttacks(from, to, occupied);
}

// Is `mid` strictly between `a` and `b` on the same line?
function isBetween(mid, a, b) {
  return squaresBetween(a, b).includes(mid);
}

// Chebyshev distance 1 — king can step there
function isAdjacent(sq1, sq2) {
  return Math.max(
    Math.abs(fileOf(sq1) - fileOf(sq2)),
    Math.abs(rankOf(sq1) - rankOf(sq2))
  ) === 1;
}

// ─── Valid square logic ────────────────────────────────────────────────────────

// Returns all squares S where the queen creates a tactical threat:
//   A. Fork   — queen at S attacks king AND rook simultaneously (different lines)
//   B. Skewer — king is between S and rook (queen checks king; rook exposed on king's retreat)
//   C. Pin    — rook is between S and king on the same line (diagonal pins pass condition 3;
//               rank/file "pins" are automatically excluded because the rook would attack S)
//
// Always required:
//   1. Queen can reach S from its starting square (king/rook may block the path)
//   2. S is not adjacent to the king (king cannot capture the queen there)
//   3. Rook cannot immediately recapture (rook attacks S only along ranks/files; king may block)
function computeValidSquares(queenSq, kingSq, rookSq) {
  const valid = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const s = sqName(f, r);
      if (s === queenSq || s === kingSq || s === rookSq) continue;

      // 1. Queen can reach s (path clear of king and rook)
      if (!lineAttacks(queenSq, s, new Set([kingSq, rookSq]))) continue;

      // 2. King cannot capture the queen at s
      if (isAdjacent(s, kingSq)) continue;

      // 3. Rook cannot immediately recapture (king may block along rook's rank/file)
      if (rookAttacks(rookSq, s, new Set([kingSq]))) continue;

      // A. Fork: queen at s directly attacks both king and rook
      const attacksKing = lineAttacks(s, kingSq, new Set([rookSq]));
      const attacksRook = lineAttacks(s, rookSq, new Set([kingSq]));
      if (attacksKing && attacksRook) { valid.push(s); continue; }

      // B. Skewer: king between s and rook on same line
      //    Queen checks king; rook is exposed when king moves away.
      if (isBetween(kingSq, s, rookSq)) { valid.push(s); continue; }

      // C. Pin: rook between s and king on same line
      //    Rank/file cases fail condition 3 (rook attacks s); diagonal cases pass.
      if (isBetween(rookSq, s, kingSq)) { valid.push(s); continue; }
    }
  }
  return valid;
}

// ─── FEN builder ──────────────────────────────────────────────────────────────

// Builds a display FEN with just the three pieces (no kings required for rendering).
function buildFen(queenSq, kingSq, rookSq) {
  const pieces = { [queenSq]: 'Q', [kingSq]: 'k', [rookSq]: 'r' };
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pieces[sqName(file, rank)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; } else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' w - - 0 1';
}

// ─── Position generator ───────────────────────────────────────────────────────

const ALL_SQS = [];
for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) ALL_SQS.push(sqName(f, r));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generatePosition() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const [kingSq, rookSq, queenSq] = shuffle(ALL_SQS);
    // Queen must not currently attack king or rook
    if (lineAttacks(queenSq, kingSq, new Set([rookSq]))) continue;
    if (lineAttacks(queenSq, rookSq, new Set([kingSq]))) continue;
    const valid = computeValidSquares(queenSq, kingSq, rookSq);
    if (valid.length > 0) return { queenSq, kingSq, rookSq, valid };
  }
  // Fallback: verified position — queen h1, king e5, rook e8 (h5 is a fork square)
  const q = 'h1', k = 'e5', r = 'e8';
  return { queenSq: q, kingSq: k, rookSq: r, valid: computeValidSquares(q, k, r) };
}

// ─── Module state ─────────────────────────────────────────────────────────────

let board = null;
let timerInterval = null;
let seconds = 0;
let misses = 0;
let puzzleActive = false;
let puzzleCount = 0;
let currentQueenSq = '';
let currentKingSq = '';
let currentRookSq = '';
let currentValid = [];       // valid squares for current puzzle
let foundSquares = new Set();
let markedSquares = new Set(); // all squares already given feedback (avoid re-marking)
let waitingToAdvance = false;
const drillResults = [];
let navigate = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function initQueenAttack(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-queen-done').addEventListener('click', showSummary);
  document.getElementById('btn-queen-complete').addEventListener('click', handleComplete);
  document.getElementById('queen-board').addEventListener('click', handleBoardClick);
}

export function startQueenAttack() {
  resetDrill();
  loadNextPuzzle();
}

// ─── Puzzle loading ───────────────────────────────────────────────────────────

function loadNextPuzzle() {
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('queen-puzzle-num').textContent = `#${puzzleCount}`;

  const pos = generatePosition();
  currentQueenSq = pos.queenSq;
  currentKingSq  = pos.kingSq;
  currentRookSq  = pos.rookSq;
  currentValid   = pos.valid;

  const fen = buildFen(pos.queenSq, pos.kingSq, pos.rookSq);

  if (!board) {
    board = new Chessboard(document.getElementById('queen-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    board.setPosition(fen, false);
  }

  if (currentValid.length === 0) setStatus('No valid squares — click COMPLETE.');

  puzzleActive = true;
  startTimer();
}

// ─── Board click handler ──────────────────────────────────────────────────────

function handleBoardClick(e) {
  if (waitingToAdvance) { loadNextPuzzle(); return; }
  if (!puzzleActive) return;
  const boardEl = document.getElementById('queen-board');
  const rect = boardEl.getBoundingClientRect();
  const xRel = e.clientX - rect.left;
  const yRel = e.clientY - rect.top;
  const file = Math.floor(xRel / rect.width * 8);
  const rankIdx = 7 - Math.floor(yRel / rect.height * 8);
  if (file < 0 || file > 7 || rankIdx < 0 || rankIdx > 7) return;
  const sq = sqName(file, rankIdx);

  // Ignore clicks on occupied squares
  if (sq === currentQueenSq || sq === currentKingSq || sq === currentRookSq) return;
  // Ignore already-marked squares
  if (markedSquares.has(sq)) return;
  markedSquares.add(sq);

  if (currentValid.includes(sq)) {
    foundSquares.add(sq);
    drawMark(sq, 'queen-sq-correct');
  } else {
    misses++;
    document.getElementById('queen-misses').textContent = `Misses: ${misses}`;
    drawMark(sq, 'queen-sq-incorrect');
  }
}

// ─── COMPLETE button ──────────────────────────────────────────────────────────

function handleComplete() {
  if (!puzzleActive) return;
  finishPuzzle();
}

function finishPuzzle() {
  puzzleActive = false;
  stopTimer();

  const missed = currentValid.filter(sq => !foundSquares.has(sq));
  misses += missed.length;
  document.getElementById('queen-misses').textContent = `Misses: ${misses}`;

  const found = foundSquares.size;
  const total = currentValid.length;
  drillResults.push({ seconds, correct: found, misses });
  upsertDrillDay('queen', { seconds, correct: found, misses, puzzleId: `${currentQueenSq}-${currentKingSq}-${currentRookSq}` });
  updateSessionStats();

  const el = document.getElementById('queen-result');
  el.textContent = `✓ ${formatTime(seconds)} · ${found}/${total} squares · ${misses} miss${misses !== 1 ? 'es' : ''}`;
  el.classList.remove('hidden');

  if (missed.length > 0) {
    missed.forEach(sq => drawMark(sq, 'queen-sq-missed'));
    setStatus('Click anywhere to continue.');
    waitingToAdvance = true;
  } else {
    loadNextPuzzle();
  }
}

// ─── SVG square overlay ───────────────────────────────────────────────────────

function drawMark(sq, cssClass) {
  const boardEl = document.getElementById('queen-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return;

  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;

  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]);
  const x = file * sqSize;
  const y = (8 - rank) * sqSize;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);
  rect.setAttribute('y', y + 2);
  rect.setAttribute('width', sqSize - 4);
  rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-sq', sq);
  svg.appendChild(rect);
}

function clearMarks() {
  const boardEl = document.getElementById('queen-board');
  if (boardEl) boardEl.querySelectorAll('.queen-sq-correct,.queen-sq-incorrect,.queen-sq-missed')
    .forEach(el => el.remove());
}

// ─── Session stats ────────────────────────────────────────────────────────────

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses  = drillResults.reduce((s, r) => s + r.misses, 0);
  const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
  const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('queen-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('queen-session-acc').textContent  = `Acc ${accuracy}%`;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function showSummary() {
  stopTimer();
  document.getElementById('btn-summary-again').onclick = restartDrill;
  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  if (count > 0) {
    const avgTime = drillResults.reduce((s, r) => s + r.seconds, 0) / count;
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses, 0);
    const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
    document.getElementById('stat-avg-time').textContent = formatTime(Math.round(avgTime));
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

function restartDrill() {
  navigate('screen-queen');
  resetDrill();
  loadNextPuzzle();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function resetDrill() {
  puzzleCount = 0;
  drillResults.length = 0;
  document.getElementById('queen-session-time').textContent = '';
  document.getElementById('queen-session-acc').textContent  = '';
}

function resetUI() {
  misses = seconds = 0;
  waitingToAdvance = false;
  foundSquares.clear();
  markedSquares.clear();
  clearMarks();
  document.getElementById('queen-timer').textContent  = '0:00';
  document.getElementById('queen-misses').textContent = 'Misses: 0';
  setStatus('');
  const result = document.getElementById('queen-result');
  result.classList.add('hidden');
  result.textContent = '';
}

function setStatus(msg) {
  document.getElementById('queen-status').textContent = msg;
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('queen-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
