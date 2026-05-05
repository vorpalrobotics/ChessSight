import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { upsertDrillDay } from './storage.js';
import { checkAndUpdatePB, showPBCelebration, checkGoals, showGoalCelebration, updateSummaryGoals } from './pb.js';
import { registerPause } from './pause.js';
import { runWalkthrough } from './walkthrough.js';
import { buildWalkthrough } from './helptext.js';

const PIECES_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';

// ─── Geometry ─────────────────────────────────────────────────────────────────

const ALL_SQS = [];
for (let r = 0; r < 8; r++)
  for (let f = 0; f < 8; f++)
    ALL_SQS.push(String.fromCharCode(97 + f) + (r + 1));

function fileOf(sq) { return sq.charCodeAt(0) - 97; }
function rankOf(sq) { return parseInt(sq[1]) - 1; }
function sqName(f, r) { return String.fromCharCode(97 + f) + (r + 1); }
function sqColor(sq) { return (fileOf(sq) + rankOf(sq)) % 2; }

const BISHOP_DIRS = [[1,1],[1,-1],[-1,1],[-1,-1]];

// Returns squares of black pieces reachable by a bishop at bsq (path unblocked)
function bishopCaptures(bsq, occupied, blackSqs) {
  const targets = [];
  for (const [df, dr] of BISHOP_DIRS) {
    let f = fileOf(bsq) + df, r = rankOf(bsq) + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = sqName(f, r);
      if (occupied.has(sq)) {
        if (blackSqs.has(sq)) targets.push(sq);
        break;
      }
      f += df; r += dr;
    }
  }
  return targets;
}

// ─── Random helpers ────────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

// Box-Muller normal sample
function randNormal(mean, std) {
  const u = Math.random() || 1e-10, v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Bishop placement ──────────────────────────────────────────────────────────

const CORNERS = [{f:0,r:0}, {f:7,r:0}, {f:0,r:7}, {f:7,r:7}];

// Pick a bishop square: Gaussian distance from a random corner (σ=1.5).
// avoidParity: if 0 or 1, reject squares of that color (for opposite-bishop constraint).
function pickBishopSquare(occupied, avoidParity = -1) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const corner = pick(CORNERS);
    const df = Math.round(Math.abs(randNormal(0, 1.5)));
    const dr = Math.round(Math.abs(randNormal(0, 1.5)));
    const file = corner.f === 0 ? Math.min(df, 7) : Math.max(7 - df, 0);
    const rank = corner.r === 0 ? Math.min(dr, 7) : Math.max(7 - dr, 0);
    const sq = sqName(file, rank);
    if (occupied.has(sq)) continue;
    if (avoidParity !== -1 && sqColor(sq) === avoidParity) continue;
    return sq;
  }
  return null;
}

// Weighted pick preferring squares near the given center squares (σ≈1.5 squares)
function pickNear(avail, centers) {
  if (!avail.length) return null;
  if (!centers.length) return pick(avail);
  const scores = avail.map(sq => {
    const minDist = Math.min(...centers.map(c => {
      const df = fileOf(sq) - fileOf(c), dr = rankOf(sq) - rankOf(c);
      return Math.sqrt(df * df + dr * dr);
    }));
    return Math.exp(-minDist * minDist / 4.5); // σ=1.5
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < avail.length; i++) {
    r -= scores[i];
    if (r <= 0) return avail[i];
  }
  return avail[avail.length - 1];
}

// ─── Position generation ───────────────────────────────────────────────────────

const BLACK_POOL  = ['p','p','p','p','n','n','b','r','q'];
const W_NOISE_POOL = ['N','R','Q'];

function generatePosition() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const occupied = new Set();
    const pieces   = {};   // sq → piece char (uppercase=white, lowercase=black)

    // 1. Place 1 bishop (65%) or 2 on opposite color squares (35%)
    const numBishops = Math.random() < 0.35 ? 2 : 1;
    const bishops = [];

    const b1 = pickBishopSquare(occupied);
    if (!b1) continue;
    bishops.push(b1);
    occupied.add(b1);
    pieces[b1] = 'B';

    if (numBishops === 2) {
      const b2 = pickBishopSquare(occupied, sqColor(b1)); // force opposite parity
      if (b2) {
        bishops.push(b2);
        occupied.add(b2);
        pieces[b2] = 'B';
      }
    }

    // 2. White pawns near bishops, ranks 2–6 (index 1–5)
    const numWP = randInt(2, 5);
    for (let i = 0; i < numWP; i++) {
      const avail = ALL_SQS.filter(sq => rankOf(sq) >= 1 && rankOf(sq) <= 5 && !occupied.has(sq));
      const sq = pickNear(avail, bishops);
      if (!sq) break;
      occupied.add(sq);
      pieces[sq] = 'P';
    }

    // 3. White noise pieces (0–2), not bishops or pawns
    const numWN = randInt(0, 2);
    for (let i = 0; i < numWN; i++) {
      const avail = ALL_SQS.filter(sq => !occupied.has(sq));
      if (!avail.length) break;
      const sq = pick(avail);
      occupied.add(sq);
      pieces[sq] = pick(W_NOISE_POOL);
    }

    // 4. Black pieces (targets + visual noise)
    //    Pawns on ranks 3–7 (index 2–6); other pieces anywhere
    const numBlack = randInt(4, 9);
    const blackSqs = new Set();
    for (let i = 0; i < numBlack; i++) {
      const type = pick(BLACK_POOL);
      const avail = type === 'p'
        ? ALL_SQS.filter(sq => rankOf(sq) >= 2 && rankOf(sq) <= 6 && !occupied.has(sq))
        : ALL_SQS.filter(sq => !occupied.has(sq));
      if (!avail.length) break;
      const sq = pick(avail);
      occupied.add(sq);
      blackSqs.add(sq);
      pieces[sq] = type;
    }

    if (blackSqs.size < 3) continue; // need enough visual noise

    // 5. Compute sniper targets
    const targets = new Set();
    for (const bsq of bishops)
      for (const tsq of bishopCaptures(bsq, occupied, blackSqs))
        targets.add(tsq);

    return { bishops, pieces, blackSqs, targets, occupied };
  }
  return null; // shouldn't happen
}

function buildFen({ pieces }) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces[sqName(f, r)];
      if (p) { if (empty) { row += empty; empty = 0; } row += p; }
      else empty++;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/') + ' w - - 0 1';
}

// ─── Module state ─────────────────────────────────────────────────────────────

let board            = null;
let navigate         = null;
let currentPos       = null;
let foundSqs         = new Set();
let puzzleMisses     = 0;
let firstTry         = true;
let puzzleActive     = false;
let puzzleStartTime  = 0;
let timerInterval    = null;
let puzzleCount      = 0;
let sessionMisses    = 0;
const drillResults   = [];
let pauseStart       = 0;
let autoAdvanceTimer = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function initSniper(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-sniper-done').addEventListener('click', showSummary);
  document.getElementById('btn-sn-pass').addEventListener('click', handlePass);
  document.getElementById('btn-sn-show').addEventListener('click', handleShow);
  document.getElementById('sn-board').addEventListener('click', handleBoardClick);
}

export async function startSniper() {
  registerPause(pauseDrill, resumeDrill);
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleCount   = 0;
  sessionMisses = 0;
  drillResults.length = 0;
  document.getElementById('sn-session-time').textContent = '';
  document.getElementById('sn-session-acc').textContent  = '';
  document.getElementById('sn-session-stats').classList.add('hidden');
  const fill = document.getElementById('sn-progress-fill');
  if (fill) fill.style.width = '0%';
  const lbl = document.getElementById('sn-progress-label');
  if (lbl) lbl.textContent = '';
  document.getElementById('sn-misses').textContent = 'Misses: 0';

  if (!board) {
    board = new Chessboard(document.getElementById('sn-board'), {
      position: '8/8/8/8/8/8/8/8 w - - 0 1',
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
    });
  }

  await runWalkthrough('sniper', buildWalkthrough('sniper'));
  loadPuzzle();
}

// ─── Puzzle lifecycle ─────────────────────────────────────────────────────────

function loadPuzzle() {
  const limit = getPositionsPerDrill();
  if (limit !== null && drillResults.length >= limit) { showSummary(); return; }

  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleActive = false;
  stopTimer();
  clearOverlays();
  setStatus('');

  puzzleCount++;
  updateProgress();

  currentPos    = generatePosition() ?? generatePosition(); // fallback retry
  foundSqs      = new Set();
  puzzleMisses  = 0;
  firstTry      = true;

  board.setPosition(buildFen(currentPos), false);
  startTimer();
  puzzleActive = true;
}

function handleBoardClick(e) {
  if (!puzzleActive) return;
  const sq = sqFromClick(e);
  if (!sq) return;

  // Ignore white pieces
  if (!currentPos.blackSqs.has(sq)) return;

  // Ignore already-found squares
  if (foundSqs.has(sq)) return;

  if (currentPos.targets.has(sq)) {
    drawSqOverlay(sq, 'sn-sq-correct');
    foundSqs.add(sq);
    if (foundSqs.size === currentPos.targets.size) {
      const elapsed = finishPuzzle(true);
      setStatus(firstTry ? `✓  ${elapsed}s` : `Found all  ${elapsed}s`);
      autoAdvanceTimer = setTimeout(loadPuzzle, 1500);
    }
  } else {
    flashSqRed(sq);
    puzzleMisses++;
    firstTry = false;
    document.getElementById('sn-misses').textContent = `Misses: ${sessionMisses + puzzleMisses}`;
  }
}

function handlePass() {
  if (!puzzleActive) return;
  if (currentPos.targets.size === 0) {
    const elapsed = finishPuzzle(true);
    setStatus(`✓ No targets!  ${elapsed}s`);
    autoAdvanceTimer = setTimeout(loadPuzzle, 1500);
  } else {
    finishPuzzle(false);
    currentPos.targets.forEach(sq => {
      if (!foundSqs.has(sq)) drawSqOverlay(sq, 'sn-sq-reveal');
    });
    setStatus('Bishop had targets — see highlights.');
    autoAdvanceTimer = setTimeout(loadPuzzle, 2000);
  }
}

function handleShow() {
  if (!puzzleActive) return;
  finishPuzzle(false);
  if (currentPos.targets.size === 0) {
    setStatus('No targets here — PASS was correct.');
  } else {
    currentPos.targets.forEach(sq => {
      if (!foundSqs.has(sq)) drawSqOverlay(sq, 'sn-sq-reveal');
    });
    setStatus('Sniper targets shown.');
  }
  autoAdvanceTimer = setTimeout(loadPuzzle, 2000);
}

function finishPuzzle(correct) {
  puzzleActive = false;
  const elapsed = stopTimer();
  sessionMisses += puzzleMisses;
  document.getElementById('sn-misses').textContent = `Misses: ${sessionMisses}`;
  drillResults.push({ seconds: parseFloat(elapsed), correct: correct ? 1 : 0, misses: puzzleMisses });
  upsertDrillDay('sniper', {
    seconds: Math.round(parseFloat(elapsed)),
    correct: correct ? 1 : 0,
    misses: puzzleMisses,
    puzzleId: `sn-${puzzleCount}`,
  });
  updateSessionStats();
  return elapsed;
}

// ─── Pause ────────────────────────────────────────────────────────────────────

function pauseDrill()  { if (puzzleActive) { stopTimer(); pauseStart = Date.now(); } }
function resumeDrill() { if (puzzleActive) { puzzleStartTime += Date.now() - pauseStart; startTimer(); } }

// ─── Summary ──────────────────────────────────────────────────────────────────

async function showSummary() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  puzzleActive = false;
  stopTimer();

  document.getElementById('btn-summary-again').onclick = () => {
    navigate('screen-sniper');
    startSniper();
  };

  const n = drillResults.length;
  document.getElementById('stat-count').textContent = n;
  await updateSummaryGoals('sniper', n);
  if (n > 0) {
    const totalSeconds = drillResults.reduce((s, r) => s + r.seconds, 0);
    const totalCorrect = drillResults.reduce((s, r) => s + r.correct, 0);
    const totalMisses  = drillResults.reduce((s, r) => s + r.misses,  0);
    const accuracy = Math.round(totalCorrect / n * 100);
    document.getElementById('stat-avg-time').textContent = `${(totalSeconds / n).toFixed(1)}s`;
    document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
    const { accMet, timeMet } = await checkGoals('sniper', n, totalCorrect, totalMisses, totalSeconds);
    if (accMet || timeMet) await showGoalCelebration(accMet, timeMet, accuracy, totalSeconds / n);
    const isPB = await checkAndUpdatePB('sniper', n, totalCorrect, totalMisses, totalSeconds);
    if (isPB) await showPBCelebration();
  } else {
    document.getElementById('stat-avg-time').textContent = '—';
    document.getElementById('stat-accuracy').textContent = '—';
  }
  navigate('screen-summary');
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer() {
  puzzleStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s = ((Date.now() - puzzleStartTime) / 1000).toFixed(1);
    document.getElementById('sn-timer').textContent = `${s}s`;
  }, 100);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const elapsed = ((Date.now() - puzzleStartTime) / 1000).toFixed(1);
  document.getElementById('sn-timer').textContent = `${elapsed}s`;
  return elapsed;
}

// ─── Progress & session stats ──────────────────────────────────────────────────

function getPositionsPerDrill() {
  const el = document.getElementById('select-positions-per-drill');
  if (!el || el.value === 'unlimited') return null;
  return parseInt(el.value, 10);
}

function updateProgress() {
  const fill  = document.getElementById('sn-progress-fill');
  const label = document.getElementById('sn-progress-label');
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

function updateSessionStats() {
  const n = drillResults.length;
  if (!n) return;
  const totalC = drillResults.reduce((s, r) => s + r.correct, 0);
  const acc = Math.round(totalC / n * 100);
  const correctTimes = drillResults.filter(r => r.correct).map(r => r.seconds);
  const avg = correctTimes.length
    ? (correctTimes.reduce((a, b) => a + b, 0) / correctTimes.length).toFixed(1)
    : null;
  document.getElementById('sn-session-time').textContent = avg ? `Avg ${avg}s` : '';
  document.getElementById('sn-session-acc').textContent  = `Acc ${acc}%`;
  document.getElementById('sn-session-stats').classList.remove('hidden');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(text) {
  document.getElementById('sn-status').textContent = text;
}

function getSvgInfo() {
  const boardEl = document.getElementById('sn-board');
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
  rect.setAttribute('x', x + 2);
  rect.setAttribute('y', y + 2);
  rect.setAttribute('width',  sqSize - 4);
  rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-sn-sq', sq);
  svg.appendChild(rect);
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
  rect.setAttribute('class', 'sn-sq-flash');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 600);
}

function clearOverlays() {
  const boardEl = document.getElementById('sn-board');
  if (boardEl) boardEl.querySelectorAll('[data-sn-sq]').forEach(el => el.remove());
}

function sqFromClick(e) {
  const boardEl = document.getElementById('sn-board');
  const rect = boardEl.getBoundingClientRect();
  const xFrac = (e.clientX - rect.left)  / rect.width;
  const yFrac = (e.clientY - rect.top)   / rect.height;
  const fileIdx = Math.floor(xFrac * 8);
  const rankIdx = 7 - Math.floor(yFrac * 8);
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return sqName(fileIdx, rankIdx);
}
