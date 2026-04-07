import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const ARROWS_SVG_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/arrows/arrows.svg';

const ARROW_WHITE_CAP = { class: 'arrow-white-cap' };
const ARROW_BLACK_CAP = { class: 'arrow-black-cap' };

// P=1, N=3, B=3, R=5, Q=9, K=Infinity
// A target qualifies if: it's the king, OR its value is STRICTLY GREATER than
// the forking piece (profitable capture even if defended), OR it's loose (free capture).
// A defended piece worth equal or less than the forking piece does NOT qualify.
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: Infinity };

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
let showingForks = false;
const drillResults = [];
let navigate = null;

// --- Public API ---

export function initForks(navigateFn) {
  navigate = navigateFn;
  createDigitButtons();
  document.getElementById('btn-forks-done').addEventListener('click', showSummary);
  document.getElementById('btn-forks-next').addEventListener('click', loadNextPuzzle);
  document.getElementById('btn-forks-show').addEventListener('click', () => {
    if (showingForks) hideForks();
    else showForks();
  });
}

export async function startForks() {
  resetDrill();
  await loadNextPuzzle();
}

// --- Puzzle loading ---

async function loadNextPuzzle() {
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('forks-puzzle-num').textContent = `#${puzzleCount}`;
  setStatus('Loading puzzle…');

  const { fen, puzzleId } = await fetchValidFen();
  currentPuzzleId = puzzleId;
  currentFen = fen;

  if (!board) {
    board = new Chessboard(document.getElementById('forks-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Arrows, props: { sprite: ARROWS_SVG_URL, headSize: 6 } }],
    });
  } else {
    board.setPosition(fen, false);
  }

  answerW = countForksForColor(fen, 'w');
  answerB = countForksForColor(fen, 'b');

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

// --- Fork detection ---

// Returns [{from, to}] for every move by colorChar that creates a fork.
// A fork: the moved piece NEWLY attacks 2+ enemy pieces after the move, where
// each newly-attacked piece qualifies as a real threat:
//   - the king (must always respond), OR
//   - strictly greater value than the forking piece (profitable capture
//     even if defended), OR
//   - loose (zero defenders — can be taken for free regardless of value)
// A defended piece worth equal or less than the forking piece does NOT qualify.
// "Newly attacked" means the piece was NOT already attacked by the moving piece
// before the move (the move itself must create the threat).
function getForksForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar;
  parts[3] = '-';
  const modFen = parts.join(' ');
  const tmp = new Chess();
  try { tmp.load(modFen); } catch { return []; }

  const enemy = colorChar === 'w' ? 'b' : 'w';
  const forkMoves = [];
  const forkFound = new Set(); // dedup pawn promotions: count (from,to) once

  for (const move of tmp.moves({ verbose: true })) {
    // Pre-move: record enemy squares already attacked by the piece at move.from
    const preAttacked = new Set();
    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank++) {
        const sq = `${file}${rank}`;
        const p = tmp.get(sq);
        if (!p || p.color !== enemy) continue;
        if (tmp.attackers(sq, colorChar).includes(move.from)) preAttacked.add(sq);
      }
    }

    tmp.move(move);
    const movedValue = PIECE_VALUES[move.piece];
    let qualifyingTargets = 0;

    for (const file of 'abcdefgh') {
      for (let rank = 1; rank <= 8; rank++) {
        const sq = `${file}${rank}`;
        const piece = tmp.get(sq);
        if (!piece || piece.color !== enemy) continue;

        // Only count newly-attacked squares (move creates the threat)
        if (preAttacked.has(sq)) continue;

        // Moved piece must attack this square in the post-move position
        if (!tmp.attackers(sq, colorChar).includes(move.to)) continue;

        // King always qualifies
        if (piece.type === 'k') { qualifyingTargets++; continue; }

        // Qualifies if value strictly > forking piece (profitable capture) OR loose (free capture)
        const isProfitable = PIECE_VALUES[piece.type] > movedValue;
        const isLoose = tmp.attackers(sq, enemy).length === 0;
        if (isProfitable || isLoose) qualifyingTargets++;
      }
    }

    tmp.undo();
    if (qualifyingTargets >= 2) {
      const key = move.from + move.to;
      if (!forkFound.has(key)) {
        forkFound.add(key);
        forkMoves.push({ from: move.from, to: move.to });
      }
    }
  }

  return forkMoves;
}

function countForksForColor(fen, colorChar) {
  return Math.min(getForksForColor(fen, colorChar).length, 9);
}

// --- Digit button interaction ---

function handleDigitClick(color, value) {
  if (!puzzleActive) return;
  const isWhite = color === 'w';
  if (isWhite && correctW) return;
  if (!isWhite && correctB) return;

  const btn = document.querySelector(
    `#screen-forks .digit-btn[data-color="${color}"][data-value="${value}"]`
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
    document.getElementById('forks-misses').textContent = `Misses: ${misses}`;
  }
}

function puzzleComplete() {
  puzzleActive = false;
  stopTimer();
  drillResults.push({ seconds, correct: correctAnswers, misses });
  upsertDrillDay('forks', { seconds, correct: correctAnswers, misses, puzzleId: currentPuzzleId });
  updateSessionStats();
  const el = document.getElementById('forks-result');
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
  document.getElementById('forks-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('forks-session-acc').textContent = `Acc ${accuracy}%`;
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
  navigate('screen-forks');
  resetDrill();
  await loadNextPuzzle();
}

// --- SHOW arrows ---

function showForks() {
  if (!board || !currentFen) return;
  board.removeArrows();
  clearNoMovesMessage('forks-board');
  for (const m of getForksForColor(currentFen, 'w')) board.addArrow(ARROW_WHITE_CAP, m.from, m.to);
  for (const m of getForksForColor(currentFen, 'b')) board.addArrow(ARROW_BLACK_CAP, m.from, m.to);
  if (answerW === 0 && answerB === 0) {
    setTimeout(() => showNoMovesMessage('forks-board'), 50);
  } else {
    setTimeout(labelArrows, 50);
  }
  showingForks = true;
  document.getElementById('btn-forks-show').classList.add('active');
}

function hideForks() {
  if (!board) return;
  board.removeArrows();
  clearArrowLabels();
  clearNoMovesMessage('forks-board');
  showingForks = false;
  const btn = document.getElementById('btn-forks-show');
  if (btn) btn.classList.remove('active');
}

function labelArrows() {
  clearArrowLabels();
  const boardEl = document.getElementById('forks-board');
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
  const boardEl = document.getElementById('forks-board');
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

// --- UI helpers ---

function createDigitButtons() {
  [['forks-digits-white', 'w'], ['forks-digits-black', 'b']].forEach(([containerId, color]) => {
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
  document.getElementById('forks-session-time').textContent = '';
  document.getElementById('forks-session-acc').textContent = '';
}

function resetUI() {
  correctW = correctB = false;
  misses = seconds = correctAnswers = 0;
  hideForks();
  document.getElementById('forks-timer').textContent = '0:00';
  document.getElementById('forks-misses').textContent = 'Misses: 0';
  const result = document.getElementById('forks-result');
  result.classList.add('hidden');
  result.textContent = '';
  document.querySelectorAll('#screen-forks .digit-btn').forEach(b =>
    b.classList.remove('correct', 'incorrect')
  );
}

function setStatus(msg) {
  document.getElementById('forks-status').textContent = msg;
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('forks-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
