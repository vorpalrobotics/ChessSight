import { Chessboard, COLOR, INPUT_EVENT_TYPE } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { Engine } from './engine.js';

// --- State ---
const chess = new Chess();
const engine = new Engine();
let board = null;
let orientation = COLOR.white;
let playerColor = COLOR.white;   // which side the human plays
let pendingBestMove = null;

// --- DOM refs ---
const evalFill        = document.getElementById('eval-fill');
const evalLabel       = document.getElementById('eval-label');
const engineStatus    = document.getElementById('engine-status');
const bestMoveDisplay = document.getElementById('best-move-display');
const debugLog        = document.getElementById('debug-log');
const moveList        = document.getElementById('move-list');
const fenInput        = document.getElementById('fen-input');
const btnHint         = document.getElementById('btn-hint');
const btnStop         = document.getElementById('btn-stop');

// Show errors on-screen (no dev tools needed)
function dbg(msg) {
  console.log(msg);
  debugLog.textContent = msg;
}

// --- Board ---
function initBoard() {
  board = new Chessboard(document.getElementById('board'), {
    position: chess.fen(),
    orientation,
    style: {
      pieces: {
        file: 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg'
      }
    }
  });

  board.enableMoveInput(handleMoveInput, playerColor);
}

function handleMoveInput(event) {
  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    const piece = chess.get(event.square);
    // Only allow moving the side to move
    return piece && piece.color === chess.turn();
  }

  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    const move = chess.move({
      from: event.squareFrom,
      to: event.squareTo,
      promotion: 'q'
    });
    if (move) {
      pendingBestMove = null;
      bestMoveDisplay.textContent = '';
      board.setPosition(chess.fen(), true);
      renderMoveList();
      triggerEval();
      return true;
    }
    return false;
  }

  return true;
}

// --- Evaluation ---
async function triggerEval() {
  if (!engine.ready) return;

  engineStatus.textContent = 'Thinking...';
  btnStop.disabled = false;
  pendingBestMove = null;

  try {
    const { score, bestMove } = await engine.evaluate(chess.fen());
    pendingBestMove = bestMove;
    updateEvalBar(score);
    engineStatus.textContent = formatScore(score);

    // Play engine counter-move if it's the engine's turn
    const engineTurnChar = playerColor === COLOR.white ? 'b' : 'w';
    if (chess.turn() === engineTurnChar && bestMove && !chess.isGameOver()) {
      await playEngineMove(bestMove);
    }
  } catch {
    engineStatus.textContent = 'Engine error';
  } finally {
    btnStop.disabled = true;
  }
}

async function playEngineMove(move) {
  // Brief pause so the human can see their own move before engine responds
  await new Promise(r => setTimeout(r, 400));

  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  const promotion = move.length > 4 ? move[4] : 'q';

  const result = chess.move({ from, to, promotion });
  if (result) {
    board.setPosition(chess.fen(), true);
    renderMoveList();
    // Evaluate the position after engine's move (won't loop — now human's turn)
    triggerEval();
  }
}

function formatScore(score) {
  if (score === null) return 'Ready';
  if (Math.abs(score) >= 99999) return `Mate in ${Math.abs(score) === 99999 ? '?' : Math.abs(score)}`;
  return `${score >= 0 ? '+' : ''}${(score / 100).toFixed(2)}`;
}

function updateEvalBar(score) {
  if (score === null) return;
  // ±500 cp fills the bar; cap beyond that
  const clamped = Math.max(-500, Math.min(500, score));
  const pct = 50 + (clamped / 500) * 50;
  evalFill.style.height = `${pct}%`;

  const label = Math.abs(score) >= 99999
    ? 'M'
    : (Math.abs(score / 100)).toFixed(1);
  evalLabel.textContent = score >= 0 ? `+${label}` : `-${label}`;
}

// --- Move list ---
function renderMoveList() {
  const history = chess.history({ verbose: true });
  moveList.innerHTML = '';

  for (let i = 0; i < history.length; i += 2) {
    const pair = document.createElement('div');
    pair.className = 'move-pair';

    const num = document.createElement('span');
    num.className = 'move-number';
    num.textContent = `${Math.floor(i / 2) + 1}.`;
    pair.appendChild(num);

    for (let j = i; j <= i + 1 && j < history.length; j++) {
      const mv = document.createElement('span');
      mv.className = 'move' + (j === history.length - 1 ? ' current' : '');
      mv.textContent = history[j].san;
      pair.appendChild(mv);
    }

    moveList.appendChild(pair);
  }

  moveList.scrollTop = moveList.scrollHeight;
  fenInput.value = chess.fen();
}

// --- Controls ---
document.getElementById('btn-flip').addEventListener('click', () => {
  orientation = orientation === COLOR.white ? COLOR.black : COLOR.white;
  playerColor = playerColor === COLOR.white ? COLOR.black : COLOR.white;
  board.setOrientation(orientation, true);
  board.disableMoveInput();
  board.enableMoveInput(handleMoveInput, playerColor);
  // If it's now the engine's turn after switching sides, let it move
  const engineTurnChar = playerColor === COLOR.white ? 'b' : 'w';
  if (chess.turn() === engineTurnChar) {
    triggerEval();
  }
});

document.getElementById('btn-reset').addEventListener('click', () => {
  engine.stop();
  chess.reset();
  pendingBestMove = null;
  bestMoveDisplay.textContent = '';
  board.setPosition(chess.fen(), true);
  board.disableMoveInput();
  board.enableMoveInput(handleMoveInput, playerColor);
  renderMoveList();
  triggerEval();
});

btnHint.addEventListener('click', () => {
  if (pendingBestMove) {
    bestMoveDisplay.textContent = `Best: ${pendingBestMove}`;
  } else {
    bestMoveDisplay.textContent = 'Calculating...';
    triggerEval().then(() => {
      if (pendingBestMove) bestMoveDisplay.textContent = `Best: ${pendingBestMove}`;
    });
  }
});

btnStop.addEventListener('click', () => {
  engine.stop();
  btnStop.disabled = true;
  engineStatus.textContent = 'Stopped';
});

document.getElementById('btn-load-fen').addEventListener('click', loadFen);
fenInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadFen(); });

function loadFen() {
  const fen = fenInput.value.trim();
  if (!fen) return;
  try {
    chess.load(fen);
    board.setPosition(fen, true);
    pendingBestMove = null;
    bestMoveDisplay.textContent = '';
    renderMoveList();
    triggerEval();
  } catch {
    engineStatus.textContent = 'Invalid FEN';
  }
}

document.getElementById('btn-copy-fen').addEventListener('click', () => {
  const fen = chess.fen();
  navigator.clipboard.writeText(fen).catch(() => {
    fenInput.select();
    document.execCommand('copy');
  });
});

// --- Boot ---
async function main() {
  dbg('Initializing board...');
  try {
    initBoard();
    dbg('Board OK');
  } catch (err) {
    dbg(`Board error: ${err.message}`);
    return;
  }
  renderMoveList();

  engineStatus.textContent = 'Loading engine...';
  dbg('Fetching Stockfish...');
  try {
    await engine.init();
    engineStatus.textContent = 'Ready';
    dbg('Engine ready');
    triggerEval();
  } catch (err) {
    engineStatus.textContent = 'Engine unavailable';
    dbg(`Engine error: ${err.message}`);
  }
}

main();
