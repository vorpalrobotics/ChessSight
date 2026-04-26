import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';
import { checkAndUpdatePB, showPBCelebration, checkGoals, showGoalCelebration, updateSummaryGoals } from './pb.js';
import { scoreCountDifficulty, diffLabel } from './difficulty.js';
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
let correctAnswers = 0;
let answerW = 0;
let answerB = 0;
let correctW = false;
let correctB = false;
let puzzleActive = false;
let puzzleCount = 0;
let currentPuzzleId = '';
let currentFen = '';
let showingCaptures = false;
let waitingForContinue = false;
const drillResults = [];   // { seconds, correct, misses } per completed puzzle
let navigate = null;       // injected by app.js for screen transitions
let puzzleQueue = [];
let autoSummaryTimer = null;
let autoAdvanceTimer = null;

// --- Public API ---

export function initCaptures(navigateFn) {
  navigate = navigateFn;
  createDigitButtons();
  document.getElementById('btn-captures-done').addEventListener('click', showSummary);
  document.getElementById('btn-captures-show').addEventListener('click', handleShow);
  document.getElementById('captures-board').addEventListener('click', handleBoardClick);
}

// Returns a single puzzle object for use by the Mix drill.
export async function fetchCapturesPuzzle() {
  const { fen, puzzleId } = await fetchValidFen();
  const movesW = getCapturesForColor(fen, 'w');
  const movesB = getCapturesForColor(fen, 'b');
  return {
    fen, puzzleId, type: 'captures',
    answerW: Math.min(movesW.length, 9),
    answerB: Math.min(movesB.length, 9),
    movesW, movesB,
    difficulty: scoreCountDifficulty(fen, movesW.length + movesB.length),
  };
}

export async function startCaptures() {
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
  const ansW = countCapturesForColor(fen, 'w');
  const ansB = countCapturesForColor(fen, 'b');
  return { fen, puzzleId, answerW: ansW, answerB: ansB,
           difficulty: scoreCountDifficulty(fen, ansW + ansB) };
}

// --- Puzzle loading ---

async function loadNextPuzzle() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) { showSummary(); return; }
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('captures-puzzle-num').textContent = `#${puzzleCount}`;

  if (puzzleQueue.length === 0) {
    setStatus('Loading…');
    await fillQueue();
  }
  const puzzle = puzzleQueue.shift();
  currentPuzzleId = puzzle.puzzleId;
  currentFen      = puzzle.fen;
  answerW         = puzzle.answerW;
  answerB         = puzzle.answerB;
  showDifficulty('captures-diff', puzzle.difficulty);
  if (puzzleQueue.length === 0) fillQueue();

  if (!board) {
    board = new Chessboard(document.getElementById('captures-board'), {
      position: currentFen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Arrows, props: { sprite: ARROWS_SVG_URL, headSize: 6 } }],
    });
  } else {
    board.setPosition(currentFen, false);
  }

  updateSessionStats();
  setStatus('');
  puzzleActive = true;
  startTimer();
}

// Retry up to 5 times to find a position where neither side starts in check.
// A position with the side-to-move in check restricts that side's legal moves
// (must escape check), producing an artificially low capture count.
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
  // Check side-to-move
  const tmp1 = new Chess();
  try { tmp1.load(fen); } catch { return true; }
  if (tmp1.inCheck()) return true;
  // Check the other side by flipping turn
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

// --- Capture counting ---

// Returns [{from, to}] for every capturing move available to colorChar.
// Pawn promotions by capture to the same destination square count once:
// the first promotion piece encountered records the (from, to) pair.
function getCapturesForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar;
  parts[3] = '-';
  const modFen = parts.join(' ');
  const tmp = new Chess();
  try { tmp.load(modFen); } catch { return []; }
  const found = new Set();
  return tmp.moves({ verbose: true })
    .filter(m => {
      if (!m.captured) return false;
      const key = m.from + m.to;
      if (found.has(key)) return false;
      found.add(key);
      return true;
    })
    .map(m => ({ from: m.from, to: m.to }));
}

function countCapturesForColor(fen, colorChar) {
  return Math.min(getCapturesForColor(fen, colorChar).length, 9);
}

function handleShow() {
  if (waitingForContinue) {
    if (showingCaptures) hideCaptures(); else showCaptures();
    return;
  }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  if (puzzleActive) {
    puzzleActive = false;
    stopTimer();
    if (!correctW) misses++;
    if (!correctB) misses++;
    document.getElementById('captures-misses').textContent = `Misses: ${misses}`;
    drillResults.push({ seconds, correct: correctAnswers, misses });
    upsertDrillDay('captures', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
    updateSessionStats();
  }
  showCaptures();
  setStatus('Click board to continue');
  waitingForContinue = true;
}

function handleBoardClick() {
  if (!waitingForContinue) return;
  waitingForContinue = false;
  hideCaptures();
  setStatus('');
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) showSummary();
  else loadNextPuzzle();
}

function showCaptures() {
  if (!board || !currentFen) return;
  board.removeArrows();
  clearNoMovesMessage('captures-board');
  for (const m of getCapturesForColor(currentFen, 'w')) board.addArrow(ARROW_WHITE_CAP, m.from, m.to);
  for (const m of getCapturesForColor(currentFen, 'b')) board.addArrow(ARROW_BLACK_CAP, m.from, m.to);
  if (answerW === 0 && answerB === 0) {
    setTimeout(() => showNoMovesMessage('captures-board'), 50);
  } else {
    setTimeout(labelArrows, 50);
  }
  showingCaptures = true;
  document.getElementById('btn-captures-show').classList.add('active');
}

function hideCaptures() {
  if (!board) return;
  board.removeArrows();
  clearArrowLabels();
  clearNoMovesMessage('captures-board');
  showingCaptures = false;
  const btn = document.getElementById('btn-captures-show');
  if (btn) btn.classList.remove('active');
}

function labelArrows() {
  clearArrowLabels();
  const boardEl = document.getElementById('captures-board');
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
  const boardEl = document.getElementById('captures-board');
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
    `#screen-captures .digit-btn[data-color="${color}"][data-value="${value}"]`
  );
  if (!btn || btn.classList.contains('correct') || btn.classList.contains('incorrect')) return;

  const correct = isWhite ? answerW : answerB;
  if (value === 7 ? correct >= 7 : value === correct) {
    btn.classList.add('correct');
    correctAnswers++;
    if (isWhite) correctW = true; else correctB = true;
    if (correctW && correctB) puzzleComplete();
  } else {
    btn.classList.add('incorrect');
    misses++;
    document.getElementById('captures-misses').textContent = `Misses: ${misses}`;
  }
}

function puzzleComplete() {
  puzzleActive = false;
  stopTimer();
  drillResults.push({ seconds, correct: correctAnswers, misses });
  upsertDrillDay('captures', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
  updateSessionStats();

  // Flash the correct buttons
  document.querySelectorAll('#screen-captures .digit-btn.correct').forEach(btn => btn.classList.add('flashing'));

  const limit = getPositionsPerDrill();
  const limitReached = limit !== null && drillResults.length >= limit;
  if (limitReached) {
    autoSummaryTimer = setTimeout(showSummary, 1500);
  } else {
    autoAdvanceTimer = setTimeout(loadNextPuzzle, 1500);
  }
}

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses = drillResults.reduce((s, r) => s + r.misses, 0);
  const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
  const avgSecs = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('captures-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('captures-session-acc').textContent = `Acc ${accuracy}%`;
  document.getElementById('captures-session-stats').classList.remove('hidden');
}

// --- Summary ---

async function showSummary() {
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  stopTimer();
  // Wire "Play Again" to this drill's restart so the shared summary screen works for both drills
  document.getElementById('btn-summary-again').onclick = restartDrill;

  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  await updateSummaryGoals('captures', count);
  if (count > 0) {
    const totalSeconds = drillResults.reduce((s, r) => s + r.seconds, 0);
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses = drillResults.reduce((s, r) => s + r.misses, 0);
    const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
    document.getElementById('stat-avg-time').textContent = formatTime(Math.round(totalSeconds / count));
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
    const { accMet, timeMet } = await checkGoals('captures', count, totalCorrect, totalMisses, totalSeconds);
    if (accMet || timeMet) await showGoalCelebration(accMet, timeMet, accuracy, totalSeconds / count);
    const isPB = await checkAndUpdatePB('captures', count, totalCorrect, totalMisses, totalSeconds);
    if (isPB) await showPBCelebration();
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

async function restartDrill() {
  navigate('screen-captures');
  resetDrill();
  await loadNextPuzzle();
}

// --- UI helpers ---

function createDigitButtons() {
  [['cap-digits-white', 'w'], ['cap-digits-black', 'b']].forEach(([containerId, color]) => {
    const container = document.getElementById(containerId);
    for (let i = 0; i <= 7; i++) {
      const btn = document.createElement('button');
      btn.className = 'digit-btn';
      btn.dataset.color = color;
      btn.dataset.value = i;
      btn.textContent = i === 7 ? '7+' : i;
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
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  waitingForContinue = false;
  puzzleCount = 0;
  drillResults.length = 0;
  puzzleQueue = [];
  document.getElementById('captures-session-time').textContent = '';
  document.getElementById('captures-session-acc').textContent = '';
  document.getElementById('captures-session-stats').classList.add('hidden');
}

function resetUI() {
  correctW = correctB = false;
  misses = seconds = correctAnswers = 0;
  waitingForContinue = false;
  hideCaptures();
  document.getElementById('captures-timer').textContent = '0:00';
  document.getElementById('captures-misses').textContent = 'Misses: 0';
  document.querySelectorAll('#screen-captures .digit-btn').forEach(b =>
    b.classList.remove('correct', 'incorrect', 'flashing')
  );
  if (document.activeElement?.classList.contains('digit-btn')) document.activeElement.blur();
}

function setStatus(msg) {
  document.getElementById('captures-status').textContent = msg;
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('captures-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
