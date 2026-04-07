import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';

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
let correctAnswers = 0;
let answerW = 0;
let answerB = 0;
let correctW = false;
let correctB = false;
let puzzleActive = false;
let puzzleCount = 0;
let currentPuzzleId = '';
let currentFen = '';
let showingLoose = false;
const drillResults = [];   // { seconds, correct, misses } per completed puzzle
let navigate = null;

// --- Public API ---

export function initLoose(navigateFn) {
  navigate = navigateFn;
  createDigitButtons();
  document.getElementById('btn-loose-done').addEventListener('click', showSummary);
  document.getElementById('btn-loose-next').addEventListener('click', loadNextPuzzle);
  document.getElementById('btn-loose-show').addEventListener('click', () => {
    if (showingLoose) hideLoose();
    else showLoose();
  });
}

export async function startLoose() {
  resetDrill();
  await loadNextPuzzle();
}

// --- Puzzle loading ---

async function loadNextPuzzle() {
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('loose-puzzle-num').textContent = `#${puzzleCount}`;
  setStatus('Loading puzzle…');

  const { fen, puzzleId } = await fetchValidFen();
  currentPuzzleId = puzzleId;
  currentFen = fen;

  if (!board) {
    board = new Chessboard(document.getElementById('loose-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    board.setPosition(fen, false);
  }

  answerW = countLoosePiecesForColor(fen, 'w');
  answerB = countLoosePiecesForColor(fen, 'b');

  setStatus('');
  puzzleActive = true;
  startTimer();
}

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

// --- Loose piece counting ---
// A piece is "loose" if no friendly piece defends its square.
// Kings are excluded: they can never be guarded (the opponent would
// sacrifice anything to capture a king, so guarding a king is meaningless).

function countLoosePiecesForColor(fen, colorChar) {
  const tmp = new Chess();
  try { tmp.load(fen); } catch { return 0; }

  let count = 0;
  const squares = 'abcdefgh'.split('');
  for (const file of squares) {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const piece = tmp.get(sq);
      if (!piece || piece.color !== colorChar || piece.type === 'k') continue;
      // A piece is loose if no friendly piece attacks/defends its square
      if (tmp.attackers(sq, colorChar).length === 0) count++;
    }
  }
  return Math.min(count, 9);
}

// Returns square names (e.g. ['e4','f3']) for loose pieces of colorChar.
function getLoosePiecesForColor(fen, colorChar) {
  const tmp = new Chess();
  try { tmp.load(fen); } catch { return []; }
  const squares = [];
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const piece = tmp.get(sq);
      if (!piece || piece.color !== colorChar || piece.type === 'k') continue;
      if (tmp.attackers(sq, colorChar).length === 0) squares.push(sq);
    }
  }
  return squares;
}

function showLoose() {
  if (!board || !currentFen) return;
  clearLooseOverlay();
  const whiteSqs = getLoosePiecesForColor(currentFen, 'w');
  const blackSqs = getLoosePiecesForColor(currentFen, 'b');
  drawLooseOverlay(whiteSqs, blackSqs);
  if (whiteSqs.length === 0 && blackSqs.length === 0) {
    setTimeout(() => showNoMovesMessage('loose-board'), 50);
  }
  showingLoose = true;
  document.getElementById('btn-loose-show').classList.add('active');
}

function hideLoose() {
  clearLooseOverlay();
  showingLoose = false;
  const btn = document.getElementById('btn-loose-show');
  if (btn) btn.classList.remove('active');
}

function drawLooseOverlay(whiteSqs, blackSqs) {
  const boardEl = document.getElementById('loose-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return;

  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;

  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.setAttribute('class', 'loose-overlay');
  svg.appendChild(layer);

  [['w', whiteSqs, 'loose-marker-white'], ['b', blackSqs, 'loose-marker-black']].forEach(([, squares, cls]) => {
    squares.forEach((sq, i) => {
      const file = sq.charCodeAt(0) - 97;  // 'a'=0
      const rank = parseInt(sq[1]);         // 1-8
      const x = file * sqSize;
      const y = (8 - rank) * sqSize;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x + 2);
      rect.setAttribute('y', y + 2);
      rect.setAttribute('width', sqSize - 4);
      rect.setAttribute('height', sqSize - 4);
      rect.setAttribute('rx', 4);
      rect.setAttribute('class', cls);
      layer.appendChild(rect);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + sqSize * 0.22);
      text.setAttribute('y', y + sqSize * 0.28);
      text.setAttribute('font-size', sqSize * 0.3);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('class', 'loose-label');
      text.textContent = i + 1;
      layer.appendChild(text);
    });
  });
}

function clearLooseOverlay() {
  const boardEl = document.getElementById('loose-board');
  if (boardEl) {
    boardEl.querySelectorAll('.loose-overlay').forEach(el => el.remove());
    boardEl.querySelectorAll('.board-none-msg').forEach(el => el.remove());
  }
}

function showNoMovesMessage(boardId) {
  const boardEl = document.getElementById(boardId);
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const cx = (vb && vb.width) ? vb.width / 2 : svg.getBoundingClientRect().width / 2;
  const cy = (vb && vb.height) ? vb.height / 2 : svg.getBoundingClientRect().height / 2;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', cx);
  text.setAttribute('y', cy);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('class', 'board-none-msg');
  text.textContent = 'None by either side';
  svg.appendChild(text);
}

// --- Digit button interaction ---

function handleDigitClick(color, value) {
  if (!puzzleActive) return;
  const isWhite = color === 'w';
  if (isWhite && correctW) return;
  if (!isWhite && correctB) return;

  const btn = document.querySelector(
    `#screen-loose .digit-btn[data-color="${color}"][data-value="${value}"]`
  );
  if (!btn || btn.classList.contains('correct') || btn.classList.contains('incorrect')) return;

  const correct = isWhite ? answerW : answerB;
  if (value === correct) {
    btn.classList.add('correct');
    correctAnswers++;
    if (isWhite) correctW = true; else correctB = true;
    if (correctW && correctB) puzzleComplete();
  } else {
    btn.classList.add('incorrect');
    misses++;
    document.getElementById('loose-misses').textContent = `Misses: ${misses}`;
  }
}

function puzzleComplete() {
  puzzleActive = false;
  stopTimer();
  drillResults.push({ seconds, correct: correctAnswers, misses });
  upsertDrillDay('loose', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
  updateSessionStats();
  const el = document.getElementById('loose-result');
  el.textContent = `✓ ${formatTime(seconds)} · ${misses} miss${misses !== 1 ? 'es' : ''}`;
  el.classList.remove('hidden');
}

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses = drillResults.reduce((s, r) => s + r.misses, 0);
  const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
  const avgSecs = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('loose-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('loose-session-acc').textContent = `Acc ${accuracy}%`;
}

// --- Summary ---

function showSummary() {
  stopTimer();
  document.getElementById('btn-summary-again').onclick = restartDrill;

  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  if (count > 0) {
    const avgTime = drillResults.reduce((s, r) => s + r.seconds, 0) / count;
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses = drillResults.reduce((s, r) => s + r.misses, 0);
    const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
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
  await loadNextPuzzle();
}

// --- UI helpers ---

function createDigitButtons() {
  [['loose-digits-white', 'w'], ['loose-digits-black', 'b']].forEach(([containerId, color]) => {
    const container = document.getElementById(containerId);
    for (let i = 0; i <= 9; i++) {
      const btn = document.createElement('button');
      btn.className = 'digit-btn';
      btn.dataset.color = color;
      btn.dataset.value = i;
      btn.textContent = i === 9 ? '9+' : i;
      btn.addEventListener('click', () => handleDigitClick(color, i));
      container.appendChild(btn);
    }
  });
}

function resetDrill() {
  puzzleCount = 0;
  drillResults.length = 0;
  document.getElementById('loose-session-time').textContent = '';
  document.getElementById('loose-session-acc').textContent = '';
}

function resetUI() {
  correctW = correctB = false;
  misses = seconds = correctAnswers = 0;
  hideLoose();
  document.getElementById('loose-timer').textContent = '0:00';
  document.getElementById('loose-misses').textContent = 'Misses: 0';
  const result = document.getElementById('loose-result');
  result.classList.add('hidden');
  result.textContent = '';
  document.querySelectorAll('#screen-loose .digit-btn').forEach(b =>
    b.classList.remove('correct', 'incorrect')
  );
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
