import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { upsertDrillDay } from './storage.js';
import { registerPause } from './pause.js';
import { diffLabel } from './difficulty.js';
import { fetchChecksPuzzle } from './checks.js';
import { fetchCapturesPuzzle } from './captures.js';
import { fetchLoosePuzzle } from './loose.js';
import { fetchUnderPuzzle } from './under.js';
import { generateQueenPuzzle } from './queen.js';
import { generateHangGrabPuzzle } from './hanggrab.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const ARROWS_SVG_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/arrows/arrows.svg';

// Drill descriptor table
const DRILL_DEFS = {
  checks:   { label: 'COUNT CHECKS',   type: 'count', fetch: fetchChecksPuzzle   },
  captures: { label: 'COUNT CAPTURES', type: 'count', fetch: fetchCapturesPuzzle },
  loose:    { label: 'LOOSE PIECES',   type: 'click', fetch: fetchLoosePuzzle    },
  under:    { label: 'UNDERGUARDED',    type: 'click', fetch: fetchUnderPuzzle    },
  queen:    { label: 'QUEEN ATTACK',   type: 'click', fetch: generateQueenPuzzle },
  hanggrab: { label: 'HANG GRAB',      type: 'click', fetch: generateHangGrabPuzzle },
};

// ─── Module state ─────────────────────────────────────────────────────────────

let board = null;
let navigate = null;
let selectedDrills = [];
let currentDrill = null;
let currentPuzzle = null;
let puzzleActive = false;
let waitingToAdvance = false;
let showingAnswers = false;   // count drills: arrows shown

// Click drill per-puzzle state
let foundTargets = new Set();
let markedSquares = new Set();
let puzzleMisses = 0;         // wrong clicks this puzzle (not yet in sessionMisses)

// Count drill per-puzzle state
let correctW = false;
let correctB = false;

// Session totals
let puzzleCount = 0;
let sessionMisses = 0;
let seconds = 0;
let timerInterval = null;
const drillResults = [];

// ─── Public API ───────────────────────────────────────────────────────────────

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

export function initMix(navigateFn) {
  navigate = navigateFn;

  document.querySelectorAll('#mix-checkboxes input[type=checkbox]').forEach(cb =>
    cb.addEventListener('change', updateStartButton)
  );
  document.getElementById('btn-mix-start').addEventListener('click', startSession);
  document.getElementById('btn-mix-done').addEventListener('click', endSession);
  document.getElementById('btn-mix-done-click').addEventListener('click', handleClickDone);
  document.getElementById('btn-mix-show').addEventListener('click', handleShow);
  document.getElementById('mix-board').addEventListener('click', handleBoardClick);

  createDigitButtons();
}

export function startMix() {
  showSelectionPanel();
}

// ─── Selection panel ──────────────────────────────────────────────────────────

function showSelectionPanel() {
  document.getElementById('mix-select-panel').classList.remove('hidden');
  document.getElementById('mix-puzzle-panel').classList.add('hidden');
  updateStartButton();
}

function updateStartButton() {
  const n = document.querySelectorAll('#mix-checkboxes input[type=checkbox]:checked').length;
  document.getElementById('btn-mix-start').disabled = n < 2;
}

function startSession() {
  selectedDrills = [...document.querySelectorAll('#mix-checkboxes input[type=checkbox]:checked')]
    .map(cb => cb.value);

  puzzleCount = 0;
  sessionMisses = 0;
  drillResults.length = 0;
  document.getElementById('mix-session-time').textContent = '';
  document.getElementById('mix-session-acc').textContent  = '';
  document.getElementById('mix-misses').textContent = 'Misses: 0';

  document.getElementById('mix-select-panel').classList.add('hidden');
  document.getElementById('mix-puzzle-panel').classList.remove('hidden');

  registerPause(pauseDrill, resumeDrill);
  loadNextPuzzle();
}

// ─── Puzzle lifecycle ─────────────────────────────────────────────────────────

async function loadNextPuzzle() {
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) {
    endSession();
    return;
  }
  puzzleActive = false;
  waitingToAdvance = false;
  showingAnswers = false;
  stopTimer();
  clearOverlays();
  if (board) board.removeArrows?.();
  setStatus('');

  // Reset per-puzzle state
  foundTargets = new Set();
  markedSquares = new Set();
  puzzleMisses = 0;
  correctW = false;
  correctB = false;

  puzzleCount++;
  document.getElementById('mix-puzzle-num').textContent = `#${puzzleCount}`;

  // Randomly pick from selected drills
  currentDrill = selectedDrills[Math.floor(Math.random() * selectedDrills.length)];
  const def = DRILL_DEFS[currentDrill];
  document.getElementById('mix-drill-label').textContent = def.label;

  const isCount = def.type === 'count';
  document.getElementById('mix-count-panel').classList.toggle('hidden', !isCount);
  document.getElementById('btn-mix-done-click').classList.toggle('hidden', isCount);

  const showBtn = document.getElementById('btn-mix-show');
  showBtn.textContent = 'SHOW';
  showBtn.classList.remove('active');

  if (isCount) {
    document.querySelectorAll('#mix-count-panel .digit-btn').forEach(b =>
      b.classList.remove('correct', 'incorrect')
    );
  } else {
    document.getElementById('btn-mix-done-click').textContent = 'DONE';
  }

  setStatus('Loading…');
  currentPuzzle = await Promise.resolve(def.fetch());

  if (board) {
    board.setPosition(currentPuzzle.fen, false);
  } else {
    board = new Chessboard(document.getElementById('mix-board'), {
      position: currentPuzzle.fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Arrows, props: { sprite: ARROWS_SVG_URL, headSize: 6 } }],
    });
  }

  if (currentPuzzle.difficulty !== undefined) {
    const { text, cls } = diffLabel(currentPuzzle.difficulty);
    const el = document.getElementById('mix-diff');
    el.textContent = text;
    el.className = `drill-difficulty ${cls}`;
  } else {
    document.getElementById('mix-diff').textContent = '';
  }

  setStatus('');
  startTimer();
  puzzleActive = true;
}

// ─── Board click (click drills) ───────────────────────────────────────────────

function handleBoardClick(e) {
  if (!currentDrill || DRILL_DEFS[currentDrill].type !== 'click') return;
  if (waitingToAdvance) { loadNextPuzzle(); return; }
  if (!puzzleActive) return;

  const sq = sqFromClick(e);
  if (!sq) return;

  const hasPiece = currentPuzzle.pieceSquares.has(sq);
  // Queen drill: click empty squares. Other click drills: click piece squares.
  if (currentDrill === 'queen' ? hasPiece : !hasPiece) return;

  // Loose / Under allow toggling off a correct click
  if ((currentDrill === 'loose' || currentDrill === 'under') && foundTargets.has(sq)) {
    foundTargets.delete(sq);
    markedSquares.delete(sq);
    removeOverlay(sq);
    return;
  }

  if (markedSquares.has(sq)) return;
  markedSquares.add(sq);

  if (currentPuzzle.targets.has(sq)) {
    drawSqOverlay(sq, 'hg-sq-correct');
    foundTargets.add(sq);

    if (foundTargets.size === currentPuzzle.targets.size) {
      // All targets found — auto-advance
      const elapsed = finishPuzzle(true, 0);
      setStatus(`✓ ${elapsed}`);
      setTimeout(loadNextPuzzle, 1500);
    }
  } else {
    // Wrong click — flash red, count miss
    flashSqRed(sq);
    puzzleMisses++;
    updateMissesDisplay();
  }
}

function handleClickDone() {
  if (!puzzleActive || DRILL_DEFS[currentDrill]?.type !== 'click') return;
  if (waitingToAdvance) { loadNextPuzzle(); return; }

  const unfound = [...currentPuzzle.targets].filter(sq => !foundTargets.has(sq));
  unfound.forEach(sq => drawSqOverlay(sq, 'hg-sq-reveal'));

  const correct = unfound.length === 0;
  const elapsed = finishPuzzle(correct, unfound.length);

  if (currentPuzzle.targets.size === 0) {
    setStatus(correct ? `✓ Nothing to find!  ${elapsed}` : '');
  } else {
    setStatus(correct ? `✓ All found!  ${elapsed}` : `${unfound.length} missed — see highlights.`);
  }

  document.getElementById('btn-mix-done-click').textContent = 'NEXT';
  waitingToAdvance = true;
}

// ─── Unified SHOW button ──────────────────────────────────────────────────────

function handleShow() {
  if (!currentDrill) return;
  if (DRILL_DEFS[currentDrill].type === 'count') {
    handleCountShow();
  } else {
    handleClickShow();
  }
}

function handleClickShow() {
  if (!puzzleActive) return;
  if (waitingToAdvance) { loadNextPuzzle(); return; }

  const unfound = [...currentPuzzle.targets].filter(sq => !foundTargets.has(sq));
  unfound.forEach(sq => drawSqOverlay(sq, 'hg-sq-reveal'));

  if (currentPuzzle.targets.size === 0) {
    setStatus('Nothing to find here — DONE was correct.');
    finishPuzzle(false, 0);
    document.getElementById('btn-mix-done-click').textContent = 'NEXT';
    waitingToAdvance = true;
  } else if (unfound.length > 0) {
    setStatus('Answer shown.');
    finishPuzzle(false, unfound.length);
    document.getElementById('btn-mix-done-click').textContent = 'NEXT';
    waitingToAdvance = true;
  }
  // If all were already found, puzzle auto-advanced — nothing to do here
}

function handleCountShow() {
  if (!puzzleActive) return;
  const btn = document.getElementById('btn-mix-show');
  if (showingAnswers) {
    board.removeArrows();
    showingAnswers = false;
    btn.classList.remove('active');
    btn.textContent = 'SHOW';
  } else {
    board.removeArrows();
    for (const m of (currentPuzzle.movesW || [])) board.addArrow({ class: 'arrow-white-cap' }, m.from, m.to);
    for (const m of (currentPuzzle.movesB || [])) board.addArrow({ class: 'arrow-black-cap' }, m.from, m.to);
    showingAnswers = true;
    btn.classList.add('active');
    btn.textContent = 'HIDE';
  }
}

// ─── Count drill digit buttons ────────────────────────────────────────────────

function handleCountDigit(color, value) {
  if (!puzzleActive || DRILL_DEFS[currentDrill]?.type !== 'count') return;
  const isW = color === 'w';
  if (isW && correctW) return;
  if (!isW && correctB) return;

  const btn = document.querySelector(
    `#mix-count-panel .digit-btn[data-color="${color}"][data-value="${value}"]`
  );
  if (!btn || btn.classList.contains('correct') || btn.classList.contains('incorrect')) return;

  const answer = isW ? currentPuzzle.answerW : currentPuzzle.answerB;
  const isCorrect = value === 7 ? answer >= 7 : value === answer;

  if (isCorrect) {
    btn.classList.add('correct');
    if (isW) correctW = true; else correctB = true;
    if (correctW && correctB) {
      const elapsed = finishPuzzle(true, 0);
      setStatus(`✓ ${elapsed}`);
      setTimeout(loadNextPuzzle, 1500);
    }
  } else {
    btn.classList.add('incorrect');
    puzzleMisses++;
    updateMissesDisplay();
  }
}

function createDigitButtons() {
  [['mix-digits-w', 'w'], ['mix-digits-b', 'b']].forEach(([id, color]) => {
    const container = document.getElementById(id);
    for (let i = 0; i <= 7; i++) {
      const btn = document.createElement('button');
      btn.className = 'digit-btn';
      btn.dataset.color = color;
      btn.dataset.value = i;
      btn.textContent = i === 7 ? '7+' : i;
      btn.addEventListener('click', () => handleCountDigit(color, i));
      container.appendChild(btn);
    }
  });
}

// ─── finishPuzzle ─────────────────────────────────────────────────────────────

// correct: boolean; extraMisses: unfound target count (click drills only)
function finishPuzzle(correct, extraMisses) {
  puzzleActive = false;
  stopTimer();
  sessionMisses += puzzleMisses + extraMisses;
  document.getElementById('mix-misses').textContent = `Misses: ${sessionMisses}`;
  drillResults.push({ seconds, correct: correct ? 1 : 0, misses: puzzleMisses + extraMisses, drill: currentDrill });
  upsertDrillDay('mix', {
    seconds,
    correct: correct ? 1 : 0,
    misses: puzzleMisses + extraMisses,
    puzzleId: `mix-${currentDrill}-${puzzleCount}`,
  });
  updateSessionStats();
  return formatTime(seconds);
}

// ─── End session / summary ────────────────────────────────────────────────────

function endSession() {
  puzzleActive = false;
  waitingToAdvance = false;
  stopTimer();

  document.getElementById('btn-summary-again').onclick = () => {
    navigate('screen-mix');
    showSelectionPanel();
  };

  const n = drillResults.length;
  document.getElementById('stat-count').textContent = n;
  if (n > 0) {
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
    const accuracy = Math.round(totalCorrect / n * 100);
    const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / n);
    document.getElementById('stat-avg-time').textContent = formatTime(avgSecs);
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

// ─── Session stats (shown in drill-top during session) ────────────────────────

function updateSessionStats() {
  const n = drillResults.length;
  if (!n) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
  const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
  const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / n);
  document.getElementById('mix-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('mix-session-acc').textContent  = `Acc ${accuracy}%`;
}

// ─── Pause ────────────────────────────────────────────────────────────────────

function pauseDrill() {
  if (!puzzleActive) return;
  stopTimer();
}

function resumeDrill() {
  if (!puzzleActive) return;
  startTimer();
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  seconds = 0;
  document.getElementById('mix-timer').textContent = '0:00';
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('mix-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(text) {
  document.getElementById('mix-status').textContent = text;
}

function updateMissesDisplay() {
  document.getElementById('mix-misses').textContent = `Misses: ${sessionMisses + puzzleMisses}`;
}

function getSvgInfo() {
  const boardEl = document.getElementById('mix-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  return { svg, sqSize: boardW / 8 };
}

function sqToXY(sq, sqSize) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]);
  return { x: file * sqSize, y: (8 - rank) * sqSize };
}

function drawSqOverlay(sq, cssClass) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const { x, y } = sqToXY(sq, sqSize);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);
  rect.setAttribute('y', y + 2);
  rect.setAttribute('width',  sqSize - 4);
  rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-mix-sq', sq);
  svg.appendChild(rect);
}

function removeOverlay(sq) {
  const boardEl = document.getElementById('mix-board');
  if (boardEl) boardEl.querySelectorAll(`[data-mix-sq="${sq}"]`).forEach(el => el.remove());
}

function clearOverlays() {
  const boardEl = document.getElementById('mix-board');
  if (boardEl) boardEl.querySelectorAll('[data-mix-sq]').forEach(el => el.remove());
}

function flashSqRed(sq) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const { x, y } = sqToXY(sq, sqSize);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);
  rect.setAttribute('y', y + 2);
  rect.setAttribute('width',  sqSize - 4);
  rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', 'hg-sq-flash');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 600);
}

function sqFromClick(e) {
  const boardEl = document.getElementById('mix-board');
  const rect = boardEl.getBoundingClientRect();
  const file    = Math.floor((e.clientX - rect.left) / rect.width  * 8);
  const rankIdx = 7 - Math.floor((e.clientY - rect.top)  / rect.height * 8);
  if (file < 0 || file > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return String.fromCharCode(97 + file) + (rankIdx + 1);
}
