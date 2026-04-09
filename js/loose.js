import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';
import { scoreCountDifficulty, diffLabel } from './difficulty.js';
import { registerPause } from './pause.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

const FALLBACK_FENS = [
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 b kq - 5 6',
  'rnbq1rk1/ppp2pbp/3p1np1/3Pp3/2P5/2N2NP1/PP2PPBP/R1BQ1RK1 b - - 0 8',
  'r2qkb1r/ppp2ppp/2np1n2/4p1B1/2B1P3/2NP1N2/PPP2PPP/R2QK2R b KQkq - 1 8',
  'r1bqr1k1/ppp2pbp/2np1np1/3Pp3/2P5/2N1BNP1/PP2PPBP/R2Q1RK1 w - - 2 10',
  'r2q1rk1/ppp1bppp/2n1bn2/3pp3/2PP4/2N1PN2/PPQ1BPPP/R1B2RK1 w - - 4 10',
  'r1b2rk1/ppq1bppp/2n1pn2/3pN3/2PP4/2N1B3/PPQ1BPPP/R4RK1 w - - 0 12',
];

// --- Module state ---
let board = null;
let timerInterval = null;
let seconds = 0;
let misses = 0;
let puzzleActive = false;
let puzzleCount = 0;
let currentPuzzleId = '';
let currentFen = '';
let currentLooseSqs = new Set();  // all loose piece squares for this position
let foundSqs = new Set();         // correctly identified by user
let waitingToAdvance = false;
const drillResults = [];
let navigate = null;
let puzzleQueue = [];

// --- Public API ---

export function initLoose(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-loose-done').addEventListener('click', showSummary);
  document.getElementById('btn-loose-complete').addEventListener('click', handleComplete);
  document.getElementById('btn-loose-show').addEventListener('click', handleShow);
  document.getElementById('loose-board').addEventListener('click', handleBoardClick);
}

export async function startLoose() {
  registerPause(stopTimer, startTimer);
  resetDrill();
  setStatus('Loading session…');
  await fillQueue();
  await loadNextPuzzle();
}

async function fillQueue() {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => fetchWithDifficulty())
  );
  const valid = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  valid.sort((a, b) => a.difficulty - b.difficulty);
  puzzleQueue.push(...valid);
}

async function fetchWithDifficulty() {
  const { fen, puzzleId } = await fetchValidFen();
  const looseSqs = getLoosePieces(fen);
  return { fen, puzzleId, looseSqs,
           difficulty: scoreCountDifficulty(fen, looseSqs.size) };
}

// --- Puzzle loading ---

async function loadNextPuzzle() {
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('loose-puzzle-num').textContent = `#${puzzleCount}`;

  if (puzzleQueue.length === 0) {
    setStatus('Loading…');
    await fillQueue();
  }
  const puzzle = puzzleQueue.shift();
  currentPuzzleId   = puzzle.puzzleId;
  currentFen        = puzzle.fen;
  currentLooseSqs   = puzzle.looseSqs;
  foundSqs          = new Set();
  showDifficulty('loose-diff', puzzle.difficulty);
  if (puzzleQueue.length === 0) fillQueue();

  if (!board) {
    board = new Chessboard(document.getElementById('loose-board'), {
      position: currentFen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    board.setPosition(currentFen, false);
  }

  setStatus('');
  puzzleActive = true;
  startTimer();
}

// --- Lichess fetch ---

async function fetchValidFen() {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { fen, puzzleId } = await fetchLichessPuzzle();
      if (!eitherSideInCheck(fen)) return { fen, puzzleId };
      console.log('Skipping position where a side is in check');
    } catch (err) {
      console.warn('Lichess unavailable, using fallback:', err.message);
      break;
    }
  }
  return { fen: FALLBACK_FENS[Math.floor(Math.random() * FALLBACK_FENS.length)], puzzleId: '' };
}

function eitherSideInCheck(fen) {
  const parts = fen.split(' ');
  const tmp1 = new Chess();
  try { tmp1.load(fen); } catch { return true; }
  if (tmp1.inCheck()) return true;
  const flipped = [...parts];
  flipped[1] = parts[1] === 'w' ? 'b' : 'w';
  flipped[3] = '-';
  const tmp2 = new Chess();
  try { tmp2.load(flipped.join(' ')); } catch { return true; }
  return tmp2.inCheck();
}

async function fetchLichessPuzzle() {
  const resp = await fetch('https://lichess.org/api/puzzle/next', {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return parsePuzzleFen(data);
}

function parsePuzzleFen(data) {
  const gameChess = new Chess();
  gameChess.loadPgn(data.game.pgn);
  const moves = gameChess.history();
  const puzzleChess = new Chess();
  const ply = Math.min(data.puzzle.initialPly, moves.length);
  for (let i = 0; i < ply; i++) puzzleChess.move(moves[i]);
  return { fen: puzzleChess.fen(), puzzleId: data.puzzle.id ?? '' };
}

// --- Loose piece detection ---
// A piece is "loose" if no friendly piece defends its square. Kings excluded.

function getLoosePieces(fen) {
  const tmp = new Chess();
  try { tmp.load(fen); } catch { return new Set(); }
  const result = new Set();
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const piece = tmp.get(sq);
      if (!piece || piece.type === 'k') continue;
      if (tmp.attackers(sq, piece.color).length === 0) result.add(sq);
    }
  }
  return result;
}

// --- Board click handler ---

function handleBoardClick(e) {
  if (waitingToAdvance) { loadNextPuzzle(); return; }
  if (!puzzleActive) return;

  const sq = sqFromEvent(e);
  if (!sq) return;

  // Toggle: un-mark an already-found square
  if (foundSqs.has(sq)) {
    foundSqs.delete(sq);
    removeSqMark(sq);
    return;
  }

  if (currentLooseSqs.has(sq)) {
    foundSqs.add(sq);
    drawSqMark(sq, 'loose-sq-found');
  } else {
    misses++;
    document.getElementById('loose-misses').textContent = `Misses: ${misses}`;
    flashSq(sq);
  }
}

function handleComplete() {
  if (waitingToAdvance) { loadNextPuzzle(); return; }
  if (!puzzleActive) return;
  finishPuzzle();
}

function handleShow() {
  if (waitingToAdvance) { loadNextPuzzle(); return; }
  if (!puzzleActive) return;
  finishPuzzle();
}

function finishPuzzle() {
  puzzleActive = false;
  stopTimer();

  // Reveal missed loose squares in amber
  for (const sq of currentLooseSqs) {
    if (!foundSqs.has(sq)) {
      misses++;
      drawSqMark(sq, 'loose-sq-missed');
    }
  }
  document.getElementById('loose-misses').textContent = `Misses: ${misses}`;

  const correct = foundSqs.size;
  const total   = currentLooseSqs.size;
  drillResults.push({ seconds, correct, misses });
  upsertDrillDay('loose', { seconds, correct, misses, puzzleId: currentPuzzleId });
  updateSessionStats();

  const el = document.getElementById('loose-result');
  if (total === 0) {
    el.textContent = `✓ ${formatTime(seconds)} · No loose pieces · ${misses} miss${misses !== 1 ? 'es' : ''}`;
  } else {
    el.textContent = `✓ ${formatTime(seconds)} · ${correct}/${total} found · ${misses} miss${misses !== 1 ? 'es' : ''}`;
  }
  el.classList.remove('hidden');

  drawContinueMsg();
  document.getElementById('btn-loose-complete').textContent = 'CONTINUE';
  waitingToAdvance = true;
}

// --- SVG helpers ---

function getSvg() {
  const boardEl = document.getElementById('loose-board');
  return boardEl ? boardEl.querySelector('svg') : null;
}

function sqFromEvent(e) {
  const boardEl = document.getElementById('loose-board');
  if (!boardEl) return null;
  const rect = boardEl.getBoundingClientRect();
  const file    = Math.floor((e.clientX - rect.left)  / rect.width  * 8);
  const rankIdx = 7 - Math.floor((e.clientY - rect.top) / rect.height * 8);
  if (file < 0 || file > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return String.fromCharCode(97 + file) + (rankIdx + 1);
}

function drawSqMark(sq, cssClass) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]);
  const x = file * sqSize, y = (8 - rank) * sqSize;
  const pad = 3;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + pad);
  rect.setAttribute('y', y + pad);
  rect.setAttribute('width',  sqSize - pad * 2);
  rect.setAttribute('height', sqSize - pad * 2);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-loose-sq', sq);
  rect.setAttribute('pointer-events', 'none');
  svg.appendChild(rect);
}

function removeSqMark(sq) {
  const boardEl = document.getElementById('loose-board');
  if (boardEl) boardEl.querySelectorAll(`[data-loose-sq="${sq}"]`).forEach(el => el.remove());
}

function flashSq(sq) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]);
  const x = file * sqSize, y = (8 - rank) * sqSize;
  const pad = 3;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + pad);
  rect.setAttribute('y', y + pad);
  rect.setAttribute('width',  sqSize - pad * 2);
  rect.setAttribute('height', sqSize - pad * 2);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', 'loose-sq-invalid');
  rect.setAttribute('pointer-events', 'none');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 600);
}

function clearAllMarks() {
  const boardEl = document.getElementById('loose-board');
  if (boardEl) boardEl.querySelectorAll('[data-loose-sq], .loose-continue-msg').forEach(el => el.remove());
}

function drawContinueMsg() {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', boardW / 2);
  text.setAttribute('y', boardW - sqSize * 0.15);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', sqSize * 0.48);
  text.setAttribute('class', 'loose-continue-msg');
  text.textContent = 'Click anywhere to continue';
  svg.appendChild(text);
}

// --- Session stats ---

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
  const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
  const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('loose-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('loose-session-acc').textContent  = `Acc ${accuracy}%`;
}

// --- Summary ---

function showSummary() {
  stopTimer();
  document.getElementById('btn-summary-again').onclick = restartDrill;
  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  if (count > 0) {
    const avgTime      = drillResults.reduce((s, r) => s + r.seconds, 0) / count;
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
    const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
    document.getElementById('stat-avg-time').textContent = formatTime(Math.round(avgTime));
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

async function restartDrill() {
  navigate('screen-loose');
  resetDrill();
  await startLoose();
}

// --- UI helpers ---

function showDifficulty(id, score) {
  const el = document.getElementById(id);
  if (!el) return;
  const { text, cls } = diffLabel(score);
  el.textContent = text;
  el.className = `drill-difficulty ${cls}`;
}

function resetDrill() {
  puzzleCount = 0;
  drillResults.length = 0;
  puzzleQueue = [];
  document.getElementById('loose-session-time').textContent = '';
  document.getElementById('loose-session-acc').textContent  = '';
}

function resetUI() {
  misses = seconds = 0;
  waitingToAdvance = false;
  clearAllMarks();
  document.getElementById('loose-timer').textContent   = '0:00';
  document.getElementById('loose-misses').textContent  = 'Misses: 0';
  document.getElementById('btn-loose-complete').textContent = 'COMPLETE';
  const result = document.getElementById('loose-result');
  result.classList.add('hidden');
  result.textContent = '';
}

function setStatus(msg) {
  document.getElementById('loose-status').textContent = msg;
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('loose-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
