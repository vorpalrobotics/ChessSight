import { Chessboard, COLOR, INPUT_EVENT_TYPE } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Markers } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/markers/Markers.js';
import { Arrows } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/arrows/Arrows.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { Engine } from './engine.js';
import { addDisciplineGame } from './storage.js';
import { registerPause } from './pause.js';
import { runWalkthrough } from './walkthrough.js';
import { DRILL_WALKTHROUGH } from './helptext.js';

const PIECES_URL  = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const MARKERS_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/markers/markers.svg';
const ARROWS_SVG_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/arrows/arrows.svg';

const PHASE = { CHECKS: 0, CAPTURES: 1, LOOSE: 2, CANDIDATES: 3, MOVE: 4 };

const MARKER_SELECTED = { class: 'marker-selected', slice: 'markerFrame' };
const MARKER_TARGET   = { class: 'marker-target',   slice: 'markerSquare' };
const MARKER_LEGAL    = { class: 'marker-legal',     slice: 'markerDot' };
const MARKER_CAPTURE  = { class: 'marker-capture',   slice: 'markerSquare' };

// ─── Tactics helpers (self-contained, no cross-module dependency) ──────────────

function countChecksForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar; parts[3] = '-';
  const tmp = new Chess();
  try { tmp.load(parts.join(' ')); } catch { return 0; }
  const found = new Set(); let n = 0;
  for (const m of tmp.moves({ verbose: true })) {
    const key = m.from + m.to;
    if (found.has(key)) continue;
    try { tmp.move(m); if (tmp.inCheck()) { found.add(key); n++; } tmp.undo(); } catch { /* skip */ }
  }
  return Math.min(n, 9);
}

function countCapturesForColor(fen, colorChar) {
  const parts = fen.split(' ');
  parts[1] = colorChar; parts[3] = '-';
  const tmp = new Chess();
  try { tmp.load(parts.join(' ')); } catch { return 0; }
  const found = new Set(); let n = 0;
  for (const m of tmp.moves({ verbose: true })) {
    if (!m.captured) continue;
    const key = m.from + m.to;
    if (!found.has(key)) { found.add(key); n++; }
  }
  return Math.min(n, 9);
}

function getLoosePieces(fen) {
  const tmp = new Chess();
  try { tmp.load(fen); } catch { return new Set(); }
  const result = new Set();
  for (const file of 'abcdefgh') {
    for (let rank = 1; rank <= 8; rank++) {
      const sq = file + rank;
      const piece = tmp.get(sq);
      if (!piece || piece.type === 'k') continue;
      if (tmp.attackers(sq, piece.color).length === 0) result.add(sq);
    }
  }
  return result;
}

// ─── Module state ─────────────────────────────────────────────────────────────

let board = null;
let discEngine = null;
let chess = null;
let navigate = null;
let onWin = null;
let boardOrientation = COLOR.white;
let playerSide = 'w';       // 'w' or 'b' (resolved at game start)
let chosenSide  = 'w';      // 'w', 'b', 'r'
let skillLevel  = 10;
let isGameActive = false;
let currentPhase = PHASE.CHECKS;
let playerTurnCount = 0;
let moveIsDrag = false;
let selectedSquare = null;

// Per-turn precomputed answers
let turnChecksW = 0, turnChecksB = 0;
let turnCapturesW = 0, turnCapturesB = 0;
let turnLooseSqs  = new Set();
let foundLooseSqs = new Set();

// Per-phase answer selections
let selectedChecksW = null, selectedChecksB = null;
let selectedCapturesW = null, selectedCapturesB = null;
let checksFirstAttempt = true, capsFirstAttempt = true;

// Session stats (accumulated across the game)
let gameStartTime = 0;
let playerTurns = 0;
let checksTotal = 0, checksFirstTry = 0, checksMisses = 0;
let capsTotal   = 0, capsFirstTry   = 0, capsMisses   = 0;
let looseMisses = 0, bookMoves = 0, forcedMoves = 0;
let looseTotal  = 0;
// Per-phase timing (ms accumulated across all turns, stopped at user-completion moment)
let phaseStartTime = 0;
let checksMs = 0, capturesMs = 0, looseMs = 0;
let waitingLooseContinue = false;
let looseComplete = false;   // true once auto-advance fires from handleBoardClick
let discPauseStart = 0;

// Review mode state
let fenHistory = [];   // FEN after each half-move (index 0 = initial position)
let reviewPly = 0;
let reviewActive = false;
let reviewEvalGen = 0;  // generation counter — discards stale evals after navigation

// ─── Public API ───────────────────────────────────────────────────────────────

export function initDiscipline(navigateFn, onWinFn) {
  navigate = navigateFn;
  onWin = onWinFn;

  // Setup panel
  const SKILL_ELO = [800,900,1000,1100,1200,1300,1400,1500,1600,1700,1800,1900,2000,2100,2200,2300,2400,2600,2800,3000,'3200+'];
  const slider = document.getElementById('disc-skill-slider');
  const updateSkillDisplay = () => {
    document.getElementById('disc-skill-display').textContent = slider.value;
    document.getElementById('disc-elo-display').textContent = `~${SKILL_ELO[+slider.value]} ELO`;
  };
  slider.addEventListener('input', () => {
    updateSkillDisplay();
    localStorage.setItem('disc-skill', slider.value);
  });
  document.getElementById('btn-disc-white').addEventListener('click',  () => setChosenSide('w'));
  document.getElementById('btn-disc-black').addEventListener('click',  () => setChosenSide('b'));
  document.getElementById('btn-disc-random').addEventListener('click', () => setChosenSide('r'));
  document.getElementById('btn-disc-start').addEventListener('click', startGame);

  // Restore saved preferences
  const savedSkill = localStorage.getItem('disc-skill');
  if (savedSkill !== null) slider.value = savedSkill;
  updateSkillDisplay();
  setChosenSide(localStorage.getItem('disc-side') ?? 'w');

  // In-game controls
  document.getElementById('btn-disc-resign').addEventListener('click', resignGame);
  document.getElementById('btn-disc-exit').addEventListener('click', exitGame);
  document.getElementById('btn-disc-book').addEventListener('click', useBook);
  document.getElementById('btn-menu').addEventListener('click', cleanupDrill);

  // Phase panels
  document.getElementById('btn-disc-checks-submit').addEventListener('click', submitChecks);
  document.getElementById('btn-disc-captures-submit').addEventListener('click', submitCaptures);
  document.getElementById('btn-disc-loose-done').addEventListener('click', looseDone);

  // Board interaction
  const boardEl = document.getElementById('disc-board');
  boardEl.addEventListener('click', handleBoardClick);
  let ptrX = 0, ptrY = 0;
  boardEl.addEventListener('pointerdown', e => { ptrX = e.clientX; ptrY = e.clientY; moveIsDrag = false; }, true);
  boardEl.addEventListener('pointermove', e => {
    if (!moveIsDrag && Math.hypot(e.clientX - ptrX, e.clientY - ptrY) > 8) moveIsDrag = true;
  });

  // End screen
  document.getElementById('btn-disc-again').addEventListener('click', () => {
    document.getElementById('disc-game-over').classList.add('hidden');
    document.getElementById('disc-setup').classList.remove('hidden');
  });
  document.getElementById('btn-disc-over-menu').addEventListener('click', () => navigate('screen-select'));
  document.getElementById('btn-disc-review').addEventListener('click', enterReviewMode);

  // Review controls
  document.getElementById('btn-disc-review-start').addEventListener('click', () => navigateReview(-Infinity));
  document.getElementById('btn-disc-review-prev' ).addEventListener('click', () => navigateReview(-1));
  document.getElementById('btn-disc-review-next' ).addEventListener('click', () => navigateReview(1));
  document.getElementById('btn-disc-review-end'  ).addEventListener('click', () => navigateReview(Infinity));
  document.getElementById('btn-disc-review-exit' ).addEventListener('click', exitReviewMode);

  // Review depth selector — restore saved value
  const depthSel = document.getElementById('select-review-depth');
  const savedDepth = localStorage.getItem('disc-review-depth');
  if (savedDepth) depthSel.value = savedDepth;
  depthSel.addEventListener('change', () => {
    localStorage.setItem('disc-review-depth', depthSel.value);
    // Re-run eval at new depth for current position
    if (reviewActive) {
      const fen = fenHistory[reviewPly];
      resetEvalDisplay();
      updateReviewEval(fen);
    }
  });

  // Keyboard navigation in review mode
  document.addEventListener('keydown', e => {
    if (!reviewActive) return;
    if      (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { navigateReview(-1);        e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  { navigateReview(1);         e.preventDefault(); }
    else if (e.key === 'Home')                                  { navigateReview(-Infinity); e.preventDefault(); }
    else if (e.key === 'End')                                   { navigateReview(Infinity);  e.preventDefault(); }
  });

  // Render digit button rows (done once; reused every game)
  buildDigitRow('disc-checks-w-digits',   'cw');
  buildDigitRow('disc-checks-b-digits',   'cb');
  buildDigitRow('disc-captures-w-digits', 'pw');
  buildDigitRow('disc-captures-b-digits', 'pb');
}

export async function startDiscipline() {
  cleanupDrill();
  document.getElementById('disc-game-area').classList.add('hidden');
  document.getElementById('disc-game-over').classList.add('hidden');
  document.getElementById('disc-setup').classList.remove('hidden');
  await runWalkthrough('discipline', DRILL_WALKTHROUGH['discipline'] ?? []);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function setChosenSide(side) {
  chosenSide = side;
  localStorage.setItem('disc-side', side);
  ['w', 'b', 'r'].forEach(s =>
    document.getElementById({ w: 'btn-disc-white', b: 'btn-disc-black', r: 'btn-disc-random' }[s])
      .classList.toggle('active', s === side)
  );
}

async function startGame() {
  skillLevel  = parseInt(document.getElementById('disc-skill-slider').value, 10);
  playerSide  = chosenSide === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : chosenSide;
  boardOrientation = playerSide === 'w' ? COLOR.white : COLOR.black;

  document.getElementById('disc-setup').classList.add('hidden');
  document.getElementById('disc-game-over').classList.add('hidden');
  document.getElementById('disc-game-area').classList.remove('hidden');
  showPanel('engine');
  setPhaseIndicator('Loading engine…');
  updateBookBtn(false);
  setFeedback('');

  // Lazy-init engine
  if (!discEngine) {
    discEngine = new Engine();
    try { await discEngine.init(); }
    catch (err) { setFeedback(`Engine failed to load: ${err.message}`, 'error'); return; }
  }
  discEngine.setSkillLevel(skillLevel);

  // Reset game state
  chess = new Chess();
  isGameActive = true;
  playerTurnCount = 0;
  playerTurns = 0;
  checksTotal = checksFirstTry = checksMisses = 0;
  capsTotal   = capsFirstTry   = capsMisses   = 0;
  looseMisses = bookMoves = forcedMoves = 0;
  looseTotal  = 0;
  checksMs = capturesMs = looseMs = phaseStartTime = 0;
  gameStartTime = Date.now();
  registerPause(pauseGame, resumeGame);

  const fen = chess.fen();
  if (!board) {
    board = new Chessboard(document.getElementById('disc-board'), {
      position: fen,
      orientation: boardOrientation,
      style: { pieces: { file: PIECES_URL } },
      extensions: [
        { class: Markers, props: { sprite: MARKERS_URL } },
        { class: Arrows, props: { sprite: ARROWS_SVG_URL, headSize: 6 } },
      ],
    });
  } else {
    board.disableMoveInput();
    board.setOrientation(boardOrientation);
    board.setPosition(fen, false);
  }

  document.getElementById('disc-turn-num').textContent = 'Turn 1';

  if (playerSide === 'b') {
    // Engine plays white's first move
    await doEngineMove();
  } else {
    startPlayerTurn();
  }
}

// ─── Turn lifecycle ───────────────────────────────────────────────────────────

function startPlayerTurn() {
  if (!isGameActive) return;
  waitingLooseContinue = false;
  clearContinueMsg();
  playerTurnCount++;
  playerTurns++;
  clearSqMarks();
  board.disableMoveInput();
  clearMoveMarkers();
  document.getElementById('disc-turn-num').textContent = `Turn ${playerTurns}`;
  setFeedback('');

  const fen = chess.fen();

  // Precompute correct answers for this position
  turnChecksW   = countChecksForColor(fen, 'w');
  turnChecksB   = countChecksForColor(fen, 'b');
  turnCapturesW = countCapturesForColor(fen, 'w');
  turnCapturesB = countCapturesForColor(fen, 'b');
  turnLooseSqs  = getLoosePieces(fen);
  foundLooseSqs = new Set();

  // Single legal move → skip discipline, let user make the move
  if (chess.moves().length === 1) {
    forcedMoves++;
    showPanel('forced');
    setPhaseIndicator('ONLY ONE LEGAL MOVE');
    updateBookBtn(false);
    board.enableMoveInput(handleMoveInput, playerSide === 'w' ? COLOR.white : COLOR.black);
    return;
  }

  updateBookBtn(true);
  enterPhase(PHASE.CHECKS);
}

// ─── Phase machine ────────────────────────────────────────────────────────────

function enterPhase(phase) {
  currentPhase = phase;
  clearSqMarks();

  if (phase === PHASE.CHECKS) {
    checksFirstAttempt = true;
    selectedChecksW = selectedChecksB = null;
    resetDigitRow('disc-checks-w-digits');
    resetDigitRow('disc-checks-b-digits');
    document.getElementById('btn-disc-checks-submit').disabled = true;
    showPanel('checks');
    setPhaseIndicator('STEP 1 / 4 — COUNT CHECKS');

    const inCheck = chess.inCheck();
    document.getElementById('disc-checks-rows').classList.toggle('hidden', inCheck);
    const inCheckMsg = document.getElementById('disc-checks-incheck-msg');
    if (inCheck) {
      inCheckMsg.textContent = `${playerSide === 'w' ? 'White' : 'Black'} is already in check`;
      inCheckMsg.classList.remove('hidden');
      setTimeout(() => { if (isGameActive) enterPhase(PHASE.CAPTURES); }, 1500);
    } else {
      checksTotal++;
      inCheckMsg.classList.add('hidden');
      phaseStartTime = Date.now();
    }

  } else if (phase === PHASE.CAPTURES) {
    capsTotal++;
    capsFirstAttempt = true;
    selectedCapturesW = selectedCapturesB = null;
    resetDigitRow('disc-captures-w-digits');
    resetDigitRow('disc-captures-b-digits');
    document.getElementById('btn-disc-captures-submit').disabled = true;
    showPanel('captures');
    setPhaseIndicator('STEP 2 / 4 — COUNT CAPTURES');
    phaseStartTime = Date.now();

  } else if (phase === PHASE.LOOSE) {
    looseComplete = false;
    if (turnLooseSqs.size === 0) { enterPhase(PHASE.CANDIDATES); return; }
    showPanel('loose');
    setPhaseIndicator('STEP 3 / 4 — LOOSE PIECES');
    setFeedback('');
    phaseStartTime = Date.now();

  } else if (phase === PHASE.CANDIDATES) {
    showPanel('candidates');
    setPhaseIndicator('STEP 4 / 4 — OTHER THREATS');
    setFeedback('');
    updateBookBtn(false);
    board.enableMoveInput(handleMoveInput, playerSide === 'w' ? COLOR.white : COLOR.black);

  } else if (phase === PHASE.MOVE) {
    enterMovePhase();
  }
}

function enterMovePhase() {
  currentPhase = PHASE.MOVE;
  showPanel('move');
  setPhaseIndicator('MAKE YOUR MOVE');
  setFeedback('');
  updateBookBtn(false);
  board.enableMoveInput(handleMoveInput, playerSide === 'w' ? COLOR.white : COLOR.black);
}

// ─── Phase: Checks ────────────────────────────────────────────────────────────

function submitChecks() {
  if (selectedChecksW === null || selectedChecksB === null) return;
  if (checksFirstAttempt) checksFirstTry++;
  enterPhase(PHASE.CAPTURES);
}

// ─── Phase: Captures ─────────────────────────────────────────────────────────

function submitCaptures() {
  if (selectedCapturesW === null || selectedCapturesB === null) return;
  if (capsFirstAttempt) capsFirstTry++;
  enterPhase(PHASE.LOOSE);
}

// ─── Phase: Loose pieces ──────────────────────────────────────────────────────

function handleBoardClick(e) {
  if (waitingLooseContinue) {
    waitingLooseContinue = false;
    clearContinueMsg();
    clearSqMarks();
    setFeedback('');
    if (isGameActive) enterPhase(PHASE.CANDIDATES);
    return;
  }
  if (currentPhase !== PHASE.LOOSE) return;
  const sq = sqFromClick(e);
  if (!sq) return;

  if (foundLooseSqs.has(sq)) {
    foundLooseSqs.delete(sq);
    removeSqMark(sq);
    return;
  }
  if (turnLooseSqs.has(sq)) {
    foundLooseSqs.add(sq);
    drawSqMark(sq, 'loose-sq-found');
    if (foundLooseSqs.size === turnLooseSqs.size) {
      looseComplete = true;
      looseMs += Date.now() - phaseStartTime;
      looseTotal++;
      flashFoundSquares();
      setTimeout(() => { if (isGameActive) { clearSqMarks(); enterPhase(PHASE.CANDIDATES); } }, 1500);
    }
  } else {
    looseMisses++;
    flashSqMark(sq);
  }
}

function looseDone() {
  if (waitingLooseContinue) {
    waitingLooseContinue = false;
    clearContinueMsg();
    clearSqMarks();
    setFeedback('');
    if (isGameActive) enterPhase(PHASE.CANDIDATES);
    return;
  }
  if (looseComplete || currentPhase !== PHASE.LOOSE) return;
  looseMs += Date.now() - phaseStartTime;
  looseTotal++;
  let missed = 0;
  for (const sq of turnLooseSqs) {
    if (!foundLooseSqs.has(sq)) { looseMisses++; missed++; drawSqMark(sq, 'loose-sq-missed'); }
  }
  if (missed === 0) {
    flashFoundSquares();
    setTimeout(() => { if (isGameActive) { clearSqMarks(); enterPhase(PHASE.CANDIDATES); } }, 1500);
  } else {
    setFeedback(`${missed} loose piece${missed !== 1 ? 's' : ''} missed — click board to continue.`, 'error');
    showContinueMsg();
    waitingLooseContinue = true;
  }
}

function flashFoundSquares() {
  const boardEl = document.getElementById('disc-board');
  if (boardEl) boardEl.querySelectorAll('.loose-sq-found').forEach(el => el.classList.add('pulsing'));
}

// ─── Phase: Candidates ────────────────────────────────────────────────────────

function candidatesDone() { enterPhase(PHASE.MOVE); }

// ─── BOOK & Resign ────────────────────────────────────────────────────────────

function useBook() {
  if (!isGameActive) return;
  bookMoves++;
  enterMovePhase();
}

function resignGame() {
  if (isGameActive) endGame('resigned');
}

async function exitGame() {
  if (!isGameActive) return;
  isGameActive = false;
  if (board) board.disableMoveInput();
  showPanel('engine');
  setPhaseIndicator('EVALUATING POSITION…');
  updateBookBtn(false);

  const fen = chess.fen();
  let result = 'exit-loss';
  try {
    const { score } = await discEngine.evaluate(fen, 18);
    if (score !== null) {
      const playerScore = playerSide === 'w' ? score : -score;
      if (playerScore > 200)       result = 'exit-win';
      else if (playerScore >= -200) result = 'exit-draw';
      // else keep 'exit-loss'
    }
  } catch { /* keep fallback */ }
  endGame(result);
}

// ─── Move input ───────────────────────────────────────────────────────────────

function handleMoveInput(event) {
  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    const piece = chess.get(event.square);
    if (!piece || piece.color !== chess.turn()) {
      clearMoveMarkers(); selectedSquare = null; return false;
    }
    if (event.square === selectedSquare) {
      clearMoveMarkers(); selectedSquare = null; return false;
    }
    clearMoveMarkers();
    selectedSquare = event.square;
    board.addMarker(MARKER_SELECTED, event.square);
    for (const m of chess.moves({ square: event.square, verbose: true }))
      board.addMarker(m.captured ? MARKER_CAPTURE : MARKER_LEGAL, m.to);
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    selectedSquare = null;
    let move = null;
    try { move = chess.move({ from: event.squareFrom, to: event.squareTo, promotion: 'q' }); } catch { /* invalid */ }
    if (move) {
      board.disableMoveInput();
      if (moveIsDrag) {
        clearMoveMarkers();
        board.setPosition(chess.fen(), false);
      } else {
        board.addMarker(MARKER_TARGET, event.squareTo);
        board.setPosition(chess.fen(), true);
        setTimeout(clearMoveMarkers, 350);
      }
      if (!checkGameOver()) doEngineMove();
      return true;
    }
    clearMoveMarkers();
    if (moveIsDrag) { const fen = chess.fen(); setTimeout(() => board.setPosition(fen, true), 0); }
    return false;
  }

  if (event.type === INPUT_EVENT_TYPE.moveInputCanceled) {
    clearMoveMarkers(); selectedSquare = null;
  }
  return true;
}

function clearMoveMarkers() {
  if (!board) return;
  board.removeMarkers(MARKER_SELECTED);
  board.removeMarkers(MARKER_TARGET);
  board.removeMarkers(MARKER_LEGAL);
  board.removeMarkers(MARKER_CAPTURE);
}

// ─── Engine move ──────────────────────────────────────────────────────────────

async function doEngineMove() {
  if (!isGameActive) return;
  showPanel('engine');
  setPhaseIndicator('ENGINE IS THINKING…');
  updateBookBtn(false);

  const fen   = chess.fen();
  const depth = skillLevel <= 5 ? 5 : skillLevel <= 10 ? 8 : 10;

  // Evaluate and enforce minimum 2-second display
  const [{ bestMove }] = await Promise.all([
    discEngine.evaluate(fen, depth),
    new Promise(r => setTimeout(r, 2000)),
  ]);

  if (!isGameActive) return;

  if (!bestMove) { endGame('draw'); return; }

  try {
    chess.move({ from: bestMove.slice(0, 2), to: bestMove.slice(2, 4), promotion: bestMove[4] ?? 'q' });
  } catch { endGame('draw'); return; }

  board.setPosition(chess.fen(), true);
  if (!checkGameOver()) startPlayerTurn();
}

// ─── Game over ────────────────────────────────────────────────────────────────

function checkGameOver() {
  if (!chess.isGameOver()) return false;
  endGame(chess.isCheckmate()
    ? (chess.turn() === playerSide ? 'loss' : 'win')
    : 'draw');
  return true;
}

function endGame(result) {
  isGameActive = false;
  if (board) board.disableMoveInput();
  clearSqMarks();
  updateBookBtn(false);

  const elapsed = Math.round((Date.now() - gameStartTime) / 1000);
  const avgChecksS   = checksTotal > 0 ? (checksMs   / checksTotal   / 1000).toFixed(1) : null;
  const avgCapturesS = capsTotal   > 0 ? (capturesMs / capsTotal     / 1000).toFixed(1) : null;
  const avgLooseS    = looseTotal  > 0 ? (looseMs    / looseTotal    / 1000).toFixed(1) : null;

  addDisciplineGame({
    date: new Date().toLocaleDateString('sv'),
    side: playerSide === 'w' ? 'white' : 'black',
    skillLevel, result,
    turns: playerTurns,
    checksTotal, checksFirstTry, checksMisses,
    capsTotal, capsFirstTry, capsMisses,
    looseMisses, looseTotal, bookMoves, forcedMoves,
    checksMs, capturesMs, looseMs,
    seconds: elapsed,
  });

  const labels = {
    win: '♔ You Win!', loss: '♚ You Lose', draw: '½-½ Draw', resigned: 'Resigned',
    'exit-win': 'EXIT — Win', 'exit-draw': 'EXIT — Draw', 'exit-loss': 'EXIT — Loss',
  };
  document.getElementById('disc-over-result').textContent = labels[result] ?? result;
  document.getElementById('disc-stat-turns').textContent    = playerTurns;
  document.getElementById('disc-stat-checks').textContent   =
    `${checksFirstTry}/${checksTotal} first try · ${checksMisses} miss${checksMisses !== 1 ? 'es' : ''}`;
  document.getElementById('disc-stat-captures').textContent =
    `${capsFirstTry}/${capsTotal} first try · ${capsMisses} miss${capsMisses !== 1 ? 'es' : ''}`;
  document.getElementById('disc-stat-loose').textContent    = `${looseMisses} miss${looseMisses !== 1 ? 'es' : ''}`;
  document.getElementById('disc-stat-book').textContent     = bookMoves;
  document.getElementById('disc-stat-forced').textContent   = forcedMoves;
  document.getElementById('disc-stat-checks-time').textContent   = avgChecksS   ? `${avgChecksS}s avg`   : '—';
  document.getElementById('disc-stat-captures-time').textContent = avgCapturesS ? `${avgCapturesS}s avg` : '—';
  document.getElementById('disc-stat-loose-time').textContent    = avgLooseS    ? `${avgLooseS}s avg`    : '—';
  document.getElementById('disc-stat-time').textContent     = formatTime(elapsed);

  document.getElementById('disc-game-area').classList.add('hidden');
  document.getElementById('disc-game-over').classList.remove('hidden');
  if (result === 'win' && onWin) onWin();
}

function pauseGame() {
  discPauseStart = Date.now();
}

function resumeGame() {
  const d = Date.now() - discPauseStart;
  gameStartTime += d;
  if (phaseStartTime > 0) phaseStartTime += d;
}

function cleanupDrill() {
  isGameActive = false;
  waitingLooseContinue = false;
  reviewActive = false;
  if (discEngine) discEngine.stop();
  if (board) board.disableMoveInput();
  clearSqMarks();
  clearContinueMsg();
  clearMoveMarkers();
  currentPhase = PHASE.CHECKS;
  playerTurnCount = 0;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const PANELS = ['checks', 'captures', 'loose', 'candidates', 'move', 'engine', 'forced', 'review'];

function showPanel(name) {
  PANELS.forEach(p =>
    document.getElementById(`disc-panel-${p}`).classList.toggle('hidden', p !== name)
  );
}

function setPhaseIndicator(text) {
  document.getElementById('disc-phase-indicator').textContent = text;
}

function setFeedback(text, type = '') {
  const el = document.getElementById('disc-feedback');
  el.textContent = text;
  el.className = `disc-feedback${type ? ' disc-feedback-' + type : ''}`;
}

function updateBookBtn(show) {
  const btn = document.getElementById('btn-disc-book');
  btn.classList.toggle('hidden', !show);
  if (show) btn.textContent = playerTurnCount <= 5 ? 'BOOK' : 'SKIP';
}

// ─── Digit button rows ────────────────────────────────────────────────────────

function buildDigitRow(containerId, key) {
  const container = document.getElementById(containerId);
  for (let d = 0; d <= 7; d++) {
    const btn = document.createElement('button');
    btn.className = 'disc-digit-btn';
    btn.textContent = d < 7 ? String(d) : '7+';
    btn.addEventListener('click', () => onDigitClick(key, d, btn));
    container.appendChild(btn);
  }
}

function onDigitClick(key, digit, btn) {
  // Ignore clicks on already-answered or wrong buttons
  if (btn.classList.contains('correct') || btn.classList.contains('wrong')) return;
  // Ignore if this row already has a correct answer
  if (btn.parentElement.querySelector('.disc-digit-btn.correct')) return;

  const correctAnswer = key === 'cw' ? turnChecksW   : key === 'cb' ? turnChecksB
                      : key === 'pw' ? turnCapturesW : turnCapturesB;

  // '9+' button matches any answer >= 9
  const isCorrect = digit === 7 ? correctAnswer >= 7 : digit === correctAnswer;
  if (isCorrect) {
    btn.classList.add('correct');
    if      (key === 'cw') selectedChecksW   = digit;
    else if (key === 'cb') selectedChecksB   = digit;
    else if (key === 'pw') selectedCapturesW = digit;
    else if (key === 'pb') selectedCapturesB = digit;
    maybeAutoAdvance(key);
  } else {
    btn.classList.add('wrong');
    if (key[0] === 'c') { checksMisses++; checksFirstAttempt = false; }
    else                { capsMisses++;   capsFirstAttempt   = false; }
  }
}

function maybeAutoAdvance(key) {
  if (key[0] === 'c') {
    if (selectedChecksW === null || selectedChecksB === null) return;
    checksMs += Date.now() - phaseStartTime;
    if (checksFirstAttempt) checksFirstTry++;
    pulseCorrectButtons('disc-checks-w-digits');
    pulseCorrectButtons('disc-checks-b-digits');
    setTimeout(() => { if (isGameActive) enterPhase(PHASE.CAPTURES); }, checksFirstAttempt ? 1500 : 2000);
  } else {
    if (selectedCapturesW === null || selectedCapturesB === null) return;
    capturesMs += Date.now() - phaseStartTime;
    if (capsFirstAttempt) capsFirstTry++;
    pulseCorrectButtons('disc-captures-w-digits');
    pulseCorrectButtons('disc-captures-b-digits');
    setTimeout(() => { if (isGameActive) enterPhase(PHASE.LOOSE); }, capsFirstAttempt ? 1500 : 2000);
  }
}

function pulseCorrectButtons(containerId) {
  document.getElementById(containerId)
    .querySelectorAll('.disc-digit-btn.correct')
    .forEach(b => b.classList.add('pulsing'));
}

function resetDigitRow(containerId) {
  document.getElementById(containerId)
    .querySelectorAll('.disc-digit-btn').forEach(b => b.classList.remove('selected', 'correct', 'wrong', 'pulsing'));
}

function markCorrectRow(containerId) {
  document.getElementById(containerId)
    .querySelectorAll('.disc-digit-btn.selected').forEach(b => {
      b.classList.remove('selected');
      b.classList.add('correct');
    });
}

function flashDigitRow(containerId) {
  const el = document.getElementById(containerId);
  el.classList.add('disc-row-flash');
  setTimeout(() => el.classList.remove('disc-row-flash'), 600);
}

// ─── SVG square marks (for loose phase) ──────────────────────────────────────

function sqFromClick(e) {
  const boardEl = document.getElementById('disc-board');
  const rect = boardEl.getBoundingClientRect();
  const xFrac = (e.clientX - rect.left) / rect.width;
  const yFrac = (e.clientY - rect.top)  / rect.height;
  let fileIdx, rankIdx;
  if (boardOrientation === COLOR.white) {
    fileIdx = Math.floor(xFrac * 8);
    rankIdx = 7 - Math.floor(yFrac * 8);
  } else {
    fileIdx = 7 - Math.floor(xFrac * 8);
    rankIdx = Math.floor(yFrac * 8);
  }
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return String.fromCharCode(97 + fileIdx) + (rankIdx + 1);
}

function getSvgInfo() {
  const boardEl = document.getElementById('disc-board');
  const svg = boardEl && boardEl.querySelector('svg');
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  const boardW = (vb && vb.width) ? vb.width : svg.getBoundingClientRect().width;
  return { svg, sqSize: boardW / 8 };
}

function sqToXY(sq, sqSize) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]) - 1;
  return boardOrientation === COLOR.white
    ? { x: file * sqSize, y: (7 - rank) * sqSize }
    : { x: (7 - file) * sqSize, y: rank * sqSize };
}

function drawSqMark(sq, cssClass) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const { x, y } = sqToXY(sq, sqSize);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);  rect.setAttribute('y', y + 2);
  rect.setAttribute('width', sqSize - 4); rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', cssClass);
  rect.setAttribute('data-disc-sq', sq);
  svg.appendChild(rect);
}

function removeSqMark(sq) {
  const boardEl = document.getElementById('disc-board');
  if (boardEl) boardEl.querySelectorAll(`[data-disc-sq="${sq}"]`).forEach(el => el.remove());
}

function flashSqMark(sq) {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const { x, y } = sqToXY(sq, sqSize);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x + 2);  rect.setAttribute('y', y + 2);
  rect.setAttribute('width', sqSize - 4); rect.setAttribute('height', sqSize - 4);
  rect.setAttribute('rx', 4);
  rect.setAttribute('class', 'loose-sq-invalid');
  svg.appendChild(rect);
  setTimeout(() => rect.remove(), 500);
}

function clearSqMarks() {
  const boardEl = document.getElementById('disc-board');
  if (boardEl) boardEl.querySelectorAll('[data-disc-sq]').forEach(el => el.remove());
}

function showContinueMsg() {
  const info = getSvgInfo();
  if (!info) return;
  const { svg, sqSize } = info;
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', sqSize * 4);
  text.setAttribute('y', sqSize * 4);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.setAttribute('font-size', sqSize * 0.35);
  text.setAttribute('class', 'disc-continue-msg');
  text.setAttribute('data-disc-msg', 'continue');
  text.textContent = 'Click to continue';
  svg.appendChild(text);
}

function clearContinueMsg() {
  const boardEl = document.getElementById('disc-board');
  if (boardEl) boardEl.querySelectorAll('[data-disc-msg]').forEach(el => el.remove());
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Game Review ──────────────────────────────────────────────────────────────

function buildFenHistory() {
  const temp = new Chess();
  fenHistory = [temp.fen()];
  for (const mv of chess.history({ verbose: true })) {
    temp.move(mv);
    fenHistory.push(temp.fen());
  }
}

function uciToSan(fen, uci) {
  try {
    const tmp = new Chess();
    tmp.load(fen);
    const mv = tmp.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
    return mv ? mv.san : uci;
  } catch { return uci; }
}

function formatScore(cp, fen) {
  if (cp === null) return '?';
  // Convert to white's perspective (Stockfish scores are from side-to-move POV)
  const fromWhite = fen.split(' ')[1] === 'w' ? cp : -cp;
  if (Math.abs(cp) >= 99000) return fromWhite > 0 ? '+M' : '-M';
  const pawns = fromWhite / 100;
  return pawns >= 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2);
}

function enterReviewMode() {
  buildFenHistory();
  reviewPly = fenHistory.length - 1;
  reviewActive = true;

  document.getElementById('disc-game-over').classList.add('hidden');
  document.getElementById('disc-game-area').classList.remove('hidden');
  document.getElementById('btn-disc-book').classList.add('hidden');
  document.getElementById('btn-disc-exit').classList.add('hidden');
  document.getElementById('btn-disc-resign').classList.add('hidden');
  document.getElementById('disc-turn-num').textContent = '';
  setPhaseIndicator('GAME REVIEW');
  setFeedback('');
  clearSqMarks();
  clearMoveMarkers();
  showPanel('review');
  renderReviewPly();
}

function exitReviewMode() {
  reviewActive = false;
  reviewEvalGen++;          // invalidate any in-flight eval
  if (discEngine) discEngine.stop();
  if (board) board.removeArrows();
  document.getElementById('disc-review-thinking').classList.add('hidden');
  document.getElementById('disc-game-area').classList.add('hidden');
  document.getElementById('disc-game-over').classList.remove('hidden');
}

function navigateReview(delta) {
  const newPly = Math.max(0, Math.min(fenHistory.length - 1, reviewPly + delta));
  if (newPly === reviewPly) return;
  reviewPly = newPly;
  renderReviewPly();
}

function renderReviewPly() {
  const fen = fenHistory[reviewPly];
  board.setPosition(fen, false);

  // Build move label
  let label;
  if (reviewPly === 0) {
    label = 'Start';
  } else {
    const moveNum = Math.ceil(reviewPly / 2);
    const whiteMoved = reviewPly % 2 === 1;
    label = whiteMoved ? `Move ${moveNum} (White)` : `Move ${moveNum} (Black)`;
  }
  document.getElementById('disc-review-ply').textContent = label;

  // Enable/disable nav buttons
  const total = fenHistory.length - 1;
  document.getElementById('btn-disc-review-start').disabled = reviewPly === 0;
  document.getElementById('btn-disc-review-prev' ).disabled = reviewPly === 0;
  document.getElementById('btn-disc-review-next' ).disabled = reviewPly === total;
  document.getElementById('btn-disc-review-end'  ).disabled = reviewPly === total;

  board.removeArrows();
  resetEvalDisplay();
  updateReviewEval(fen);
}

function resetEvalDisplay() {
  const scoreEl = document.getElementById('disc-review-score');
  scoreEl.textContent = '—';
  scoreEl.className = 'disc-review-score';
  document.getElementById('disc-review-thinking').classList.remove('hidden');
  document.getElementById('disc-review-best').textContent = 'Best: —';
}

async function updateReviewEval(fen) {
  if (!discEngine || !reviewActive) return;
  const myGen = ++reviewEvalGen;
  const depth = parseInt(document.getElementById('select-review-depth').value, 10) || 16;
  try {
    const { score, bestMove } = await discEngine.evaluate(fen, depth);

    // Bail if user navigated away or a newer eval was started
    if (!reviewActive || reviewEvalGen !== myGen) return;

    document.getElementById('disc-review-thinking').classList.add('hidden');

    const scoreEl = document.getElementById('disc-review-score');
    const bestEl  = document.getElementById('disc-review-best');

    scoreEl.textContent = formatScore(score, fen);

    if (score === null) {
      scoreEl.className = 'disc-review-score';
    } else {
      const fromWhite = fen.split(' ')[1] === 'w' ? score : -score;
      scoreEl.className = Math.abs(score) >= 99000 || fromWhite > 50
        ? 'disc-review-score disc-review-score-white'
        : fromWhite < -50
          ? 'disc-review-score disc-review-score-black'
          : 'disc-review-score disc-review-score-equal';
    }

    if (bestMove) {
      bestEl.textContent = `Best: ${uciToSan(fen, bestMove)}`;
      board.removeArrows();
      board.addArrow({ class: 'arrow-review-best' }, bestMove.slice(0, 2), bestMove.slice(2, 4));
    } else {
      bestEl.textContent = 'Best: —';
    }
  } catch { /* ignore */ }
}
