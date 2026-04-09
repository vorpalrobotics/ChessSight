import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';
import { scoreChecksDifficulty, diffLabel } from './difficulty.js';
import { registerPause } from './pause.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const ARROWS_SVG_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/arrows/arrows.svg';

const ARROW_WHITE_CAP = { class: 'arrow-white-cap' };
const ARROW_BLACK_CAP = { class: 'arrow-black-cap' };

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
let correctAnswers = 0;  // correct button presses this puzzle (max 2)
let answerW = 0;
let answerB = 0;
let correctW = false;
let correctB = false;
let puzzleActive = false;
let puzzleCount = 0;
let currentPuzzleId = '';
let currentFen = '';
let showingChecks = false;
const drillResults = [];   // { seconds, correct, misses } per completed puzzle
let navigate = null;
let puzzleQueue = [];

// --- Public API ---

export function initChecks(navigateFn) {
  navigate = navigateFn;
  createDigitButtons();
  document.getElementById('btn-checks-done').addEventListener('click', showSummary);
  document.getElementById('btn-checks-next').addEventListener('click', loadNextPuzzle);
  document.getElementById('btn-checks-show').addEventListener('click', () => {
    if (showingChecks) hideChecks();
    else showChecks();
  });
}

export async function startChecks() {
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
  const ansW = countChecksForColor(fen, 'w');
  const ansB = countChecksForColor(fen, 'b');
  return { fen, puzzleId, answerW: ansW, answerB: ansB,
           difficulty: scoreChecksDifficulty(fen, ansW + ansB) };
}

// --- Puzzle loading ---

async function loadNextPuzzle() {
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('checks-puzzle-num').textContent = `#${puzzleCount}`;

  if (puzzleQueue.length === 0) {
    setStatus('Loading…');
    await fillQueue();
  }
  const puzzle = puzzleQueue.shift();
  currentPuzzleId = puzzle.puzzleId;
  currentFen      = puzzle.fen;
  answerW         = puzzle.answerW;
  answerB         = puzzle.answerB;
  showDifficulty('checks-diff', puzzle.difficulty);
  // Pre-fetch next batch in background when queue is empty
  if (puzzleQueue.length === 0) fillQueue();

  if (!board) {
    board = new Chessboard(document.getElementById('checks-board'), {
      position: currentFen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Arrows, props: { sprite: ARROWS_SVG_URL, headSize: 6 } }],
    });
  } else {
    board.setPosition(currentFen, false);
  }

  setStatus('');
  puzzleActive = true;
  startTimer();
}

// Retry up to 5 times to find a position where neither side starts in check.
async function fetchValidFen() {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { fen, puzzleId } = await fetchLichessPuzzle();
      if (!sideToMoveInCheck(fen)) return { fen, puzzleId };
      console.log('Skipping position where side-to-move is in check');
    } catch (err) {
      console.warn('Lichess unavailable, using fallback:', err.message);
      break;
    }
  }
  return { fen: FALLBACK_FENS[Math.floor(Math.random() * FALLBACK_FENS.length)], puzzleId: '' };
}

function sideToMoveInCheck(fen) {
  const tmp = new Chess();
  try { tmp.load(fen); } catch { return true; }
  return tmp.inCheck();
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

// --- Check counting ---

// Returns [{from, to}] for every move by colorChar that delivers check.
// Pawn promotions to the same destination square count as one move:
// if any promotion piece gives check, we count that (from, to) once.
function getChecksForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar;
  parts[3] = '-';
  const modFen = parts.join(' ');
  const tmp = new Chess();
  try { tmp.load(modFen); } catch { return []; }
  const found = new Set();
  const result = [];
  for (const m of tmp.moves({ verbose: true })) {
    const key = m.from + m.to;
    if (found.has(key)) continue;
    try { tmp.move(m); if (tmp.inCheck()) { found.add(key); result.push({ from: m.from, to: m.to }); } tmp.undo(); } catch { /* skip */ }
  }
  return result;
}

function countChecksForColor(fen, colorChar) {
  return Math.min(getChecksForColor(fen, colorChar).length, 9);
}

function showChecks() {
  if (!board || !currentFen) return;
  board.removeArrows();
  clearNoMovesMessage('checks-board');
  for (const m of getChecksForColor(currentFen, 'w')) board.addArrow(ARROW_WHITE_CAP, m.from, m.to);
  for (const m of getChecksForColor(currentFen, 'b')) board.addArrow(ARROW_BLACK_CAP, m.from, m.to);
  if (answerW === 0 && answerB === 0) {
    setTimeout(() => showNoMovesMessage('checks-board'), 50);
  } else {
    setTimeout(labelArrows, 50);
  }
  showingChecks = true;
  document.getElementById('btn-checks-show').classList.add('active');
}

function hideChecks() {
  if (!board) return;
  board.removeArrows();
  clearArrowLabels();
  clearNoMovesMessage('checks-board');
  showingChecks = false;
  const btn = document.getElementById('btn-checks-show');
  if (btn) btn.classList.remove('active');
}

function labelArrows() {
  clearArrowLabels();
  const boardEl = document.getElementById('checks-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return;
  ['arrow-white-cap', 'arrow-black-cap'].forEach(cls => {
    let n = 1;
    boardEl.querySelectorAll(`.arrow.${cls}`).forEach(group => {
      const line = group.querySelector('.arrow-line');
      if (!line) return;
      const x1 = parseFloat(line.getAttribute('x1'));
      const y1 = parseFloat(line.getAttribute('y1'));
      const x2 = parseFloat(line.getAttribute('x2'));
      const y2 = parseFloat(line.getAttribute('y2'));
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x1 + (x2 - x1) * 0.75);
      text.setAttribute('y', y1 + (y2 - y1) * 0.75);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('class', 'arrow-label');
      text.textContent = n++;
      svg.appendChild(text);
    });
  });
}

function clearArrowLabels() {
  const boardEl = document.getElementById('checks-board');
  if (boardEl) boardEl.querySelectorAll('.arrow-label').forEach(el => el.remove());
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

function clearNoMovesMessage(boardId) {
  const boardEl = document.getElementById(boardId);
  if (boardEl) boardEl.querySelectorAll('.board-none-msg').forEach(el => el.remove());
}

// --- Digit button interaction ---

function handleDigitClick(color, value) {
  if (!puzzleActive) return;
  const isWhite = color === 'w';
  if (isWhite && correctW) return;
  if (!isWhite && correctB) return;

  const btn = document.querySelector(
    `#screen-checks .digit-btn[data-color="${color}"][data-value="${value}"]`
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
    document.getElementById('checks-misses').textContent = `Misses: ${misses}`;
  }
}

function puzzleComplete() {
  puzzleActive = false;
  stopTimer();
  drillResults.push({ seconds, correct: correctAnswers, misses });
  upsertDrillDay('checks', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
  updateSessionStats();
  const el = document.getElementById('checks-result');
  el.textContent = `✓ ${formatTime(seconds)} · ${misses} miss${misses !== 1 ? 'es' : ''}`;
  el.classList.remove('hidden');
}

// --- Session stats (shown above the board during subsequent puzzles) ---

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses = drillResults.reduce((s, r) => s + r.misses, 0);
  const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
  const avgSecs = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('checks-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('checks-session-acc').textContent = `Acc ${accuracy}%`;
}

// --- Summary ---

function showSummary() {
  stopTimer();
  document.getElementById('btn-summary-again').onclick = restartDrill;

  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  if (count > 0) {
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses = drillResults.reduce((s, r) => s + r.misses, 0);
    const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
    const avgTime = drillResults.reduce((s, r) => s + r.seconds, 0) / count;
    document.getElementById('stat-avg-time').textContent = formatTime(Math.round(avgTime));
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

async function restartDrill() {
  navigate('screen-checks');
  resetDrill();
  await loadNextPuzzle();
}

// --- UI helpers ---

function createDigitButtons() {
  [['digits-white', 'w'], ['digits-black', 'b']].forEach(([containerId, color]) => {
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
  document.getElementById('checks-session-time').textContent = '';
  document.getElementById('checks-session-acc').textContent = '';
}

function resetUI() {
  correctW = correctB = false;
  misses = seconds = correctAnswers = 0;
  hideChecks();
  document.getElementById('checks-timer').textContent = '0:00';
  document.getElementById('checks-misses').textContent = 'Misses: 0';
  const result = document.getElementById('checks-result');
  result.classList.add('hidden');
  result.textContent = '';
  document.querySelectorAll('#screen-checks .digit-btn').forEach(b =>
    b.classList.remove('correct', 'incorrect')
  );
}

function setStatus(msg) {
  document.getElementById('checks-status').textContent = msg;
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('checks-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
