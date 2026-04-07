import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';

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
const drillResults = [];   // { seconds, correct, misses } per completed puzzle
let navigate = null;       // injected by app.js for screen transitions

// --- Public API ---

export function initCaptures(navigateFn) {
  navigate = navigateFn;
  createDigitButtons();
  document.getElementById('btn-captures-done').addEventListener('click', showSummary);
  document.getElementById('btn-captures-next').addEventListener('click', loadNextPuzzle);
  document.getElementById('btn-captures-show').addEventListener('click', () => {
    if (showingCaptures) hideCaptures();
    else showCaptures();
  });
}

export async function startCaptures() {
  resetDrill();
  await loadNextPuzzle();
}

// --- Puzzle loading ---

async function loadNextPuzzle() {
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('captures-puzzle-num').textContent = `#${puzzleCount}`;
  setStatus('Loading puzzle…');

  const { fen, puzzleId } = await fetchValidFen();
  currentPuzzleId = puzzleId;
  currentFen = fen;

  if (!board) {
    board = new Chessboard(document.getElementById('captures-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Arrows, props: { sprite: ARROWS_SVG_URL } }],
    });
  } else {
    board.setPosition(fen, false);
  }

  answerW = countCapturesForColor(fen, 'w');
  answerB = countCapturesForColor(fen, 'b');

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

function countCapturesForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar;
  parts[3] = '-'; // clear en passant (only valid for original side-to-move)
  const modFen = parts.join(' ');
  const tmp = new Chess();
  try { tmp.load(modFen); } catch { return 0; }
  const count = tmp.moves({ verbose: true }).filter(m => m.captured).length;
  return Math.min(count, 9); // 9 means "9 or more" — matches the "9+" button
}

// Returns [{from, to}] for every capturing move available to colorChar.
function getCapturesForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar;
  parts[3] = '-';
  const modFen = parts.join(' ');
  const tmp = new Chess();
  try { tmp.load(modFen); } catch { return []; }
  return tmp.moves({ verbose: true })
    .filter(m => m.captured)
    .map(m => ({ from: m.from, to: m.to }));
}

function showCaptures() {
  if (!board || !currentFen) return;
  board.removeArrows();
  for (const m of getCapturesForColor(currentFen, 'w')) board.addArrow(ARROW_WHITE_CAP, m.from, m.to);
  for (const m of getCapturesForColor(currentFen, 'b')) board.addArrow(ARROW_BLACK_CAP, m.from, m.to);
  showingCaptures = true;
  document.getElementById('btn-captures-show').classList.add('active');
}

function hideCaptures() {
  if (!board) return;
  board.removeArrows();
  showingCaptures = false;
  const btn = document.getElementById('btn-captures-show');
  if (btn) btn.classList.remove('active');
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
  if (value === correct) {
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
  const el = document.getElementById('captures-result');
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
  document.getElementById('captures-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('captures-session-acc').textContent = `Acc ${accuracy}%`;
}

// --- Summary ---

function showSummary() {
  stopTimer();
  // Wire "Play Again" to this drill's restart so the shared summary screen works for both drills
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
  navigate('screen-captures');
  resetDrill();
  await loadNextPuzzle();
}

// --- UI helpers ---

function createDigitButtons() {
  [['cap-digits-white', 'w'], ['cap-digits-black', 'b']].forEach(([containerId, color]) => {
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
  document.getElementById('captures-session-time').textContent = '';
  document.getElementById('captures-session-acc').textContent = '';
}

function resetUI() {
  correctW = correctB = false;
  misses = seconds = correctAnswers = 0;
  hideCaptures();
  document.getElementById('captures-timer').textContent = '0:00';
  document.getElementById('captures-misses').textContent = 'Misses: 0';
  const result = document.getElementById('captures-result');
  result.classList.add('hidden');
  result.textContent = '';
  document.querySelectorAll('#screen-captures .digit-btn').forEach(b =>
    b.classList.remove('correct', 'incorrect')
  );
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
