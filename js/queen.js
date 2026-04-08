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

// Does a bishop (diagonal only) at `from` attack `to`, with `occupied` squares blocking?
function bishopAttacks(from, to, occupied) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (df === 0 || dr === 0 || Math.abs(df) !== Math.abs(dr)) return false;
  return lineAttacks(from, to, occupied);
}

// Does a knight at `from` attack `to`?
function knightAttacks(from, to) {
  const df = Math.abs(fileOf(to) - fileOf(from));
  const dr = Math.abs(rankOf(to) - rankOf(from));
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

// Can the target piece recapture the queen on `targetSq`? (king may block along lines)
function pieceCanRecapture(pieceType, pieceSq, targetSq, occupied) {
  if (pieceType === 'r') return rookAttacks(pieceSq, targetSq, occupied);
  if (pieceType === 'b') return bishopAttacks(pieceSq, targetSq, occupied);
  if (pieceType === 'n') return knightAttacks(pieceSq, targetSq);
  return false;
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

// Returns all squares S where the queen creates a tactical threat against the given piece type:
//   A. Fork   — queen at S attacks king AND piece simultaneously
//   B. Skewer — king between S and piece (queen checks king; piece exposed on king's retreat)
//   C. Pin    — piece between S and king on same line; condition 3 filters cases where the
//               piece counterattacks S (e.g. rook pins diagonally pass; along rank/file fail;
//               bishop is opposite; knight never counterattacks along a line)
//
// Always required:
//   1. Queen can reach S from its starting square (king/piece may block the path)
//   2. S is not adjacent to the king (king cannot capture the queen there)
//   3. Target piece cannot immediately recapture (king may block sliding pieces)
function computeValidSquares(queenSq, kingSq, pieceSq, pieceType) {
  const valid = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const s = sqName(f, r);
      if (s === queenSq || s === kingSq || s === pieceSq) continue;

      // 1. Queen can reach s (path clear of king and piece)
      if (!lineAttacks(queenSq, s, new Set([kingSq, pieceSq]))) continue;

      // 2. King cannot capture the queen at s
      if (isAdjacent(s, kingSq)) continue;

      // 3. Target piece cannot immediately recapture (king may block)
      if (pieceCanRecapture(pieceType, pieceSq, s, new Set([kingSq]))) continue;

      // A. Fork: queen at s directly attacks both king and piece
      const attacksKing  = lineAttacks(s, kingSq,  new Set([pieceSq]));
      const attacksPiece = lineAttacks(s, pieceSq, new Set([kingSq]));
      if (attacksKing && attacksPiece) { valid.push(s); continue; }

      // B. Skewer: king between s and piece — queen checks king; piece exposed on retreat
      if (isBetween(kingSq, s, pieceSq)) { valid.push(s); continue; }

      // C. Pin: piece between s and king — condition 3 already excluded counterattack cases
      if (isBetween(pieceSq, s, kingSq)) { valid.push(s); continue; }
    }
  }
  return valid;
}

// ─── FEN builder ──────────────────────────────────────────────────────────────

// Builds a display FEN with just the three pieces (no kings required for rendering).
function buildFen(queenSq, kingSq, pieceSq, pieceType) {
  const pieces = { [queenSq]: 'Q', [kingSq]: 'k', [pieceSq]: pieceType };
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

const PIECE_TYPES = ['r', 'n', 'b'];

function generatePosition() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const [kingSq, pieceSq, queenSq] = shuffle(ALL_SQS);
    const pieceType = PIECE_TYPES[Math.floor(Math.random() * 3)];
    // Queen must not currently attack king or piece
    if (lineAttacks(queenSq, kingSq, new Set([pieceSq]))) continue;
    if (lineAttacks(queenSq, pieceSq, new Set([kingSq]))) continue;
    const valid = computeValidSquares(queenSq, kingSq, pieceSq, pieceType);
    if (valid.length > 0) return { queenSq, kingSq, pieceSq, pieceType, valid };
  }
  // Fallback: verified position with rook
  const q = 'h1', k = 'e5', p = 'e8';
  return { queenSq: q, kingSq: k, pieceSq: p, pieceType: 'r', valid: computeValidSquares(q, k, p, 'r') };
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
let currentPieceSq = '';
let currentPieceType = '';
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
  currentQueenSq  = pos.queenSq;
  currentKingSq   = pos.kingSq;
  currentPieceSq  = pos.pieceSq;
  currentPieceType = pos.pieceType;
  currentValid    = pos.valid;

  const fen = buildFen(pos.queenSq, pos.kingSq, pos.pieceSq, pos.pieceType);

  if (!board) {
    board = new Chessboard(document.getElementById('queen-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    board.setPosition(fen, false);
  }

  if (currentValid.length === 0) setStatus('No valid squares for this position.');

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
  if (sq === currentQueenSq || sq === currentKingSq || sq === currentPieceSq) return;
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
  upsertDrillDay('queen', { seconds, correct: found, misses, puzzleId: `${currentQueenSq}-${currentKingSq}-${currentPieceSq}-${currentPieceType}` });
  updateSessionStats();

  const el = document.getElementById('queen-result');
  el.textContent = `✓ ${formatTime(seconds)} · ${found}/${total} squares · ${misses} miss${misses !== 1 ? 'es' : ''}`;
  el.classList.remove('hidden');

  if (missed.length > 0) {
    missed.forEach(sq => drawMark(sq, 'queen-sq-missed'));
    drawContinueMsg();
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

function drawContinueMsg() {
  const boardEl = document.getElementById('queen-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', boardW / 2);
  text.setAttribute('y', boardW - sqSize * 0.15);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', sqSize * 0.48);
  text.setAttribute('class', 'queen-continue-msg');
  text.textContent = 'Click anywhere to continue';
  svg.appendChild(text);
}

function clearMarks() {
  const boardEl = document.getElementById('queen-board');
  if (boardEl) boardEl.querySelectorAll('.queen-sq-correct,.queen-sq-incorrect,.queen-sq-missed,.queen-continue-msg')
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
