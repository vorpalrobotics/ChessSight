import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';
import { registerPause } from './pause.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

const PIECE_ORDER = ['K', 'Q', 'R', 'B', 'N', 'P'];

// Cache of parsed <g> elements from the sprite, keyed by piece id (e.g. 'wk', 'bn').
// We clone these directly into each palette/drag SVG — no <use> cross-document refs needed.
let pieceCache = null;
let spriteLoadPromise = null;

function loadSprite() {
  if (pieceCache) return Promise.resolve();
  if (spriteLoadPromise) return spriteLoadPromise;
  spriteLoadPromise = fetch(PIECES_URL)
    .then(r => r.text())
    .then(svgText => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      pieceCache = new Map();
      for (const id of ['wk','wq','wr','wb','wn','wp','bk','bq','br','bb','bn','bp']) {
        const el = doc.getElementById(id);
        if (el) pieceCache.set(id, el);
      }
    })
    .catch(err => {
      console.warn('Memory drill: failed to load piece sprite', err);
      pieceCache = new Map(); // don't retry forever
    });
  return spriteLoadPromise;
}

// Build a standalone SVG with the piece cloned directly from the sprite cache.
// sprite viewBox is 0 0 40 40; each <g> has a translate() that positions the piece.
function makePieceSvg(pk, sizePx) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', String(sizePx));
  svg.setAttribute('height', String(sizePx));
  const id = pk[0] + pk[1].toLowerCase(); // 'wK' → 'wk', 'bN' → 'bn'
  if (pieceCache && pieceCache.has(id)) {
    // importNode adopts the element from the DOMParser document into ours
    const clone = document.importNode(pieceCache.get(id), true);
    clone.removeAttribute('id'); // avoid duplicate IDs in the DOM
    svg.appendChild(clone);
  }
  return svg;
}

// Varied positions: 4–12 pieces each
const POSITIONS = [
  '8/8/3k4/8/3K4/8/8/3R4 w - - 0 1',
  '8/8/3k4/3p4/3P4/3K4/8/8 w - - 0 1',
  'r7/8/3k4/8/8/3K4/8/R7 w - - 0 1',
  '8/3k4/8/8/4B3/8/3K4/8 w - - 0 1',
  '8/3k4/4n3/8/8/4N3/3K4/8 w - - 0 1',
  '3k4/3r4/8/8/8/8/3R4/3K4 w - - 0 1',
  '8/pp3k2/8/8/8/8/PP3K2/8 w - - 0 1',
  'r4k2/5p2/8/8/8/8/5P2/R4K2 w - - 0 1',
  '5k2/2r2p2/8/8/8/8/2R2P2/5K2 w - - 0 1',
  '3rk3/3p4/8/8/8/8/3P4/3RK3 w - - 0 1',
  '4k3/2b1n3/8/8/8/8/2B1N3/4K3 w - - 0 1',
  '3k4/pp1n1ppp/8/8/8/8/PP1N1PPP/3K4 w - - 0 1',
  '8/pp2k1pp/8/8/8/8/PP2K1PP/8 w - - 0 1',
  'r4rk1/8/8/8/8/8/8/R4RK1 w - - 0 1',
  'r1b1k3/pp3ppp/8/8/8/8/PP3PPP/R1B1K3 w - - 0 1',
  '3k4/3b4/8/1pp5/1PP5/8/3B4/3K4 w - - 0 1',
  '2bk4/2p5/8/8/8/8/2P5/2BK4 w - - 0 1',
  '8/2k5/2r5/8/8/2R5/2K5/8 w - - 0 1',
  '1r2k3/5b2/8/8/8/8/5B2/1R2K3 w - - 0 1',
  'r1bqk3/pppp4/8/8/8/8/PPPP4/R1BQK3 w - - 0 1',
  '8/3kbp2/8/8/8/8/3KBP2/8 w - - 0 1',
  '3rk3/3bp3/8/8/8/8/3BP3/3RK3 w - - 0 1',
  'r3k3/p1p2p2/8/8/8/8/P1P2P2/R3K3 w - - 0 1',
  '2r2rk1/5p2/8/8/8/8/5P2/2R2RK1 w - - 0 1',
];

// --- Module state ---
let board = null;
let navigate = null;
let puzzleActive = false;
let phase = 'study';   // 'study' | 'recall' | 'waiting'

// Puzzle state
let currentFen = '';
let answerKey = new Map();   // square → pieceKey
let palette = new Map();     // pieceKey → remaining count
let placed = new Map();      // square → pieceKey (correctly placed)
let misses = 0;
let puzzleCount = 0;
let positionQueue = [];
const drillResults = [];

// Study timer
let studyDuration = 0;
let studyStartMs = 0;
let studyElapsedMs = 0;
let studyInterval = null;
let fadingStarted = false;

// Recall timer
let recallSeconds = 0;
let recallInterval = null;

// Drag state
let dragPieceKey = null;
let dragClone = null;

let autoAdvanceTimer = null;
let autoSummaryTimer = null;
let waitingForContinue = false;

// --- Public API ---

export function initMemory(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-memory-done').addEventListener('click', showSummary);
  document.getElementById('btn-memory-ready').addEventListener('click', onReady);
  document.getElementById('btn-memory-show').addEventListener('click', onShow);
  document.getElementById('memory-board').addEventListener('click', onBoardClick);
}

export async function startMemory() {
  registerPause(pauseDrill, resumeDrill);
  await loadSprite();
  resetDrill();
  positionQueue = shuffleArray([...POSITIONS]);
  await loadNextPuzzle();
}

// --- Pause / Resume ---

function pauseDrill() {
  if (phase === 'study') {
    studyElapsedMs = Date.now() - studyStartMs;
    clearInterval(studyInterval);
    studyInterval = null;
  } else if (phase === 'recall') {
    clearInterval(recallInterval);
    recallInterval = null;
  }
}

function resumeDrill() {
  if (phase === 'study') {
    studyStartMs = Date.now() - studyElapsedMs;
    studyInterval = setInterval(tickStudy, 50);
  } else if (phase === 'recall') {
    recallInterval = setInterval(tickRecall, 1000);
  }
}

// --- Puzzle lifecycle ---

async function loadNextPuzzle() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  waitingForContinue = false;

  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) { showSummary(); return; }

  resetUI();
  puzzleCount++;
  document.getElementById('memory-puzzle-num').textContent = `#${puzzleCount}`;

  if (positionQueue.length === 0) positionQueue = shuffleArray([...POSITIONS]);
  currentFen = positionQueue.shift();

  answerKey = buildAnswerKey(currentFen);
  palette = buildPaletteCounts(answerKey);
  placed = new Map();
  misses = 0;

  if (!board) {
    board = new Chessboard(document.getElementById('memory-board'), {
      position: currentFen,
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  } else {
    document.getElementById('memory-board').classList.remove('pieces-fading');
    board.setPosition(currentFen, false);
  }

  const pieceCount = answerKey.size;
  studyDuration = Math.max(8000, pieceCount * 2000);
  studyElapsedMs = 0;
  fadingStarted = false;

  showStudyPhase();
  startStudyTimer();
  updateSessionStats();
}

function showStudyPhase() {
  phase = 'study';
  puzzleActive = true;

  document.getElementById('memory-board').classList.remove('pieces-fading');
  document.getElementById('memory-study-overlay').classList.remove('hidden');
  document.getElementById('memory-palette').classList.add('hidden');
  document.getElementById('memory-study-bar').style.width = '100%';
  document.getElementById('btn-memory-ready').disabled = false;
  document.getElementById('btn-memory-show').classList.add('hidden');
  document.getElementById('memory-recall-stats').classList.add('hidden');
  setStatus('Memorise the position');
}

function startStudyTimer() {
  studyStartMs = Date.now() - studyElapsedMs;
  clearInterval(studyInterval);
  studyInterval = setInterval(tickStudy, 50);
}

function tickStudy() {
  studyElapsedMs = Date.now() - studyStartMs;
  const remaining = studyDuration - studyElapsedMs;
  const pct = Math.max(0, (remaining / studyDuration) * 100);
  document.getElementById('memory-study-bar').style.width = pct + '%';

  if (!fadingStarted && remaining <= 3000) {
    fadingStarted = true;
    document.getElementById('memory-board').classList.add('pieces-fading');
  }

  if (remaining <= 0) {
    clearInterval(studyInterval);
    studyInterval = null;
    beginRecall();
  }
}

function onReady() {
  if (phase !== 'study') return;
  clearInterval(studyInterval);
  studyInterval = null;
  document.getElementById('memory-study-bar').style.width = '0%';
  beginRecall();
}

function beginRecall() {
  phase = 'recall';
  document.getElementById('memory-board').classList.remove('pieces-fading');
  board.setPosition('8/8/8/8/8/8/8/8', false);

  document.getElementById('memory-study-overlay').classList.add('hidden');
  document.getElementById('btn-memory-ready').disabled = true;
  document.getElementById('btn-memory-show').classList.remove('hidden');
  document.getElementById('memory-recall-stats').classList.remove('hidden');
  setStatus('Place pieces from memory');

  recallSeconds = 0;
  document.getElementById('memory-timer').textContent = '0:00';
  recallInterval = setInterval(tickRecall, 1000);

  renderPalette();
}

function tickRecall() {
  recallSeconds++;
  document.getElementById('memory-timer').textContent = formatTime(recallSeconds);
}

function onShow() {
  if (!puzzleActive || phase !== 'recall') return;

  // Penalise for all unplaced pieces
  let remaining = 0;
  for (const [, count] of palette) remaining += count;
  if (remaining > 0) {
    misses += remaining;
    document.getElementById('memory-misses').textContent = `Misses: ${misses}`;
  }

  finishRecall(false);
}

function finishRecall(allCorrect) {
  puzzleActive = false;
  phase = 'waiting';
  clearInterval(recallInterval);
  recallInterval = null;

  drillResults.push({ seconds: recallSeconds, correct: placed.size, misses });
  upsertDrillDay('memory', { seconds: recallSeconds, correct: placed.size, misses });
  updateSessionStats();

  if (allCorrect) {
    // Pulse the placed marks — use rAF so the marks drawn by renderRecallBoard are ready
    requestAnimationFrame(() => {
      document.getElementById('memory-board')
        .querySelectorAll('.memory-sq-placed')
        .forEach(el => el.classList.add('pulsing'));
    });
  } else {
    // Show correct solution for missed squares
    board.setPosition(currentFen, false);
    requestAnimationFrame(() => {
      for (const [sq] of placed) drawSqMark(sq, 'memory-sq-placed');
      for (const [sq] of answerKey) {
        if (!placed.has(sq)) drawSqMark(sq, 'memory-sq-missed');
      }
    });
  }

  setStatus('Click board to continue');
  waitingForContinue = true;
}

function puzzleComplete() {
  finishRecall(true);

  const limit = getPositionsPerDrill();
  const limitReached = limit !== null && drillResults.length >= limit;
  if (limitReached) {
    autoSummaryTimer = setTimeout(showSummary, 1500);
  } else {
    autoAdvanceTimer = setTimeout(loadNextPuzzle, 1500);
  }
}

function onBoardClick() {
  if (!waitingForContinue) return;
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  waitingForContinue = false;
  setStatus('');

  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) {
    showSummary();
  } else {
    loadNextPuzzle();
  }
}

// --- Palette rendering ---

function renderPalette() {
  const container = document.getElementById('memory-palette');
  container.classList.remove('hidden');
  container.innerHTML = '';

  const whitePieces = PIECE_ORDER.map(t => 'w' + t).filter(pk => palette.has(pk));
  const blackPieces = PIECE_ORDER.map(t => 'b' + t).filter(pk => palette.has(pk));

  if (whitePieces.length > 0) container.appendChild(buildPaletteRow(whitePieces, 'White'));
  if (blackPieces.length > 0) container.appendChild(buildPaletteRow(blackPieces, 'Black'));
}

function buildPaletteRow(pieceKeys, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'memory-palette-row-wrap';

  const lbl = document.createElement('span');
  lbl.className = 'memory-palette-label';
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const row = document.createElement('div');
  row.className = 'memory-palette-row';
  wrapper.appendChild(row);

  for (const pk of pieceKeys) {
    const count = palette.get(pk) ?? 0;
    if (count <= 0) continue;

    const slot = document.createElement('div');
    slot.className = 'memory-piece-slot';
    slot.dataset.pieceKey = pk;

    const svgEl = makePieceSvg(pk, 36);
    svgEl.classList.add('memory-piece-svg');
    slot.appendChild(svgEl);

    if (count > 1) {
      const badge = document.createElement('span');
      badge.className = 'memory-piece-badge';
      badge.textContent = count;
      slot.appendChild(badge);
    }

    attachDragHandlers(slot, pk);
    row.appendChild(slot);
  }

  return wrapper;
}

// --- Drag-and-drop (Pointer Events API) ---

function attachDragHandlers(slot, pk) {
  slot.addEventListener('pointerdown', (e) => {
    if (!puzzleActive || phase !== 'recall') return;
    if ((palette.get(pk) ?? 0) <= 0) return;

    e.preventDefault();
    dragPieceKey = pk;

    dragClone = document.createElement('div');
    dragClone.className = 'memory-drag-clone';
    dragClone.appendChild(makePieceSvg(pk, 52));
    dragClone.style.left = e.clientX + 'px';
    dragClone.style.top = e.clientY + 'px';
    document.body.appendChild(dragClone);

    slot.setPointerCapture(e.pointerId);
  });

  slot.addEventListener('pointermove', (e) => {
    if (!dragClone) return;
    dragClone.style.left = e.clientX + 'px';
    dragClone.style.top = e.clientY + 'px';
  });

  slot.addEventListener('pointerup', (e) => {
    if (!dragClone) return;
    dragClone.remove();
    dragClone = null;

    const sq = sqFromCoords(e.clientX, e.clientY);
    if (sq && dragPieceKey) attemptPlace(sq, dragPieceKey);
    dragPieceKey = null;
  });

  slot.addEventListener('pointercancel', () => {
    if (dragClone) { dragClone.remove(); dragClone = null; }
    dragPieceKey = null;
  });
}

function attemptPlace(sq, pieceKey) {
  if (!puzzleActive || phase !== 'recall') return;

  if (placed.has(sq)) {
    flashSqWrong(sq);
    return;
  }

  if (answerKey.get(sq) === pieceKey) {
    placed.set(sq, pieceKey);

    const newCount = (palette.get(pieceKey) ?? 0) - 1;
    if (newCount <= 0) palette.delete(pieceKey);
    else palette.set(pieceKey, newCount);
    renderPalette();

    renderRecallBoard();

    if (placed.size === answerKey.size) puzzleComplete();
  } else {
    misses++;
    document.getElementById('memory-misses').textContent = `Misses: ${misses}`;
    flashSqWrong(sq);
  }
}

// --- Board rendering during recall ---

function renderRecallBoard() {
  board.setPosition(buildPartialFen(placed), false);
  requestAnimationFrame(() => {
    for (const [sq] of placed) drawSqMark(sq, 'memory-sq-placed');
  });
}

// --- SVG helpers (same pattern as loose.js) ---

function getSvg() {
  const boardEl = document.getElementById('memory-board');
  return boardEl ? boardEl.querySelector('svg') : null;
}

function drawSqMark(sq, cssClass) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]);
  const x = file * sqSize;
  const y = (8 - rank) * sqSize;
  const pad = 3;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + pad);
  rect.setAttribute('y', y + pad);
  rect.setAttribute('width', sqSize - pad * 2);
  rect.setAttribute('height', sqSize - pad * 2);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-memory-sq', sq);
  rect.setAttribute('pointer-events', 'none');
  svg.appendChild(rect);
}

function flashSqWrong(sq) {
  const svg = getSvg();
  if (!svg) return;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  const sqSize = boardW / 8;
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]);
  const x = file * sqSize;
  const y = (8 - rank) * sqSize;
  const pad = 3;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + pad);
  rect.setAttribute('y', y + pad);
  rect.setAttribute('width', sqSize - pad * 2);
  rect.setAttribute('height', sqSize - pad * 2);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', 'memory-sq-wrong');
  rect.setAttribute('pointer-events', 'none');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 1500);
}

function clearAllMarks() {
  const boardEl = document.getElementById('memory-board');
  if (boardEl) boardEl.querySelectorAll('[data-memory-sq]').forEach(el => el.remove());
}

function sqFromCoords(clientX, clientY) {
  const boardEl = document.getElementById('memory-board');
  if (!boardEl) return null;
  const rect = boardEl.getBoundingClientRect();
  const file    = Math.floor((clientX - rect.left) / rect.width  * 8);
  const rankIdx = 7 - Math.floor((clientY - rect.top) / rect.height * 8);
  if (file < 0 || file > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return String.fromCharCode(97 + file) + (rankIdx + 1);
}

// --- Chess helpers ---

function buildAnswerKey(fen) {
  const chess = new Chess();
  try { chess.load(fen); } catch { return new Map(); }
  const key = new Map();
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const p = chess.get(sq);
      if (p) key.set(sq, p.color + p.type.toUpperCase());
    }
  }
  return key;
}

function buildPaletteCounts(key) {
  const counts = new Map();
  for (const [, pk] of key) counts.set(pk, (counts.get(pk) ?? 0) + 1);
  return counts;
}

function buildPartialFen(placed) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const file of 'abcdefgh') {
      const sq = file + rank;
      if (placed.has(sq)) {
        if (empty > 0) { row += empty; empty = 0; }
        const pk = placed.get(sq);
        row += pk[0] === 'w' ? pk[1] : pk[1].toLowerCase();
      } else {
        empty++;
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' w - - 0 1';
}

// --- Session stats ---

function updateSessionStats() {
  const count = drillResults.length;
  if (count === 0) return;
  const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
  const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
  const accuracy = Math.round(totalCorrect / Math.max(1, totalCorrect + totalMisses) * 100);
  const avgSecs  = Math.round(drillResults.reduce((s, r) => s + r.seconds, 0) / count);
  document.getElementById('memory-session-time').textContent = `Avg ${formatTime(avgSecs)}`;
  document.getElementById('memory-session-acc').textContent  = `Acc ${accuracy}%`;
  document.getElementById('memory-session-stats').classList.remove('hidden');
}

// --- Summary ---

function showSummary() {
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  clearInterval(studyInterval); studyInterval = null;
  clearInterval(recallInterval); recallInterval = null;

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
  navigate('screen-memory');
  resetDrill();
  await startMemory();
}

// --- UI helpers ---

function resetDrill() {
  if (autoSummaryTimer) { clearTimeout(autoSummaryTimer); autoSummaryTimer = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  clearInterval(studyInterval); studyInterval = null;
  clearInterval(recallInterval); recallInterval = null;
  if (dragClone) { dragClone.remove(); dragClone = null; }
  dragPieceKey = null;
  puzzleCount = 0;
  drillResults.length = 0;
  positionQueue = [];
  waitingForContinue = false;
  document.getElementById('memory-session-time').textContent = '';
  document.getElementById('memory-session-acc').textContent  = '';
  document.getElementById('memory-session-stats').classList.add('hidden');
}

function resetUI() {
  misses = 0;
  recallSeconds = 0;
  clearAllMarks();
  document.getElementById('memory-timer').textContent  = '0:00';
  document.getElementById('memory-misses').textContent = 'Misses: 0';
  document.getElementById('memory-palette').innerHTML  = '';
  setStatus('');
}

function setStatus(msg) {
  document.getElementById('memory-status').textContent = msg;
}

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
