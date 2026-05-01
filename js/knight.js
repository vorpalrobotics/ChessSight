import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { upsertDrillDay } from './storage.js';
import { checkAndUpdatePB, showPBCelebration, checkGoals, showGoalCelebration, updateSummaryGoals } from './pb.js';
import { scoreKnightDifficulty, diffLabel } from './difficulty.js';
import { registerPause } from './pause.js';
import { runWalkthrough } from './walkthrough.js';
import { buildWalkthrough } from './helptext.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

// ─── Knight geometry ──────────────────────────────────────────────────────────

function fileOf(sq) { return sq.charCodeAt(0) - 97; }
function rankOf(sq) { return parseInt(sq[1]) - 1; }
function sqName(f, r) { return String.fromCharCode(97 + f) + (r + 1); }

const KNIGHT_DELTAS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

// Returns legal knight moves from sq, excluding blocked squares (future: pawns etc.)
export function knightMoves(sq, blocked = new Set()) {
  const f = fileOf(sq), r = rankOf(sq);
  const result = [];
  for (const [df, dr] of KNIGHT_DELTAS) {
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const ns = sqName(nf, nr);
      if (!blocked.has(ns)) result.push(ns);
    }
  }
  return result;
}

// BFS: returns { dist, path } — path is [sq1,...,targetSq] not including `from`.
// blocked: Set of squares the knight cannot land on.
export function bfs(from, to, blocked = new Set()) {
  if (from === to) return { dist: 0, path: [] };
  const pred = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of knightMoves(cur, blocked)) {
      if (!pred.has(next)) {
        pred.set(next, cur);
        if (next === to) {
          const path = [];
          let c = to;
          while (c !== from) { path.unshift(c); c = pred.get(c); }
          return { dist: path.length, path };
        }
        queue.push(next);
      }
    }
  }
  return { dist: Infinity, path: [] };
}

// Returns squares attacked by black pawns (diagonally toward rank 1)
export function blackPawnAttacks(blackPawns) {
  const attacked = new Set();
  for (const sq of blackPawns) {
    const f = fileOf(sq), r = rankOf(sq);
    if (r > 0) {
      if (f > 0) attacked.add(sqName(f - 1, r - 1));
      if (f < 7) attacked.add(sqName(f + 1, r - 1));
    }
  }
  return attacked;
}

// ─── FEN builder ─────────────────────────────────────────────────────────────

export function buildKnightFen(knightSq, whitePawns = new Set(), blackPawns = new Set()) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const sq = sqName(file, rank);
      let piece = null;
      if (sq === knightSq)       piece = 'N';
      else if (whitePawns.has(sq)) piece = 'P';
      else if (blackPawns.has(sq)) piece = 'p';
      if (piece) { if (empty) { row += empty; empty = 0; } row += piece; }
      else empty++;
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

// Squares eligible for obstacle placement: not on rank 1 or rank 8
const OBSTACLE_CANDIDATES = ALL_SQS.filter(sq => rankOf(sq) > 0 && rankOf(sq) < 7);

function placePawns(count, candidates) {
  const pawns = new Set();
  const fileCounts = new Array(8).fill(0);
  for (const sq of shuffle(candidates)) {
    if (pawns.size >= count) break;
    const f = fileOf(sq);
    if (fileCounts[f] < 3) { pawns.add(sq); fileCounts[f]++; }
  }
  return pawns;
}

export function generateKnightPuzzle() { return generatePosition(); }

function generatePosition() {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const [startSq, targetSq] = shuffle(ALL_SQS);

    // White pawns: 0–8, not on start/target
    const numWhite = Math.floor(Math.random() * 9);
    const whitePawns = placePawns(numWhite,
      OBSTACLE_CANDIDATES.filter(sq => sq !== startSq && sq !== targetSq));

    // Black pawns: 0–8, not on start/target/white pawn squares,
    // and not where they'd attack a white pawn
    const numBlack = Math.floor(Math.random() * 9);
    const blackCandidates = OBSTACLE_CANDIDATES.filter(sq => {
      if (sq === startSq || sq === targetSq || whitePawns.has(sq)) return false;
      const f = fileOf(sq), r = rankOf(sq);
      if (r > 0) {
        if (f > 0 && whitePawns.has(sqName(f - 1, r - 1))) return false;
        if (f < 7 && whitePawns.has(sqName(f + 1, r - 1))) return false;
      }
      return true;
    });
    const blackPawns = placePawns(numBlack, blackCandidates);

    // Blocked = white pawn squares + black pawn squares + squares black pawns attack
    const attacked = blackPawnAttacks(blackPawns);
    const blocked = new Set([...whitePawns, ...blackPawns, ...attacked]);

    const { dist, path } = bfs(startSq, targetSq, blocked);
    if (dist >= 2 && dist <= 6) {
      return { startSq, targetSq, optimalDist: dist, optimalPath: path,
               whitePawns, blackPawns, blocked };
    }
  }
  // Fallback: a1→c5, no pawns
  const { dist, path } = bfs('a1', 'c5');
  return { startSq: 'a1', targetSq: 'c5', optimalDist: dist, optimalPath: path,
           whitePawns: new Set(), blackPawns: new Set(), blocked: new Set() };
}

// ─── Module state ─────────────────────────────────────────────────────────────

let board = null;
let timerInterval = null;
let seconds = 0;
let misses = 0;
let invalidClicks = 0;
let puzzleActive = false;
let puzzleCount = 0;
let currentStartSq = '';
let currentTargetSq = '';
let currentOptimalDist = 0;
let currentOptimalPath = [];
let currentPath = [];      // valid squares clicked by user (not including startSq)
let currentPos = '';       // knight's current position
let currentWhitePawns = new Set();
let currentBlackPawns = new Set();
let currentBlackAttacked = new Set();  // squares attacked by black pawns
let currentObstacles = new Set();      // full blocked set: white + black + attacked
let waitingToAdvance = false;
let solutionShown = false;
const drillResults = [];
let navigate = null;
let puzzleQueue = [];
let autoSummaryTimer = null;
let autoAdvanceTimer = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function initKnightRoute(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-knight-done').addEventListener('click', showSummary);
  document.getElementById('btn-knight-show').addEventListener('click', handleShow);
  document.getElementById('knight-board').addEventListener('click', handleBoardClick);
}

export async function startKnightRoute() {
  registerPause(stopTimer, startTimer);
  resetDrill();
  fillQueue();
  loadNextPuzzle();   // synchronous; starts timer internally
  stopTimer();
  await runWalkthrough('knight', buildWalkthrough('knight'));
  seconds = 0;
  document.getElementById('knight-timer').textContent = '0:00';
  startTimer();
}

function fillQueue() {
  const batch = Array.from({ length: 10 }, () => generatePosition());
  batch.sort((a, b) => scoreKnightDifficulty(a) - scoreKnightDifficulty(b));
  puzzleQueue.push(...batch);
}

// ─── Puzzle loading ───────────────────────────────────────────────────────────

function loadNextPuzzle() {
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) {
    showSummary();
    return;
  }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  stopTimer();
  resetUI();
  puzzleCount++;
  document.getElementById('knight-puzzle-num').textContent = `#${puzzleCount}`;

  if (puzzleQueue.length === 0) fillQueue();
  const pos = puzzleQueue.shift();
  showDifficulty('knight-diff', scoreKnightDifficulty(pos));
  currentStartSq     = pos.startSq;
  currentTargetSq    = pos.targetSq;
  currentOptimalDist = pos.optimalDist;
  currentOptimalPath = pos.optimalPath;
  currentWhitePawns   = pos.whitePawns;
  currentBlackPawns   = pos.blackPawns;
  currentBlackAttacked = blackPawnAttacks(pos.blackPawns);
  currentObstacles    = pos.blocked;
  currentPath        = [];
  currentPos         = pos.startSq;

  const fen = buildKnightFen(pos.startSq, pos.whitePawns, pos.blackPawns);
  if (!board) {
    board = new Chessboard(document.getElementById('knight-board'), {
      position: fen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    board.setPosition(fen, false);
  }

  // Double-rAF: the first frame lets cm-chessboard finish any ResizeObserver-
  // triggered re-render (fired when the screen becomes visible on restart);
  // the second frame draws the target after that re-render completes.
  requestAnimationFrame(() => requestAnimationFrame(() => drawTargetSquare(pos.targetSq)));

  updateSessionStats();
  puzzleActive = true;
  startTimer();
}

// ─── Board click handler ──────────────────────────────────────────────────────

function handleBoardClick(e) {
  if (waitingToAdvance) { loadNextPuzzle(); return; }
  if (!puzzleActive) return;

  const boardEl = document.getElementById('knight-board');
  const rect = boardEl.getBoundingClientRect();
  const file    = Math.floor((e.clientX - rect.left) / rect.width  * 8);
  const rankIdx = 7 - Math.floor((e.clientY - rect.top)  / rect.height * 8);
  if (file < 0 || file > 7 || rankIdx < 0 || rankIdx > 7) return;
  const sq = sqName(file, rankIdx);

  // Re-tap current position = undo last move
  if (sq === currentPos && currentPath.length > 0) {
    undoLastMove();
    return;
  }

  // Ignore start square and already-visited path squares
  if (sq === currentStartSq || currentPath.includes(sq)) return;

  if (!knightMoves(currentPos, currentObstacles).includes(sq)) {
    invalidClicks++;
    misses++;
    document.getElementById('knight-misses').textContent = `Misses: ${misses}`;
    flashInvalid(sq);
    // Show contextual message if it was a geometrically valid knight move blocked by a pawn rule
    if (knightMoves(currentPos).includes(sq)) {
      if (currentBlackPawns.has(sq))       showBoardMessage('Capture not allowed in this drill');
      else if (currentBlackAttacked.has(sq)) showBoardMessage('The pawn could capture you there');
    }
    return;
  }

  // Valid move
  currentPath.push(sq);
  currentPos = sq;
  const sqClass = currentPath.length > currentOptimalDist ? 'knight-sq-over' : 'knight-sq-path';
  drawPathSquare(sq, currentPath.length, sqClass);

  if (sq === currentTargetSq) finishPuzzle();
}

function undoLastMove() {
  const sq = currentPath.pop();
  currentPos = currentPath.length > 0 ? currentPath[currentPath.length - 1] : currentStartSq;
  removeSvgBySq(sq);
}

// ─── Finish puzzle ────────────────────────────────────────────────────────────

function finishPuzzle() {
  puzzleActive = false;
  stopTimer();

  const pathLen    = currentPath.length;
  const extraMoves = Math.max(0, pathLen - currentOptimalDist);
  misses += extraMoves;
  document.getElementById('knight-misses').textContent = `Misses: ${misses}`;

  const correct   = pathLen;
  const isOptimal = extraMoves === 0 && invalidClicks === 0;

  drillResults.push({ seconds, correct, misses });
  upsertDrillDay('knight', { seconds, correct, misses,
    puzzleId: `${currentStartSq}-${currentTargetSq}` });
  updateSessionStats();

  const limit = getPositionsPerDrill();
  const limitReached = limit !== null && drillResults.length >= limit;

  if (isOptimal) {
    // Pulse path squares green and auto-advance — no click needed
    const boardEl = document.getElementById('knight-board');
    if (boardEl) boardEl.querySelectorAll('.knight-sq-path').forEach(el => el.classList.add('pulsing'));
    if (limitReached) {
      autoSummaryTimer = setTimeout(showSummary, 1500);
    } else {
      autoAdvanceTimer = setTimeout(loadNextPuzzle, 1500);
    }
  } else {
    // Sub-optimal or had invalid clicks — pause so user can review / hit SHOW
    if (limitReached) {
      autoSummaryTimer = setTimeout(showSummary, 1000);
    }
    drawContinueMsg();
    waitingToAdvance = true;
  }
}

// ─── SHOW button ──────────────────────────────────────────────────────────────

function handleShow() {
  if (waitingToAdvance) {
    if (!solutionShown) {
      // Puzzle finished sub-optimally — clear the "click to continue" prompt and
      // show the optimal route without re-recording scores
      const boardEl = document.getElementById('knight-board');
      if (boardEl) boardEl.querySelectorAll('.knight-continue-msg').forEach(el => el.remove());
      clearPathMarks();
      currentOptimalPath.forEach((sq, i) => drawPathSquare(sq, i + 1, 'knight-sq-optimal'));
      solutionShown = true;
    } else {
      loadNextPuzzle();
    }
    return;
  }
  if (!puzzleActive) return;
  puzzleActive = false;
  stopTimer();

  // Is user's partial path a prefix of some optimal path?
  // Yes if the remaining distance from currentPos exactly equals remaining budget.
  const remainingBudget = currentOptimalDist - currentPath.length;
  const { dist: remainDist, path: completionPath } =
    remainingBudget >= 0 ? bfs(currentPos, currentTargetSq, currentObstacles) : { dist: Infinity, path: [] };
  const onOptimal = remainDist === remainingBudget;

  if (onOptimal && currentPath.length > 0) {
    // User's moves are on track — extend with amber completion squares
    const base = currentPath.length;
    completionPath.forEach((sq, i) => drawPathSquare(sq, base + i + 1, 'knight-sq-extend'));
    misses += completionPath.length;
  } else {
    // Off track or no moves — clear path, show full optimal with dark outlines
    clearPathMarks();
    currentOptimalPath.forEach((sq, i) => drawPathSquare(sq, i + 1, 'knight-sq-optimal'));
    misses += currentOptimalDist;
  }

  document.getElementById('knight-misses').textContent = `Misses: ${misses}`;

  const correct = currentPath.length;
  drillResults.push({ seconds, correct, misses });
  upsertDrillDay('knight', { seconds, correct, misses,
    puzzleId: `${currentStartSq}-${currentTargetSq}` });
  updateSessionStats();

  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) {
    autoSummaryTimer = setTimeout(showSummary, 1000);
  }

  drawContinueMsg();
  waitingToAdvance = true;
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────

function getSvg() {
  const boardEl = document.getElementById('knight-board');
  return boardEl ? boardEl.querySelector('svg') : null;
}

function sqToXY(sq, sqSize) {
  return { x: fileOf(sq) * sqSize, y: (7 - rankOf(sq)) * sqSize };
}

function drawTargetSquare(sq) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const { x, y } = sqToXY(sq, sqSize);
  const pad = 3;

  const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  border.setAttribute('x', x + pad);
  border.setAttribute('y', y + pad);
  border.setAttribute('width',  sqSize - pad * 2);
  border.setAttribute('height', sqSize - pad * 2);
  border.setAttribute('rx', 4);
  border.setAttribute('class', 'knight-target-border');
  border.setAttribute('data-knight', 'target');
  svg.appendChild(border);

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  icon.setAttribute('x', x + sqSize / 2);
  icon.setAttribute('y', y + sqSize / 2);
  icon.setAttribute('text-anchor', 'middle');
  icon.setAttribute('dominant-baseline', 'central');
  icon.setAttribute('font-size', sqSize * 0.52);
  icon.setAttribute('class', 'knight-target-icon');
  icon.setAttribute('data-knight', 'target');
  icon.textContent = '◎';
  svg.appendChild(icon);
}

function drawPathSquare(sq, num, cssClass) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const { x, y } = sqToXY(sq, sqSize);
  const pad = 3;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + pad);
  rect.setAttribute('y', y + pad);
  rect.setAttribute('width',  sqSize - pad * 2);
  rect.setAttribute('height', sqSize - pad * 2);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-knight-sq', sq);
  svg.appendChild(rect);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', x + sqSize / 2);
  text.setAttribute('y', y + sqSize / 2);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('font-size', sqSize * 0.36);
  text.setAttribute('class', cssClass + '-num');
  text.setAttribute('data-knight-sq', sq);
  text.textContent = num;
  svg.appendChild(text);
}

function flashInvalid(sq) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const { x, y } = sqToXY(sq, sqSize);
  const pad = 3;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + pad);
  rect.setAttribute('y', y + pad);
  rect.setAttribute('width',  sqSize - pad * 2);
  rect.setAttribute('height', sqSize - pad * 2);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', 'knight-sq-invalid');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 600);
}

function removeSvgBySq(sq) {
  const boardEl = document.getElementById('knight-board');
  if (!boardEl) return;
  boardEl.querySelectorAll(`[data-knight-sq="${sq}"]`).forEach(el => el.remove());
}

function clearPathMarks() {
  const boardEl = document.getElementById('knight-board');
  if (!boardEl) return;
  boardEl.querySelectorAll('[data-knight-sq]').forEach(el => el.remove());
}

function clearAllMarks() {
  const boardEl = document.getElementById('knight-board');
  if (!boardEl) return;
  boardEl.querySelectorAll('[data-knight], [data-knight-sq], .knight-continue-msg')
    .forEach(el => el.remove());
}

function showBoardMessage(text) {
  const svg = getSvg();
  if (!svg) return;
  svg.querySelectorAll('.knight-board-msg').forEach(el => el.remove());
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const msg = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  msg.setAttribute('x', boardW / 2);
  msg.setAttribute('y', boardW / 2);
  msg.setAttribute('text-anchor', 'middle');
  msg.setAttribute('dominant-baseline', 'central');
  msg.setAttribute('font-size', sqSize * 0.44);
  msg.setAttribute('class', 'knight-board-msg');
  msg.textContent = text;
  svg.appendChild(msg);
  setTimeout(() => msg.remove(), 2000);
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
  text.setAttribute('class', 'knight-continue-msg');
  text.textContent = 'Click anywhere to continue';
  svg.appendChild(text);
}

// ─── Session stats ────────────────────────────────────────────────────────────

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
  const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
  const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('knight-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('knight-session-acc').textContent  = `Acc ${accuracy}%`;
  document.getElementById('knight-session-stats').classList.remove('hidden');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

async function showSummary() {
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  stopTimer();
  document.getElementById('btn-summary-again').onclick = restartDrill;
  const count = drillResults.length;
  document.getElementById('stat-count').textContent = count;
  await updateSummaryGoals('knight', count);
  if (count > 0) {
    const totalSeconds = drillResults.reduce((s, r) => s + r.seconds, 0);
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
    const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
    document.getElementById('stat-avg-time').textContent = formatTime(Math.round(totalSeconds / count));
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
    const { accMet, timeMet } = await checkGoals('knight', count, totalCorrect, totalMisses, totalSeconds);
    if (accMet || timeMet) await showGoalCelebration(accMet, timeMet, accuracy, totalSeconds / count);
    const isPB = await checkAndUpdatePB('knight', count, totalCorrect, totalMisses, totalSeconds);
    if (isPB) await showPBCelebration();
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

function restartDrill() {
  navigate('screen-knight');
  resetDrill();
  loadNextPuzzle();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

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
  puzzleCount = 0;
  drillResults.length = 0;
  puzzleQueue = [];
  document.getElementById('knight-session-time').textContent = '';
  document.getElementById('knight-session-acc').textContent  = '';
  document.getElementById('knight-session-stats').classList.add('hidden');
}

function resetUI() {
  misses = seconds = invalidClicks = 0;
  waitingToAdvance = false;
  solutionShown = false;
  clearAllMarks();
  document.getElementById('knight-timer').textContent  = '0:00';
  document.getElementById('knight-misses').textContent = 'Misses: 0';
  document.getElementById('btn-knight-show').textContent = 'SHOW';
}

function startTimer() {
  timerInterval = setInterval(() => {
    seconds++;
    document.getElementById('knight-timer').textContent = formatTime(seconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
