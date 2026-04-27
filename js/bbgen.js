import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { upsertDrillDay } from './storage.js';
import { checkAndUpdatePB, showPBCelebration, checkGoals, showGoalCelebration, updateSummaryGoals } from './pb.js';
import { registerPause } from './pause.js';

const PIECES_URL  = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const PASS_RATIO   = 0.20;
const PIECE_NAMES  = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen' };
const BANK_SIZE    = 10;

// ─── Puzzle bank ──────────────────────────────────────────────────────────────
// Each entry: { puzzle, score }. Persists across drill restarts so the bank
// warms up once and stays ready.
let blunderBank = [];

let board            = null;
let navigate         = null;
let currentPuzzle    = null;
let puzzleActive     = false;
let genId            = 0;       // incremented to cancel in-flight loadPuzzle
let puzzleMisses     = 0;
let firstTryThisPuzzle = true;
let puzzleCount      = 0;
let sessionMisses    = 0;
let puzzleStartTime  = Date.now();
let timerInterval    = null;
let autoAdvanceTimer = null;
let pauseStart       = 0;
let awaitingStudyTap = false;
let studyTapResolve  = null;
const drillResults   = [];

// ─── Public API ───────────────────────────────────────────────────────────────

// Used by the Mix drill — returns a mix-compatible puzzle object (no flash animation)
export function generateBBPuzzle() {
  const puz = generatePuzzle();
  if (!puz) return { fen: '8/4k3/8/8/8/8/8/4K3 w - - 0 1', targets: new Set(), pieceSquares: new Set(), type: 'bb' };
  let chess;
  try { chess = new Chess(puz.fenAfter); } catch { return generateBBPuzzle(); }
  const blackSqs = new Set();
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = sqName(f, r);
      const p = chess.get(sq);
      if (p && p.color === 'b') blackSqs.add(sq);
    }
  }
  return { fen: puz.fenAfter, targets: new Set(puz.hangingSquares), pieceSquares: blackSqs, type: 'bb' };
}

export function initBBGen(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-bb-done').addEventListener('click', showSummary);
  document.getElementById('btn-bb-pass').addEventListener('click', handlePass);
  document.getElementById('btn-bb-show').addEventListener('click', handleShow);
  document.getElementById('bb-board').addEventListener('click', handleBoardClick);
}

export function startBBGen() {
  registerPause(pauseDrill, resumeDrill);
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleCount   = 0;
  sessionMisses = 0;
  drillResults.length = 0;
  document.getElementById('bb-session-time').textContent = '';
  document.getElementById('bb-session-acc').textContent  = '';
  document.getElementById('bb-session-stats').classList.add('hidden');
  document.getElementById('bb-misses').textContent = 'Misses: 0';
  document.getElementById('bb-timer').textContent  = '0.0s';

  if (!board) {
    board = new Chessboard(document.getElementById('bb-board'), {
      position: '8/8/8/8/8/8/8/8 w - - 0 1',
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  }

  // Warm the bank if empty (first launch or bank was drained)
  if (blunderBank.length === 0) fillBank();

  loadPuzzle();
}

// ─── Position generation ─────────────────────────────────────────────────────

function pick(arr)       { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function sqName(f, r)    { return String.fromCharCode(97 + f) + (r + 1); }

function buildFen(occ, turn) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = occ[sqName(f, r)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; }
      else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ` ${turn} - - 0 1`;
}

function randomOccupied() {
  const occ = {};
  const wkF = randInt(1, 6), wkR = randInt(1, 6);
  occ[sqName(wkF, wkR)] = 'K';

  let placed = false;
  for (let i = 0; i < 100 && !placed; i++) {
    const f = randInt(0, 7), r = randInt(1, 6);
    if (Math.abs(f - wkF) <= 1 && Math.abs(r - wkR) <= 1) continue;
    const sq = sqName(f, r);
    if (!occ[sq]) { occ[sq] = 'k'; placed = true; }
  }
  if (!placed) return null;

  for (let i = 0, n = randInt(1, 3); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(0, 7));
      if (!occ[sq]) {
        const hasWQ = Object.values(occ).includes('Q');
        occ[sq] = pick(hasWQ ? ['N', 'B', 'R'] : ['N', 'B', 'R', 'Q']);
        break;
      }
    }
  }
  for (let i = 0, n = randInt(1, 3); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(1, 5));
      if (!occ[sq]) { occ[sq] = 'P'; break; }
    }
  }
  for (let i = 0, n = randInt(2, 4); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(0, 7));
      if (!occ[sq]) {
        const hasBQ = Object.values(occ).includes('q');
        occ[sq] = pick(hasBQ ? ['n', 'b', 'r'] : ['n', 'b', 'r', 'q']);
        break;
      }
    }
  }
  for (let i = 0, n = randInt(1, 3); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(2, 6));
      if (!occ[sq]) { occ[sq] = 'p'; break; }
    }
  }

  return occ;
}

function whiteInCheck(chess) {
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = sqName(f, r);
      const p = chess.get(sq);
      if (p && p.type === 'k' && p.color === 'w') return chess.attackers(sq, 'b').length > 0;
    }
  }
  return false;
}

function hangingBlack(chess) {
  const result = [];
  // For capture simulation we need white-to-move; when called with black to move
  // (priorHang check), build a temporary white-to-move copy.
  let simChess = chess;
  if (chess.turn() !== 'w') {
    const parts = chess.fen().split(' ');
    parts[1] = 'w';
    try { simChess = new Chess(parts.join(' ')); } catch { simChess = null; }
  }
  const legalMoves = simChess ? simChess.moves({ verbose: true }) : [];

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = sqName(f, r);
      const piece = chess.get(sq);
      if (!piece || piece.color !== 'b' || piece.type === 'k') continue;
      const wAtk = chess.attackers(sq, 'w');
      if (!wAtk.length) continue;
      const bDef = chess.attackers(sq, 'b');
      const val  = PIECE_VALUES[piece.type];

      // Find min-value white attacker
      let minAtkVal = Infinity, minAtkSq = null;
      for (const aSq of wAtk) {
        const p = chess.get(aSq);
        const v = p ? PIECE_VALUES[p.type] : 100;
        if (v < minAtkVal) { minAtkVal = v; minAtkSq = aSq; }
      }

      if (bDef.length && minAtkVal >= val) continue;

      // Simulate the capture to expose x-ray defenders (e.g. a queen hiding behind
      // the capturing piece). If a recapturer appears and the exchange is break-even
      // or losing for white, the piece is not truly hanging.
      const capMove = legalMoves.find(m => m.from === minAtkSq && m.to === sq);
      if (capMove && simChess) {
        simChess.move(capMove);
        const afterAtk = simChess.attackers(sq, 'b');
        simChess.undo();
        if (afterAtk.length && minAtkVal >= val) continue;
      }

      result.push({ sq, type: piece.type, value: val });
    }
  }
  return result;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreBlunder(puz) {
  let score = 0;
  const hangSq   = puz.hangingSquares[0];
  const movedTo  = puz.blunderMove.to;
  const movedFrom = puz.blunderMove.from;

  // Big bonus: hanging piece is NOT the moved piece — discovered attack or abandoned guard
  if (hangSq !== movedTo) {
    score += 10;

    // Additional bonus: moved piece was defending hangSq (classic abandoned guard)
    try {
      const before = new Chess(puz.fenBefore);
      if (before.attackers(hangSq, 'b').includes(movedFrom)) score += 5;
    } catch { /* ignore */ }
  }

  // Value of the hanging piece — hanging a rook or queen is more dramatic
  score += puz.hangingPiece.value;

  // Small random jitter so equal-scoring puzzles vary
  score += Math.random() * 2;

  return score;
}

// Returns true if white has a mate-in-1 that does NOT capture the hanging square.
// Such positions are confusing: the right move is checkmate, not grabbing the piece.
function hasUnrelatedMateIn1(fenAfter, hangSq) {
  let chess;
  try { chess = new Chess(fenAfter); } catch { return false; }
  for (const mv of chess.moves({ verbose: true })) {
    if (mv.to === hangSq) continue; // capturing the hanging piece is fine
    chess.move(mv);
    const isMate = chess.isCheckmate();
    chess.undo();
    if (isMate) return true;
  }
  return false;
}

// ─── Individual generators ────────────────────────────────────────────────────

function tryGenerateBlunder() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const occ = randomOccupied();
    if (!occ) continue;

    const fenBefore = buildFen(occ, 'b');
    let chess;
    try { chess = new Chess(fenBefore); } catch { continue; }
    if (chess.isCheck() || whiteInCheck(chess)) continue;

    const priorHang = new Set(hangingBlack(chess).map(h => h.sq));
    const moves = chess.moves({ verbose: true });
    if (!moves.length) continue;

    const blunders = [];
    for (const mv of moves) {
      chess.move(mv);
      const allHangs = hangingBlack(chess);
      const newHangs = allHangs.filter(h => !priorHang.has(h.sq));
      // Bug fix: require exactly one hang TOTAL (not just one new one)
      if (allHangs.length === 1 && newHangs.length === 1) {
        blunders.push({ mv, fenAfter: chess.fen(), newHangs });
      }
      chess.undo();
    }
    if (!blunders.length) continue;

    const validBlunders = blunders.filter(
      b => !hasUnrelatedMateIn1(b.fenAfter, b.newHangs[0].sq)
    );
    if (!validBlunders.length) continue;

    const chosen = pick(validBlunders);
    return {
      fenBefore, fenAfter: chosen.fenAfter,
      blunderMove: { from: chosen.mv.from, to: chosen.mv.to, san: chosen.mv.san },
      hangingSquares: [chosen.newHangs[0].sq],
      hangingPiece:    chosen.newHangs[0],
      isPass: false,
    };
  }
  return null;
}

function tryGeneratePass() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const occ = randomOccupied();
    if (!occ) continue;

    const fenBefore = buildFen(occ, 'b');
    let chess;
    try { chess = new Chess(fenBefore); } catch { continue; }
    if (chess.isCheck() || whiteInCheck(chess)) continue;

    const moves = chess.moves({ verbose: true });
    if (!moves.length) continue;

    const passMoves = [];
    for (const mv of moves) {
      chess.move(mv);
      if (hangingBlack(chess).length === 0) passMoves.push({ mv, fenAfter: chess.fen() });
      chess.undo();
    }
    if (!passMoves.length) continue;

    const chosen = pick(passMoves);
    return {
      fenBefore, fenAfter: chosen.fenAfter,
      blunderMove: { from: chosen.mv.from, to: chosen.mv.to, san: chosen.mv.san },
      hangingSquares: [], hangingPiece: null, isPass: true,
    };
  }
  return null;
}

// ─── Bank management ──────────────────────────────────────────────────────────

function fillBank() {
  while (blunderBank.length < BANK_SIZE) {
    const puz = tryGenerateBlunder();
    if (puz) blunderBank.push({ puzzle: puz, score: scoreBlunder(puz) });
  }
}

function pickBestFromBank() {
  if (!blunderBank.length) { fillBank(); }
  let bestIdx = 0;
  for (let i = 1; i < blunderBank.length; i++) {
    if (blunderBank[i].score > blunderBank[bestIdx].score) bestIdx = i;
  }
  const { puzzle } = blunderBank[bestIdx];
  blunderBank.splice(bestIdx, 1);
  // Replenish one replacement synchronously (fast, ~1–5 ms)
  const next = tryGenerateBlunder();
  if (next) blunderBank.push({ puzzle: next, score: scoreBlunder(next) });
  return puzzle;
}

// Main entry point for the drill and mix
function generatePuzzle() {
  if (Math.random() < PASS_RATIO) {
    return tryGeneratePass() ?? pickBestFromBank(); // fallback if PASS generation fails
  }
  if (!blunderBank.length) fillBank();
  return pickBestFromBank();
}

// ─── Study-tap helpers ────────────────────────────────────────────────────────

function showStudyPrompt() {
  document.getElementById('bb-study-prompt').classList.remove('hidden');
}

function hideStudyPrompt() {
  document.getElementById('bb-study-prompt').classList.add('hidden');
}

function cancelStudyTap() {
  awaitingStudyTap = false;
  hideStudyPrompt();
  if (studyTapResolve) { studyTapResolve(); studyTapResolve = null; }
}

// ─── Puzzle lifecycle ─────────────────────────────────────────────────────────

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

async function loadPuzzle() {
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) { showSummary(); return; }

  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleActive = false;
  clearInterval(timerInterval); timerInterval = null;
  clearOverlays();
  setStatus('');

  puzzleCount++;
  document.getElementById('bb-puzzle-num').textContent = `#${puzzleCount}`;
  document.getElementById('bb-timer').textContent = '0.0s';
  puzzleMisses       = 0;
  firstTryThisPuzzle = true;
  updateSessionStats();

  const myId = ++genId;

  // Yield so the UI updates before the generation loop runs
  await new Promise(r => setTimeout(r, 10));
  if (genId !== myId) return;

  const puz = generatePuzzle();
  if (!puz) { setStatus('Regenerating…'); setTimeout(loadPuzzle, 100); return; }
  if (genId !== myId) return;

  cancelStudyTap();
  currentPuzzle = puz;
  board.setPosition(puz.fenBefore, false);
  setStatus('');

  // Top up the bank while user studies (non-blocking)
  setTimeout(() => fillBank(), 0);

  // Wait for user to tap the board
  showStudyPrompt();
  awaitingStudyTap = true;
  await new Promise(r => { studyTapResolve = r; });
  if (genId !== myId) return;

  setStatus(`Black plays ${puz.blunderMove.san}`);
  await board.setPosition(puz.fenAfter, true);
  if (genId !== myId) return;

  await new Promise(r => setTimeout(r, 500));
  if (genId !== myId) return;

  setStatus('');
  puzzleActive = true;
  startTimer();
}

// ─── Interaction ──────────────────────────────────────────────────────────────

function handleBoardClick(e) {
  if (awaitingStudyTap) {
    cancelStudyTap();
    return;
  }
  if (!puzzleActive) return;
  const sq = sqFromClick(e);
  if (!sq) return;

  // Only react to black pieces in the post-move position
  let chess;
  try { chess = new Chess(currentPuzzle.fenAfter); } catch { return; }
  const piece = chess.get(sq);
  if (!piece || piece.color !== 'b') return;

  if (currentPuzzle.isPass) {
    puzzleMisses++;
    firstTryThisPuzzle = false;
    flashSqRed(sq);
    setStatus('Nothing to grab here — try PASS');
    document.getElementById('bb-misses').textContent = `Misses: ${sessionMisses + puzzleMisses}`;
  } else if (sq === currentPuzzle.hangingSquares[0]) {
    drawSqOverlay(sq, 'hg-sq-correct');
    const elapsed = finishPuzzle(true);
    setStatus(firstTryThisPuzzle ? `✓  ${elapsed}s` : `Got it!  ${elapsed}s`);
    autoAdvanceTimer = setTimeout(loadPuzzle, 1200);
  } else {
    puzzleMisses++;
    firstTryThisPuzzle = false;
    flashSqRed(sq);
    setStatus("That piece isn't hanging");
    document.getElementById('bb-misses').textContent = `Misses: ${sessionMisses + puzzleMisses}`;
  }
}

function handlePass() {
  if (!puzzleActive) return;
  if (currentPuzzle.isPass) {
    const elapsed = finishPuzzle(true);
    setStatus(`✓ Nothing to grab!  ${elapsed}s`);
    autoAdvanceTimer = setTimeout(loadPuzzle, 1200);
  } else {
    puzzleMisses++;
    firstTryThisPuzzle = false;
    drawSqOverlay(currentPuzzle.hangingSquares[0], 'hg-sq-reveal');
    setStatus("There's a hanging piece!");
    document.getElementById('bb-misses').textContent = `Misses: ${sessionMisses + puzzleMisses}`;
  }
}

function handleShow() {
  if (!puzzleActive) return;
  finishPuzzle(false);
  if (currentPuzzle.isPass) {
    setStatus('PASS was correct — nothing to grab.');
  } else {
    drawSqOverlay(currentPuzzle.hangingSquares[0], 'hg-sq-reveal');
    const h = currentPuzzle.hangingPiece;
    setStatus(`Answer: ${PIECE_NAMES[h.type]} on ${h.sq}`);
  }
  autoAdvanceTimer = setTimeout(loadPuzzle, 2000);
}

// ─── Scoring & session ────────────────────────────────────────────────────────

function finishPuzzle(correct) {
  puzzleActive = false;
  const elapsed = stopTimer();
  sessionMisses += puzzleMisses;
  document.getElementById('bb-misses').textContent = `Misses: ${sessionMisses}`;
  drillResults.push({ seconds: parseFloat(elapsed), correct: correct ? 1 : 0, misses: puzzleMisses });
  upsertDrillDay('bb', {
    seconds: Math.round(parseFloat(elapsed)),
    correct: correct ? 1 : 0,
    misses:  puzzleMisses,
    puzzleId: `bb-${puzzleCount}`,
  });
  updateSessionStats();
  return elapsed;
}

async function showSummary() {
  genId++; // cancel any in-flight loadPuzzle async sequence
  cancelStudyTap();
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleActive = false;
  clearInterval(timerInterval); timerInterval = null;

  document.getElementById('btn-summary-again').onclick = () => navigate('screen-bbgen');

  const n = drillResults.length;
  document.getElementById('stat-count').textContent = n;
  await updateSummaryGoals('bb', n);

  if (n > 0) {
    const totalSeconds = drillResults.reduce((s, r) => s + r.seconds, 0);
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
    const accuracy = Math.round(totalCorrect / n * 100);
    document.getElementById('stat-avg-time').textContent = `${(totalSeconds / n).toFixed(1)}s`;
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
    const { accMet, timeMet } = await checkGoals('bb', n, totalCorrect, totalMisses, totalSeconds);
    if (accMet || timeMet) await showGoalCelebration(accMet, timeMet, accuracy, totalSeconds / n);
    const isPB = await checkAndUpdatePB('bb', n, totalCorrect, totalMisses, totalSeconds);
    if (isPB) await showPBCelebration();
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
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

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  puzzleStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s = ((Date.now() - puzzleStartTime) / 1000).toFixed(1);
    document.getElementById('bb-timer').textContent = `${s}s`;
  }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const elapsed = ((Date.now() - puzzleStartTime) / 1000).toFixed(1);
  document.getElementById('bb-timer').textContent = `${elapsed}s`;
  return elapsed;
}

// ─── Session stats ────────────────────────────────────────────────────────────

function updateSessionStats() {
  const n = drillResults.length;
  if (!n) return;
  const totalC = drillResults.reduce((s, r) => s + r.correct, 0);
  const acc    = Math.round(totalC / n * 100);
  const times  = drillResults.filter(r => r.correct).map(r => r.seconds);
  const avg    = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : null;
  document.getElementById('bb-session-time').textContent = avg ? `Avg ${avg}s` : '';
  document.getElementById('bb-session-acc').textContent  = `Acc ${acc}%`;
  document.getElementById('bb-session-stats').classList.remove('hidden');
}

// ─── SVG overlays ────────────────────────────────────────────────────────────

function fileOf(sq) { return sq.charCodeAt(0) - 97; }
function rankOf(sq) { return parseInt(sq[1]) - 1; }

function getSvgInfo() {
  const boardEl = document.getElementById('bb-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  return { svg, sqSize: boardW / 8 };
}

function sqToXY(sq, sqSize) {
  return { x: fileOf(sq) * sqSize, y: (7 - rankOf(sq)) * sqSize };
}

function drawSqOverlay(sq, cssClass) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const { x, y } = sqToXY(sq, sqSize);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);        rect.setAttribute('y', y + 2);
  rect.setAttribute('width',  sqSize - 4); rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);           rect.setAttribute('class', cssClass);
  rect.setAttribute('data-bb-sq', sq);
  svg.appendChild(rect);
}

function flashSqRed(sq) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const { x, y } = sqToXY(sq, sqSize);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);        rect.setAttribute('y', y + 2);
  rect.setAttribute('width',  sqSize - 4); rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);           rect.setAttribute('class', 'hg-sq-flash');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 600);
}

function clearOverlays() {
  const boardEl = document.getElementById('bb-board');
  if (boardEl) boardEl.querySelectorAll('[data-bb-sq]').forEach(el => el.remove());
}

function sqFromClick(e) {
  const boardEl = document.getElementById('bb-board');
  const rect    = boardEl.getBoundingClientRect();
  const xFrac   = (e.clientX - rect.left) / rect.width;
  const yFrac   = (e.clientY - rect.top)  / rect.height;
  const fileIdx = Math.floor(xFrac * 8);
  const rankIdx = 7 - Math.floor(yFrac * 8);
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return sqName(fileIdx, rankIdx);
}

function setStatus(text) {
  document.getElementById('bb-status').textContent = text;
}
