import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';
import { checkAndUpdatePB, showPBCelebration, checkGoals, showGoalCelebration, updateSummaryGoals } from './pb.js';
import { scoreCountDifficulty, diffLabel } from './difficulty.js';
import { registerPause } from './pause.js';

const PIECES_URL    = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const ARROWS_SVG_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/arrows/arrows.svg';

const ARROW_WHITE_CAP  = { class: 'arrow-white-cap' };
const ARROW_BLACK_CAP  = { class: 'arrow-black-cap' };
const ARROW_LAST_MOVE  = { class: 'arrow-last-move' };

const FALLBACK_FENS = [
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 b kq - 5 6',
  'rnbq1rk1/ppp2pbp/3p1np1/3Pp3/2P5/2N2NP1/PP2PPBP/R1BQ1RK1 b - - 0 8',
  'r2qkb1r/ppp2ppp/2np1n2/4p1B1/2B1P3/2NP1N2/PPP2PPP/R2QK2R b KQkq - 1 8',
  'r1bqr1k1/ppp2pbp/2np1np1/3Pp3/2P5/2N1BNP1/PP2PPBP/R2Q1RK1 w - - 2 10',
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
let currentLastMove = null;
let showingPawns = false;
let waitingForContinue = false;
const drillResults = [];
let navigate = null;
let puzzleQueue = [];
let queueVersion = 0;
let autoSummaryTimer = null;
let autoAdvanceTimer = null;

// --- Public API ---

export function initPawns(navigateFn) {
  navigate = navigateFn;
  createDigitButtons();
  document.getElementById('btn-pawns-done').addEventListener('click', showSummary);
  document.getElementById('btn-pawns-show').addEventListener('click', handleShow);
  document.getElementById('pawns-board').addEventListener('click', handleBoardClick);
}

export async function startPawns() {
  registerPause(stopTimer, startTimer);
  resetDrill();
  setStatus('Loading session…');
  await fillQueue();
  await loadNextPuzzle();
  stopTimer();
  seconds = 0;
  document.getElementById('pawns-timer').textContent = '0:00';
  startTimer();
}

async function fillQueue() {
  const myVersion = queueVersion;
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => fetchWithDifficulty())
  );
  if (myVersion !== queueVersion) return;
  const valid = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  valid.sort((a, b) => a.difficulty - b.difficulty);
  puzzleQueue.push(...valid);
}

async function fetchWithDifficulty() {
  const { fen, puzzleId, lastMove } = await fetchValidFen();
  const movesW = getPawnMovesForColor(fen, 'w');
  const movesB = getPawnMovesForColor(fen, 'b');
  const ansW = Math.min(movesW.length, 9);
  const ansB = Math.min(movesB.length, 9);
  return { fen, puzzleId, lastMove, answerW: ansW, answerB: ansB,
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
  updateProgress();

  if (puzzleQueue.length === 0) {
    setStatus('Loading…');
    await fillQueue();
  }
  const puzzle = puzzleQueue.shift();
  currentPuzzleId = puzzle.puzzleId;
  currentFen      = puzzle.fen;
  currentLastMove = puzzle.lastMove;
  answerW         = puzzle.answerW;
  answerB         = puzzle.answerB;
  showDifficulty('pawns-diff', puzzle.difficulty);
  if (puzzleQueue.length === 0) fillQueue();

  if (!board) {
    board = new Chessboard(document.getElementById('pawns-board'), {
      position: currentFen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Arrows, props: { sprite: ARROWS_SVG_URL, headSize: 6 } }],
    });
  } else {
    board.setPosition(currentFen, false);
  }

  // Show the last-move arrow so en passant context is visible
  if (currentLastMove) {
    setTimeout(() => {
      board.removeArrows();
      board.addArrow(ARROW_LAST_MOVE, currentLastMove.from, currentLastMove.to);
    }, 80);
  }

  updateSessionStats();
  setStatus('');
  puzzleActive = true;
  startTimer();
}

async function fetchValidFen() {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fetchLichessPuzzle();
    } catch (err) {
      console.warn('Lichess unavailable, using fallback:', err.message);
      break;
    }
  }
  const fen = FALLBACK_FENS[Math.floor(Math.random() * FALLBACK_FENS.length)];
  return { fen, puzzleId: '', lastMove: null };
}

async function fetchLichessPuzzle() {
  const resp = await fetch('https://lichess.org/api/puzzle/next', {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  return parsePuzzleData(data);
}

function parsePuzzleData(data) {
  const gameChess = new Chess();
  gameChess.loadPgn(data.game.pgn);
  const allMoves = gameChess.history({ verbose: true });
  const puzzleChess = new Chess();
  const ply = Math.min(data.puzzle.initialPly, allMoves.length);
  for (let i = 0; i < ply; i++) puzzleChess.move(allMoves[i].san);
  const last = ply > 0 ? allMoves[ply - 1] : null;
  return {
    fen: puzzleChess.fen(),
    puzzleId: data.puzzle.id ?? '',
    lastMove: last ? { from: last.from, to: last.to } : null,
  };
}

// --- Pawn move counting ---

// Returns [{from, to}] for every legal pawn move by colorChar.
// Promotions to the same square are deduplicated (count as one move).
// EP is preserved only for the side that actually has the option.
function getPawnMovesForColor(fen, colorChar) {
  const parts = fen.split(' ');
  const sideToMove = parts[1];
  const modParts = parts.slice();
  modParts[1] = colorChar;
  // EP is valid only for the side that is currently to move
  if (colorChar !== sideToMove) modParts[3] = '-';
  const tmp = new Chess();
  try { tmp.load(modParts.join(' ')); } catch { return []; }
  const found = new Set();
  const result = [];
  for (const m of tmp.moves({ verbose: true })) {
    if (m.piece !== 'p') continue;
    const key = m.from + m.to;
    if (found.has(key)) continue;
    found.add(key);
    result.push({ from: m.from, to: m.to });
  }
  return result;
}

// --- SHOW / hide ---

function handleShow() {
  if (waitingForContinue) {
    if (showingPawns) hidePawns(); else showPawns();
    return;
  }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  if (puzzleActive) {
    puzzleActive = false;
    stopTimer();
    if (!correctW) misses++;
    if (!correctB) misses++;
    document.getElementById('pawns-misses').textContent = `Misses: ${misses}`;
    drillResults.push({ seconds, correct: correctAnswers, misses });
    upsertDrillDay('pawns', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
    updateSessionStats();
  }
  showPawns();
  setStatus('Click board to continue');
  waitingForContinue = true;
}

function handleBoardClick() {
  if (!waitingForContinue) return;
  waitingForContinue = false;
  hidePawns();
  setStatus('');
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) showSummary();
  else loadNextPuzzle();
}

function showPawns() {
  if (!board || !currentFen) return;
  board.removeArrows();
  clearNoMovesMessage('pawns-board');
  // Last-move arrow first (drawn under pawn arrows)
  if (currentLastMove) board.addArrow(ARROW_LAST_MOVE, currentLastMove.from, currentLastMove.to);
  for (const m of getPawnMovesForColor(currentFen, 'w')) board.addArrow(ARROW_WHITE_CAP, m.from, m.to);
  for (const m of getPawnMovesForColor(currentFen, 'b')) board.addArrow(ARROW_BLACK_CAP, m.from, m.to);
  const totalMoves = answerW + answerB;
  if (totalMoves === 0) {
    setTimeout(() => showNoMovesMessage('pawns-board'), 50);
  } else {
    setTimeout(labelArrows, 50);
  }
  showingPawns = true;
  document.getElementById('btn-pawns-show').classList.add('active');
}

function hidePawns() {
  if (!board) return;
  board.removeArrows();
  clearArrowLabels();
  clearNoMovesMessage('pawns-board');
  // Restore last-move arrow after hiding solution arrows
  if (currentLastMove) {
    setTimeout(() => board.addArrow(ARROW_LAST_MOVE, currentLastMove.from, currentLastMove.to), 50);
  }
  showingPawns = false;
  const btn = document.getElementById('btn-pawns-show');
  if (btn) btn.classList.remove('active');
}

function labelArrows() {
  clearArrowLabels();
  const boardEl = document.getElementById('pawns-board');
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
  const boardEl = document.getElementById('pawns-board');
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
    `#screen-pawns .digit-btn[data-color="${color}"][data-value="${value}"]`
  );
  if (!btn || btn.classList.contains('correct') || btn.classList.contains('incorrect')) return;

  btn.classList.remove('idle');
  const correct = isWhite ? answerW : answerB;
  if (value === 7 ? correct >= 7 : value === correct) {
    btn.classList.add('correct');
    correctAnswers++;
    if (isWhite) correctW = true; else correctB = true;
    if (correctW && correctB) puzzleComplete();
  } else {
    btn.classList.add('incorrect');
    misses++;
    document.getElementById('pawns-misses').textContent = `Misses: ${misses}`;
  }
  btn.blur();
}

function puzzleComplete() {
  puzzleActive = false;
  stopTimer();
  drillResults.push({ seconds, correct: correctAnswers, misses });
  upsertDrillDay('pawns', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
  updateSessionStats();

  document.querySelectorAll('#screen-pawns .digit-btn.correct').forEach(btn => btn.classList.add('flashing'));

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

function updateProgress() {
  const fill  = document.getElementById('pawns-progress-fill');
  const label = document.getElementById('pawns-progress-label');
  if (!fill || !label) return;
  const limit = getPositionsPerDrill();
  const n = puzzleCount;
  let pct, text;
  if (limit === null) {
    pct = 10;
    text = `${n} / ∞`;
  } else {
    pct = Math.min(Math.round(n / limit * 100), 100);
    text = pct >= 100 ? `${n}` : `${n} / ${limit}`;
  }
  fill.style.width = `${pct}%`;
  label.textContent = text;
  label.style.left  = `calc(${pct}% + 4px)`;
  label.style.right = 'auto';
}

// --- Session stats ---

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses  = drillResults.reduce((s, r) => s + r.misses, 0);
  const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
  const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('pawns-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('pawns-session-acc').textContent  = `Acc ${accuracy}%`;
  document.getElementById('pawns-session-stats').classList.remove('hidden');
}

// --- Summary ---

async function showSummary() {
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  stopTimer();
  document.getElementById('btn-summary-again').onclick = restartDrill;

  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  await updateSummaryGoals('pawns', count);
  if (count > 0) {
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses, 0);
    const totalSeconds = drillResults.reduce((s, r) => s + r.seconds, 0);
    const accuracy = Math.round(totalCorrect / (totalCorrect + totalMisses) * 100);
    const avgTime  = totalSeconds / count;
    document.getElementById('stat-avg-time').textContent  = formatTime(Math.round(avgTime));
    document.getElementById('stat-accuracy').textContent  = `${accuracy}%`;
    const { accMet, timeMet } = await checkGoals('pawns', count, totalCorrect, totalMisses, totalSeconds);
    if (accMet || timeMet) await showGoalCelebration(accMet, timeMet, accuracy, avgTime);
    const isPB = await checkAndUpdatePB('pawns', count, totalCorrect, totalMisses, totalSeconds);
    if (isPB) await showPBCelebration();
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

async function restartDrill() {
  navigate('screen-pawns');
  await startPawns();
}

// --- UI helpers ---

function createDigitButtons() {
  [['pawns-digits-white', 'w'], ['pawns-digits-black', 'b']].forEach(([containerId, color]) => {
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
  if (localStorage.getItem('chesssight-show-difficulty') !== 'true') {
    el.textContent = '';
    el.className = 'drill-difficulty';
    return;
  }
  const { text, cls } = diffLabel(score);
  el.textContent = text;
  el.className = `drill-difficulty ${cls}`;
}

function resetDrill() {
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  waitingForContinue = false;
  queueVersion++;
  puzzleCount = 0;
  drillResults.length = 0;
  puzzleQueue = [];
  document.getElementById('pawns-session-time').textContent = '';
  document.getElementById('pawns-session-acc').textContent  = '';
  document.getElementById('pawns-session-stats').classList.add('hidden');
  const fill = document.getElementById('pawns-progress-fill');
  if (fill) fill.style.width = '0%';
  const label = document.getElementById('pawns-progress-label');
  if (label) label.textContent = '';
}

function resetUI() {
  correctW = correctB = false;
  misses = seconds = correctAnswers = 0;
  waitingForContinue = false;
  hidePawns();
  document.getElementById('pawns-timer').textContent  = '0:00';
  document.getElementById('pawns-misses').textContent = 'Misses: 0';
  document.querySelectorAll('#screen-pawns .digit-btn').forEach(b => {
    b.classList.remove('correct', 'incorrect', 'flashing');
    b.classList.add('idle');
    b.blur();
  });
  if (document.activeElement?.classList.contains('digit-btn')) document.activeElement.blur();
}

function setStatus(msg) {
  document.getElementById('pawns-status').textContent = msg;
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('pawns-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
