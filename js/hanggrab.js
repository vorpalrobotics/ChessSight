import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { upsertDrillDay } from './storage.js';
import { registerPause } from './pause.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

// ─── Geometry ─────────────────────────────────────────────────────────────────

const ALL_SQS = [];
for (let r = 0; r < 8; r++)
  for (let f = 0; f < 8; f++)
    ALL_SQS.push(String.fromCharCode(97 + f) + (r + 1));

function fileOf(sq) { return sq.charCodeAt(0) - 97; }
function rankOf(sq) { return parseInt(sq[1]) - 1; }
function sqName(f, r) { return String.fromCharCode(97 + f) + (r + 1); }

const QUEEN_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function computeQueenAttacks(queenSq, occupied) {
  const attacks = new Set();
  const qf = fileOf(queenSq), qr = rankOf(queenSq);
  for (const [df, dr] of QUEEN_DIRS) {
    let f = qf + df, r = qr + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = sqName(f, r);
      attacks.add(sq);
      if (occupied.has(sq)) break;
      f += df; r += dr;
    }
  }
  return attacks;
}

// True if no occupied square lies strictly between fromSq and toSq on the same line
function pathClear(fromSq, toSq, occupied) {
  const ff = fileOf(fromSq), fr = rankOf(fromSq);
  const tf = fileOf(toSq),   tr = rankOf(toSq);
  const df = tf - ff, dr = tr - fr;
  const steps = Math.max(Math.abs(df), Math.abs(dr));
  const sf = Math.sign(df), sr = Math.sign(dr);
  for (let i = 1; i < steps; i++) {
    if (occupied.has(sqName(ff + i * sf, fr + i * sr))) return false;
  }
  return true;
}

// Does the black piece of given type at fromSq cover targetSq?
function blackPieceCovers(type, fromSq, targetSq, occupied) {
  const ff = fileOf(fromSq), fr = rankOf(fromSq);
  const tf = fileOf(targetSq), tr = rankOf(targetSq);
  const adf = Math.abs(ff - tf), adr = Math.abs(fr - tr);
  if (type === 'n') return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
  if (type === 'b') return adf === adr && adf > 0 && pathClear(fromSq, targetSq, occupied);
  if (type === 'r') return (ff === tf || fr === tr) && (adf + adr > 0) && pathClear(fromSq, targetSq, occupied);
  return false;
}

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5 };

function isDefended(targetSq, pos) {
  const { queenSq, wPawns, bPieces, bPawns } = pos;
  const occupied = new Set([queenSq, ...wPawns, ...bPieces.map(p => p.sq), ...bPawns]);
  const tf = fileOf(targetSq), tr = rankOf(targetSq);

  // Black pawn at (pf, pr) attacks (pf±1, pr−1).
  // So targetSq (tf, tr) is covered by a black pawn sitting at (tf±1, tr+1).
  for (const sq of bPawns) {
    if (sq === targetSq) continue;
    if (rankOf(sq) - 1 === tr && Math.abs(fileOf(sq) - tf) === 1) return true;
  }

  for (const { sq: pSq, type } of bPieces) {
    if (pSq === targetSq) continue;
    if (blackPieceCovers(type, pSq, targetSq, occupied)) return true;
  }

  return false;
}

function computeValidTargets(pos) {
  const { queenSq, wPawns, bPieces, bPawns } = pos;
  const occupied = new Set([queenSq, ...wPawns, ...bPieces.map(p => p.sq), ...bPawns]);
  const qAtks = computeQueenAttacks(queenSq, occupied);
  const targets = [];
  for (const { sq, type } of bPieces) {
    if (qAtks.has(sq) && !isDefended(sq, pos))
      targets.push({ sq, value: PIECE_VALUE[type], type });
  }
  for (const sq of bPawns) {
    if (qAtks.has(sq) && !isDefended(sq, pos))
      targets.push({ sq, value: 1, type: 'p' });
  }
  return targets;
}

// ─── Position generation ──────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

function generatePosition() {
  const TYPES = ['b', 'n', 'r'];
  let lastPos = null;

  for (let attempt = 0; attempt < 60; attempt++) {
    const occupied = new Set();

    const queenSq = pick(ALL_SQS);
    occupied.add(queenSq);

    // 0–4 white pawns on ranks 2–4 (index 1–3)
    const wPawns = [];
    for (let i = 0, n = randInt(0, 4); i < n; i++) {
      const avail = ALL_SQS.filter(sq => rankOf(sq) >= 1 && rankOf(sq) <= 3 && !occupied.has(sq));
      if (!avail.length) break;
      const sq = pick(avail); wPawns.push(sq); occupied.add(sq);
    }

    // 1–3 black pieces anywhere (no two bishops on same color square)
    const usedBishopColors = new Set();
    const bPieces = [];
    for (let i = 0, n = randInt(1, 3); i < n; i++) {
      const type = pick(TYPES);
      let avail = ALL_SQS.filter(sq => !occupied.has(sq));
      if (type === 'b') {
        if (usedBishopColors.size >= 2) continue; // both colors used, skip this bishop
        if (usedBishopColors.size === 1) {
          const usedParity = [...usedBishopColors][0];
          avail = avail.filter(sq => (fileOf(sq) + rankOf(sq)) % 2 !== usedParity);
        }
      }
      if (!avail.length) break;
      const sq = pick(avail);
      bPieces.push({ sq, type });
      occupied.add(sq);
      if (type === 'b') usedBishopColors.add((fileOf(sq) + rankOf(sq)) % 2);
    }

    // 2–4 black pawns on ranks 5–7 (index 4–6)
    const bPawns = [];
    for (let i = 0, n = randInt(2, 4); i < n; i++) {
      const avail = ALL_SQS.filter(sq => rankOf(sq) >= 4 && rankOf(sq) <= 6 && !occupied.has(sq));
      if (!avail.length) break;
      const sq = pick(avail); bPawns.push(sq); occupied.add(sq);
    }

    const pos = { queenSq, wPawns, bPieces, bPawns };
    lastPos = pos;

    // Require queen to attack at least one black piece/pawn, otherwise regenerate
    const qAtks = computeQueenAttacks(queenSq, occupied);
    if ([...bPieces.map(p => p.sq), ...bPawns].some(sq => qAtks.has(sq))) return pos;
  }

  return lastPos; // fallback: queen may attack nothing; student will PASS
}

function buildFen(pos) {
  const { queenSq, wPawns, bPieces, bPawns } = pos;
  const pm = {};
  pm[queenSq] = 'Q';
  wPawns.forEach(sq => { pm[sq] = 'P'; });
  bPieces.forEach(({ sq, type }) => { pm[sq] = type; }); // lowercase = black
  bPawns.forEach(sq => { pm[sq] = 'p'; });
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pm[sqName(f, r)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; }
      else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' w - - 0 1';
}

// ─── Module state ─────────────────────────────────────────────────────────────

let board = null;
let navigate = null;
let currentPos = null;
let validTargets = [];
let foundTargetSqs = new Set();
let puzzleMisses = 0;
let firstTryThisPuzzle = true;
let puzzleActive = false;
let puzzleStartTime = 0;
let timerInterval = null;
let puzzleCount = 0;
let sessionMisses = 0;
const drillResults = [];
let pauseStart = 0;
let autoAdvanceTimer = null;

// ─── Public API ───────────────────────────────────────────────────────────────

// Returns a single puzzle object for use by the Mix drill.
export function generateHangGrabPuzzle() {
  const pos = generatePosition();
  const validTargets = computeValidTargets(pos);
  return {
    fen: buildFen(pos),
    targets: new Set(validTargets.map(t => t.sq)),
    pieceSquares: new Set([pos.queenSq, ...pos.wPawns, ...pos.bPieces.map(p => p.sq), ...pos.bPawns]),
    type: 'hanggrab',
  };
}

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

export function initHangGrab(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-hg-done').addEventListener('click', showSummary);
  document.getElementById('btn-hg-pass').addEventListener('click', handlePass);
  document.getElementById('btn-hg-show').addEventListener('click', handleShow);
  document.getElementById('hg-board').addEventListener('click', handleBoardClick);
}

export function startHangGrab() {
  registerPause(pauseDrill, resumeDrill);
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleCount = 0;
  sessionMisses = 0;
  drillResults.length = 0;
  document.getElementById('hg-session-time').textContent = '';
  document.getElementById('hg-session-acc').textContent  = '';
  document.getElementById('hg-session-stats').classList.add('hidden');
  document.getElementById('hg-misses').textContent = 'Misses: 0';

  if (!board) {
    board = new Chessboard(document.getElementById('hg-board'), {
      position: '8/8/8/8/8/8/8/8 w - - 0 1',
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  }

  loadPuzzle();
}

// ─── Puzzle lifecycle ─────────────────────────────────────────────────────────

function loadPuzzle() {
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) {
    showSummary();
    return;
  }
  puzzleActive = false;
  stopTimer();
  clearOverlays();
  setStatus('');

  puzzleCount++;
  document.getElementById('hg-puzzle-num').textContent = `#${puzzleCount}`;

  currentPos = generatePosition();
  validTargets = computeValidTargets(currentPos);
  foundTargetSqs = new Set();
  puzzleMisses = 0;
  firstTryThisPuzzle = true;

  board.setPosition(buildFen(currentPos), false);
  startTimer();
  puzzleActive = true;
}

function handleBoardClick(e) {
  if (!puzzleActive) return;
  const sq = sqFromClick(e);
  if (!sq) return;

  const { queenSq, wPawns, bPieces, bPawns } = currentPos;

  // Ignore white pieces (queen / pawns)
  if (sq === queenSq || wPawns.includes(sq)) return;

  // Only respond to clicks on actual black pieces
  const isBlack = bPieces.some(p => p.sq === sq) || bPawns.includes(sq);
  if (!isBlack) return;

  // Ignore already-found squares
  if (foundTargetSqs.has(sq)) return;

  const target = validTargets.find(t => t.sq === sq);

  if (target) {
    // Correct free capture — mark green, track progress
    drawSqOverlay(sq, 'hg-sq-correct');
    foundTargetSqs.add(sq);

    if (foundTargetSqs.size === validTargets.length) {
      // All free captures found — complete puzzle
      const elapsed = finishPuzzle(true);
      setStatus(firstTryThisPuzzle ? `✓  ${elapsed}s` : `Found all  ${elapsed}s`);
      autoAdvanceTimer = setTimeout(loadPuzzle, 1500);
    }
  } else {
    // Wrong click — defended or unreachable piece; flash red transiently
    flashSqRed(sq);
    puzzleMisses++;
    firstTryThisPuzzle = false;
  }
}

function handlePass() {
  if (!puzzleActive) return;

  if (validTargets.length === 0) {
    // Correct — nothing was free to grab
    const elapsed = finishPuzzle(true);
    setStatus(`✓ Nothing to grab!  ${elapsed}s`);
    autoAdvanceTimer = setTimeout(loadPuzzle, 1500);
  } else {
    // Wrong — free captures were available
    finishPuzzle(false);
    validTargets.filter(t => !foundTargetSqs.has(t.sq)).forEach(t => drawSqOverlay(t.sq, 'hg-sq-reveal'));
    setStatus('There were free captures — see highlights.');
    autoAdvanceTimer = setTimeout(loadPuzzle, 2000);
  }
}

function handleShow() {
  if (!puzzleActive) return;
  finishPuzzle(false);
  if (validTargets.length === 0) {
    setStatus('Nothing to grab here — PASS was correct.');
  } else {
    const unfound = validTargets.filter(t => !foundTargetSqs.has(t.sq));
    unfound.forEach(t => drawSqOverlay(t.sq, 'hg-sq-reveal'));
    setStatus(unfound.length > 0 ? 'Free capture(s) shown.' : 'All found already!');
  }
  autoAdvanceTimer = setTimeout(loadPuzzle, 2000);
}

// Stops timer, records result, updates stats. Returns elapsed string.
function finishPuzzle(correct) {
  puzzleActive = false;
  const elapsed = stopTimer();
  sessionMisses += puzzleMisses;
  document.getElementById('hg-misses').textContent = `Misses: ${sessionMisses}`;
  drillResults.push({ seconds: parseFloat(elapsed), correct: correct ? 1 : 0, misses: puzzleMisses });
  upsertDrillDay('hanggrab', {
    seconds: Math.round(parseFloat(elapsed)),
    correct: correct ? 1 : 0,
    misses: puzzleMisses,
    puzzleId: `hg-${puzzleCount}`,
  });
  updateSessionStats();
  return elapsed;
}

// ─── Pause ────────────────────────────────────────────────────────────────────

function pauseDrill() {
  if (!puzzleActive) return;
  stopTimer();
  pauseStart = Date.now();
}

function resumeDrill() {
  if (!puzzleActive) return;
  puzzleStartTime += Date.now() - pauseStart;
  startTimer();
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function showSummary() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  endDrill();

  document.getElementById('btn-summary-again').onclick = () => navigate('screen-hanggrab');

  const n = drillResults.length;
  document.getElementById('stat-count').textContent = n;
  if (n > 0) {
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const avgSecs = drillResults.reduce((s, r) => s + r.seconds, 0) / n;
    const accuracy = Math.round(totalCorrect / n * 100);
    document.getElementById('stat-avg-time').textContent = `${avgSecs.toFixed(1)}s`;
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

// ─── End drill ────────────────────────────────────────────────────────────────

function endDrill() {
  puzzleActive = false;
  stopTimer();
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  puzzleStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s = ((Date.now() - puzzleStartTime) / 1000).toFixed(1);
    document.getElementById('hg-timer').textContent = `${s}s`;
  }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const elapsed = ((Date.now() - puzzleStartTime) / 1000).toFixed(1);
  document.getElementById('hg-timer').textContent = `${elapsed}s`;
  return elapsed;
}

// ─── Session stats ────────────────────────────────────────────────────────────

function updateSessionStats() {
  const n = drillResults.length;
  if (!n) return;
  const totalC = drillResults.reduce((s, r) => s + r.correct, 0);
  const acc = Math.round(totalC / n * 100);
  const correctTimes = drillResults.filter(r => r.correct).map(r => r.seconds);
  const avg = correctTimes.length
    ? (correctTimes.reduce((a, b) => a + b, 0) / correctTimes.length).toFixed(1)
    : null;
  document.getElementById('hg-session-time').textContent = avg ? `Avg ${avg}s` : '';
  document.getElementById('hg-session-acc').textContent  = `Acc ${acc}%`;
  document.getElementById('hg-session-stats').classList.remove('hidden');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(text) {
  document.getElementById('hg-status').textContent = text;
}

function getSvgInfo() {
  const boardEl = document.getElementById('hg-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  return { svg, sqSize: boardW / 8 };
}

function sqToXY(sq, sqSize) {
  // White orientation: file a on left, rank 1 at bottom
  return { x: fileOf(sq) * sqSize, y: (7 - rankOf(sq)) * sqSize };
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
  rect.setAttribute('data-hg-sq', sq);
  svg.appendChild(rect);
}

// Transient red flash for wrong clicks — removes itself after animation
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

function clearOverlays() {
  const boardEl = document.getElementById('hg-board');
  if (boardEl) boardEl.querySelectorAll('[data-hg-sq]').forEach(el => el.remove());
}

function sqFromClick(e) {
  const boardEl = document.getElementById('hg-board');
  const rect = boardEl.getBoundingClientRect();
  const xFrac = (e.clientX - rect.left) / rect.width;
  const yFrac = (e.clientY - rect.top)  / rect.height;
  // White orientation always
  const fileIdx = Math.floor(xFrac * 8);
  const rankIdx = 7 - Math.floor(yFrac * 8);
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return sqName(fileIdx, rankIdx);
}
