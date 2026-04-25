import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { upsertDrillDay } from './storage.js';
import { checkAndUpdatePB, showPBCelebration, checkGoals, showGoalCelebration } from './pb.js';
import { registerPause } from './pause.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

// ─── Constants ────────────────────────────────────────────────────────────────

const KING_SQ = 'd5';

// All 63 non-king squares in outward clockwise spiral from D4.
// Layer 1 (8): D4 → clockwise ring at Chebyshev dist 1
// Layer 2 (16): C3 → clockwise ring at dist 2
// Layer 3 (24): B2 → clockwise ring at dist 3
// Layer 4 (15): A1 → remaining reachable squares at dist 4 (NW corner is off board)
const SPIRAL = [
  'd4','e4','e5','e6','d6','c6','c5','c4',
  'c3','d3','e3','f3','f4','f5','f6','f7','e7','d7','c7','b7','b6','b5','b4','b3',
  'b2','c2','d2','e2','f2','g2','g3','g4','g5','g6','g7','g8','f8','e8','d8','c8','b8','a8','a7','a6','a5','a4','a3','a2',
  'a1','b1','c1','d1','e1','f1','g1','h1','h2','h3','h4','h5','h6','h7','h8',
];
// Verify: 8 + 16 + 24 + 15 = 63 ✓

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function fileOf(sq) { return sq.charCodeAt(0) - 97; }
function rankOf(sq) { return parseInt(sq[1]) - 1; }
function sqName(f, r) { return String.fromCharCode(97 + f) + (r + 1); }

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

function lineAttacks(from, to, occupied) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (df === 0 && dr === 0) return false;
  if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return false;
  return !squaresBetween(from, to).some(sq => occupied.has(sq));
}

function rookAttacks(from, to, occupied) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (df !== 0 && dr !== 0) return false;
  return lineAttacks(from, to, occupied);
}

function bishopAttacks(from, to, occupied) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (df === 0 || dr === 0 || Math.abs(df) !== Math.abs(dr)) return false;
  return lineAttacks(from, to, occupied);
}

function knightAttacks(from, to) {
  const df = Math.abs(fileOf(to) - fileOf(from));
  const dr = Math.abs(rankOf(to) - rankOf(from));
  return (df === 1 && dr === 2) || (df === 2 && dr === 1);
}

function isAdjacent(sq1, sq2) {
  return Math.max(
    Math.abs(fileOf(sq1) - fileOf(sq2)),
    Math.abs(rankOf(sq1) - rankOf(sq2))
  ) === 1;
}

function pieceCanRecapture(pieceType, pieceSq, targetSq, occupied) {
  if (pieceType === 'r') return rookAttacks(pieceSq, targetSq, occupied);
  if (pieceType === 'b') return bishopAttacks(pieceSq, targetSq, occupied);
  if (pieceType === 'n') return knightAttacks(pieceSq, targetSq);
  return false;
}

function isBetween(mid, a, b) {
  return squaresBetween(a, b).includes(mid);
}

// ─── Valid square logic ───────────────────────────────────────────────────────

// Returns all squares where placing a queen creates a fork, pin, or skewer
// against the black king (fixed at d5) and the black piece at pieceSq.
//
// A square S is valid if:
//   • S ≠ kingSq, S ≠ pieceSq
//   • King cannot capture the queen there (S not adjacent to king)
//   • Piece cannot immediately recapture (king may block sliding pieces)
//   • AND at least one of:
//     A. Fork  — queen at S attacks both king and piece simultaneously
//     B. Skewer — king is between S and piece on same line
//     C. Pin   — piece is between S and king on same line
function computeValidSquares(kingSq, pieceSq, pieceType) {
  const valid = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const s = sqName(f, r);
      if (s === kingSq || s === pieceSq) continue;

      // Safety: king can't walk over and capture
      if (isAdjacent(s, kingSq)) continue;

      // Safety: piece can't immediately take the queen (king may block its line)
      if (pieceCanRecapture(pieceType, pieceSq, s, new Set([kingSq]))) continue;

      // A. Fork
      const attacksKing  = lineAttacks(s, kingSq,  new Set([pieceSq]));
      const attacksPiece = lineAttacks(s, pieceSq, new Set([kingSq]));
      if (attacksKing && attacksPiece) { valid.push(s); continue; }

      // B. Skewer: king between queen and piece
      if (isBetween(kingSq, s, pieceSq)) { valid.push(s); continue; }

      // C. Pin: piece between queen and king
      if (isBetween(pieceSq, s, kingSq)) { valid.push(s); continue; }
    }
  }
  return valid;
}

// ─── FEN builder ─────────────────────────────────────────────────────────────

function buildFen(kingSq, pieceSq, pieceType) {
  const pieces = { [kingSq]: 'k', [pieceSq]: pieceType };
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pieces[sqName(file, rank)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; }
      else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' b - - 0 1';
}

// ─── Module state ─────────────────────────────────────────────────────────────

let board = null;
let navigate = null;
let onPerfect = null;
let chosenPiece = 'r';
let spiralIndex = 0;
let sessionStart = 0;
let sessionMisses = 0;
let currentValidSqs = [];
let foundSqs = new Set();
let puzzleActive = false;
let waitingToAdvance = false;
let autoAdvanceTimer = null;
let sessionTimerInterval = null;
let pauseStart = 0;

// ─── Public API ───────────────────────────────────────────────────────────────

export function initDeLaMaza(navigateFn, onPerfectFn) {
  navigate = navigateFn;
  onPerfect = onPerfectFn;

  document.getElementById('btn-dlm-show').addEventListener('click', handleShow);
  document.getElementById('btn-dlm-no-solution').addEventListener('click', handleNoSolutionClick);
  document.getElementById('btn-dlm-done').addEventListener('click', () => {
    stopSession();
    navigate('screen-select');
  });
  document.getElementById('btn-menu').addEventListener('click', stopSession);
  document.getElementById('btn-dlm-again').addEventListener('click', () => beginSession());
  document.getElementById('btn-dlm-choose').addEventListener('click', () => {
    document.getElementById('dlm-end-screen').classList.add('hidden');
    document.getElementById('dlm-drill-area').classList.add('hidden');
    document.getElementById('dlm-piece-select').classList.remove('hidden');
  });
  document.getElementById('btn-dlm-end-menu').addEventListener('click', () => {
    stopSession();
    navigate('screen-select');
  });
  document.getElementById('dlm-board').addEventListener('click', handleBoardClick);
  document.getElementById('btn-dlm-rook').addEventListener('click', () => choosePiece('r'));
  document.getElementById('btn-dlm-bishop').addEventListener('click', () => choosePiece('b'));
  document.getElementById('btn-dlm-knight').addEventListener('click', () => choosePiece('n'));
}

export function startDeLaMaza() {
  stopSession();
  document.getElementById('dlm-end-screen').classList.add('hidden');
  document.getElementById('dlm-drill-area').classList.add('hidden');
  document.getElementById('dlm-piece-select').classList.remove('hidden');
  document.getElementById('dlm-progress').textContent = '— / 63';
  document.getElementById('dlm-timer').textContent = '0:00';
  document.getElementById('dlm-misses').textContent = 'Misses: 0';
}

// ─── Piece selection ──────────────────────────────────────────────────────────

function choosePiece(type) {
  chosenPiece = type;
  document.getElementById('dlm-piece-select').classList.add('hidden');
  document.getElementById('dlm-end-screen').classList.add('hidden');
  document.getElementById('dlm-drill-area').classList.remove('hidden');
  beginSession();
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

function beginSession() {
  stopSession();
  spiralIndex = 0;
  sessionMisses = 0;
  document.getElementById('dlm-end-screen').classList.add('hidden');
  document.getElementById('dlm-drill-area').classList.remove('hidden');
  document.getElementById('dlm-misses').textContent = 'Misses: 0';
  sessionStart = Date.now();
  sessionTimerInterval = setInterval(updateTimerDisplay, 1000);
  registerPause(pauseSession, resumeSession);
  loadPosition();
}

function pauseSession() {
  if (sessionTimerInterval) { clearInterval(sessionTimerInterval); sessionTimerInterval = null; }
  pauseStart = Date.now();
}

function resumeSession() {
  sessionStart += Date.now() - pauseStart;
  sessionTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopSession() {
  if (sessionTimerInterval) { clearInterval(sessionTimerInterval); sessionTimerInterval = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleActive = false;
  waitingToAdvance = false;
}

function loadPosition() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  waitingToAdvance = false;

  const pieceSq = SPIRAL[spiralIndex];
  currentValidSqs = computeValidSquares(KING_SQ, pieceSq, chosenPiece);
  foundSqs = new Set();
  puzzleActive = true;
  document.getElementById('btn-dlm-no-solution').disabled = false;

  document.getElementById('dlm-progress').textContent = `${spiralIndex + 1} / 63`;

  const fen = buildFen(KING_SQ, pieceSq, chosenPiece);
  if (!board) {
    board = new Chessboard(document.getElementById('dlm-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    board.setPosition(fen, false);
  }

  clearMarks();

  if (currentValidSqs.length === 0) {
    puzzleActive = false;
  }
}

function advancePosition() {
  spiralIndex++;
  if (spiralIndex >= 63) endSession();
  else loadPosition();
}

async function endSession() {
  stopSession();
  const elapsed = Math.round((Date.now() - sessionStart) / 1000);

  const pieceKey = { r: 'dlm-rook', b: 'dlm-bishop', n: 'dlm-knight' }[chosenPiece];
  const correct = Math.max(0, 63 - sessionMisses);
  upsertDrillDay(pieceKey, {
    seconds: Math.round(elapsed / 63),
    correct,
    misses: sessionMisses,
    puzzleId: `${chosenPiece}-full`,
  });

  const { accMet, timeMet } = await checkGoals(pieceKey, 63, correct, sessionMisses, elapsed);
  if (accMet || timeMet) await showGoalCelebration(accMet, timeMet);
  const isPB = await checkAndUpdatePB(pieceKey, 63, correct, sessionMisses, elapsed);
  if (isPB) await showPBCelebration();

  document.getElementById('dlm-drill-area').classList.add('hidden');
  document.getElementById('dlm-end-time').textContent = formatTime(elapsed);
  document.getElementById('dlm-end-per-pos').textContent = `${(elapsed / 63).toFixed(1)}s`;
  document.getElementById('dlm-end-misses').textContent = sessionMisses;
  const pieceName = { r: 'Rook', b: 'Bishop', n: 'Knight' }[chosenPiece];
  document.getElementById('dlm-end-piece').textContent = pieceName;
  document.getElementById('dlm-end-screen').classList.remove('hidden');
  if (sessionMisses === 0 && onPerfect) onPerfect();
}

// ─── Board interaction ────────────────────────────────────────────────────────

function handleBoardClick(e) {
  if (waitingToAdvance) {
    waitingToAdvance = false;
    clearMarks();
    advancePosition();
    return;
  }
  if (!puzzleActive) return;
  const boardEl = document.getElementById('dlm-board');
  const rect = boardEl.getBoundingClientRect();
  const file = Math.floor((e.clientX - rect.left) / rect.width * 8);
  const rankIdx = 7 - Math.floor((e.clientY - rect.top) / rect.height * 8);
  if (file < 0 || file > 7 || rankIdx < 0 || rankIdx > 7) return;
  const sq = sqName(file, rankIdx);

  const pieceSq = SPIRAL[spiralIndex];
  if (sq === KING_SQ || sq === pieceSq) return;
  if (foundSqs.has(sq)) return;

  if (currentValidSqs.includes(sq)) {
    foundSqs.add(sq);
    drawMark(sq, 'dlm-sq-found');
    document.getElementById('btn-dlm-no-solution').disabled = true;
    if (foundSqs.size === currentValidSqs.length) {
      puzzleActive = false;
      autoAdvanceTimer = setTimeout(advancePosition, 500);
    }
  } else {
    sessionMisses++;
    document.getElementById('dlm-misses').textContent = `Misses: ${sessionMisses}`;
    flashMark(sq);
  }
}

function handleShow() {
  if (!puzzleActive) return;
  puzzleActive = false;
  for (const sq of currentValidSqs) {
    if (!foundSqs.has(sq)) {
      sessionMisses++;
      drawMark(sq, 'dlm-sq-missed');
    }
  }
  document.getElementById('dlm-misses').textContent = `Misses: ${sessionMisses}`;
  drawContinueMsg();
  waitingToAdvance = true;
}

function handleNoSolutionClick() {
  if (waitingToAdvance) return;
  const unfound = currentValidSqs.filter(sq => !foundSqs.has(sq));
  if (unfound.length > 0) {
    // Wrong — solutions existed; reveal them in red and penalise
    puzzleActive = false;
    for (const sq of unfound) {
      sessionMisses++;
      drawMark(sq, 'dlm-sq-missed');
    }
    document.getElementById('dlm-misses').textContent = `Misses: ${sessionMisses}`;
    drawContinueMsg();
    waitingToAdvance = true;
  } else {
    // Correct — nothing to find
    clearMarks();
    advancePosition();
  }
}

// ─── Timer display ────────────────────────────────────────────────────────────

function updateTimerDisplay() {
  const elapsed = Math.round((Date.now() - sessionStart) / 1000);
  document.getElementById('dlm-timer').textContent = formatTime(elapsed);
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function getSvgInfo() {
  const boardEl = document.getElementById('dlm-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  return { svg, sqSize: boardW / 8 };
}

function drawMark(sq, cssClass) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const file = fileOf(sq), rank = rankOf(sq);
  const x = file * sqSize, y = (7 - rank) * sqSize;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);
  rect.setAttribute('y', y + 2);
  rect.setAttribute('width', sqSize - 4);
  rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-dlm-sq', sq);
  svg.appendChild(rect);
}

function flashMark(sq) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const file = fileOf(sq), rank = rankOf(sq);
  const x = file * sqSize, y = (7 - rank) * sqSize;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);
  rect.setAttribute('y', y + 2);
  rect.setAttribute('width', sqSize - 4);
  rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', 'dlm-sq-invalid');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 500);
}

function showBoardMessage(text, persist = false) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const boardW = sqSize * 8;
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.setAttribute('x', boardW / 2);
  el.setAttribute('y', boardW / 2);
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('dominant-baseline', 'middle');
  el.setAttribute('font-size', sqSize * 0.48);
  el.setAttribute('class', 'dlm-board-msg');
  el.textContent = text;
  svg.appendChild(el);
  if (!persist) setTimeout(() => el.remove(), 1100);
}

function drawContinueMsg() {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const boardW = sqSize * 8;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', boardW / 2);
  text.setAttribute('y', boardW - sqSize * 0.15);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', sqSize * 0.48);
  text.setAttribute('class', 'dlm-board-msg');
  text.textContent = 'Click anywhere to continue';
  svg.appendChild(text);
}

function clearMarks() {
  const boardEl = document.getElementById('dlm-board');
  if (boardEl) boardEl.querySelectorAll('[data-dlm-sq],.dlm-board-msg').forEach(el => el.remove());
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
