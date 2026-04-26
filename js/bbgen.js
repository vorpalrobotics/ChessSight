import { Chessboard, COLOR } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Markers } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/markers/Markers.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { addBBPuzzle, getBBPuzzleCount } from './storage.js';

const PIECES_URL  = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg';
const MARKERS_URL = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/markers/markers.svg';
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const HANG_MARKER  = { class: 'marker-hang', slice: 'markerFrame' };
const PASS_RATIO   = 0.20;
const PIECE_NAMES  = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen' };

let board     = null;
let navigate  = null;
let puzzle    = null;
let busy      = false;

// ─── Public API ───────────────────────────────────────────────────────────────

export function initBBGen(navigateFn) {
  navigate = navigateFn;
  document.getElementById('btn-bbgen-approve').addEventListener('click', handleApprove);
  document.getElementById('btn-bbgen-reject').addEventListener('click', handleReject);
  document.getElementById('btn-bbgen-home').addEventListener('click', () => navigate('screen-select'));
}

export async function startBBGen() {
  puzzle = null;
  busy   = false;
  setControls(false);
  setStatus('');
  setInfo('');

  if (!board) {
    board = new Chessboard(document.getElementById('bbgen-board'), {
      position: '8/8/8/8/8/8/8/8 w - - 0 1',
      orientation: COLOR.white,
      style: { pieces: { file: PIECES_URL } },
      extensions: [{ class: Markers, props: { sprite: MARKERS_URL } }],
    });
  }

  await refreshCount();
  generateAndDisplay();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setControls(enabled) {
  document.getElementById('btn-bbgen-approve').disabled = !enabled;
  document.getElementById('btn-bbgen-reject').disabled  = !enabled;
}

function setStatus(text) {
  document.getElementById('bbgen-status').textContent = text;
}

function setInfo(text) {
  document.getElementById('bbgen-info').textContent = text;
}

async function refreshCount() {
  const n = await getBBPuzzleCount();
  document.getElementById('bbgen-count').textContent = `${n} saved`;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleApprove() {
  if (!puzzle || busy) return;
  setControls(false);
  await addBBPuzzle(puzzle);
  await refreshCount();
  setStatus('Saved ✓  Generating next…');
  setInfo('');
  setTimeout(() => generateAndDisplay(), 700);
}

function handleReject() {
  if (busy) return;
  setControls(false);
  setStatus('Generating next…');
  setInfo('');
  generateAndDisplay();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pick(arr)        { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(lo, hi)  { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function sqName(f, r)     { return String.fromCharCode(97 + f) + (r + 1); }

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
  // White king (inner squares to reduce edge-case checks)
  const wkF = randInt(1, 6), wkR = randInt(1, 6);
  occ[sqName(wkF, wkR)] = 'K';

  // Black king not adjacent to white king
  let placed = false;
  for (let i = 0; i < 100 && !placed; i++) {
    const f = randInt(0, 7), r = randInt(1, 6);
    if (Math.abs(f - wkF) <= 1 && Math.abs(r - wkR) <= 1) continue;
    const sq = sqName(f, r);
    if (!occ[sq]) { occ[sq] = 'k'; placed = true; }
  }
  if (!placed) return null;

  // White pieces (1-3)
  for (let i = 0, n = randInt(1, 3); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(0, 7));
      if (!occ[sq]) { occ[sq] = pick(['N', 'B', 'R', 'Q']); break; }
    }
  }

  // White pawns (1-3, ranks 2-6 — never on ranks 1 or 8)
  for (let i = 0, n = randInt(1, 3); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(1, 5));
      if (!occ[sq]) { occ[sq] = 'P'; break; }
    }
  }

  // Black pieces (2-4)
  for (let i = 0, n = randInt(2, 4); i < n; i++) {
    for (let j = 0; j < 30; j++) {
      const sq = sqName(randInt(0, 7), randInt(0, 7));
      if (!occ[sq]) { occ[sq] = pick(['n', 'b', 'r', 'q']); break; }
    }
  }

  // Black pawns (1-3, ranks 3-7 — never on ranks 1 or 8)
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
      if (p && p.type === 'k' && p.color === 'w') {
        return chess.attackers(sq, 'b').length > 0;
      }
    }
  }
  return false;
}

function hangingBlack(chess) {
  const result = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = sqName(f, r);
      const piece = chess.get(sq);
      if (!piece || piece.color !== 'b' || piece.type === 'k') continue;

      const wAtk = chess.attackers(sq, 'w');
      if (!wAtk.length) continue;

      const bDef = chess.attackers(sq, 'b');
      const val  = PIECE_VALUES[piece.type];

      if (!bDef.length) {
        result.push({ sq, type: piece.type, value: val });
      } else {
        const minAtk = Math.min(...wAtk.map(a => {
          const p = chess.get(a);
          return p ? PIECE_VALUES[p.type] : 100;
        }));
        if (minAtk < val) result.push({ sq, type: piece.type, value: val });
      }
    }
  }
  return result;
}

// ─── Puzzle generation ────────────────────────────────────────────────────────

function generatePuzzle() {
  const wantPass = Math.random() < PASS_RATIO;

  for (let attempt = 0; attempt < 400; attempt++) {
    const occ = randomOccupied();
    if (!occ) continue;

    if (wantPass) {
      // PASS: black makes a move that leaves nothing hanging — same animation, no markers
      const fenBefore = buildFen(occ, 'b');
      let chess;
      try { chess = new Chess(fenBefore); } catch { continue; }
      if (chess.isCheck()) continue;
      if (whiteInCheck(chess)) continue;

      const priorHang = new Set(hangingBlack(chess).map(h => h.sq));
      const moves = chess.moves({ verbose: true });
      if (!moves.length) continue;

      const passMoves = [];
      for (const mv of moves) {
        chess.move(mv);
        if (hangingBlack(chess).length === 0) {
          passMoves.push({ mv, fenAfter: chess.fen() });
        }
        chess.undo();
      }

      if (!passMoves.length) continue;

      const chosen = pick(passMoves);
      return {
        fenBefore,
        fenAfter:    chosen.fenAfter,
        blunderMove: { from: chosen.mv.from, to: chosen.mv.to, san: chosen.mv.san },
        hangingSquares: [], hangingPieces: [],
        isPass: true, date: new Date().toLocaleDateString('sv'),
      };
    }

    // Blunder: black to move → find a move that creates exactly one new hanging black piece
    const fenBefore = buildFen(occ, 'b');
    let chess;
    try { chess = new Chess(fenBefore); } catch { continue; }
    if (chess.isCheck()) continue;      // black must not be in check before moving
    if (whiteInCheck(chess)) continue;  // white must not be in check (illegal position)

    const priorHang = new Set(hangingBlack(chess).map(h => h.sq));
    const moves = chess.moves({ verbose: true });
    if (!moves.length) continue;

    const blunders = [];
    for (const mv of moves) {
      chess.move(mv);
      const newHangs = hangingBlack(chess).filter(h => !priorHang.has(h.sq));
      if (newHangs.length === 1) {   // exactly one new hang keeps puzzles clean
        blunders.push({ mv, fenAfter: chess.fen(), newHangs });
      }
      chess.undo();
    }

    if (!blunders.length) continue;

    const chosen = pick(blunders);
    return {
      fenBefore,
      fenAfter:       chosen.fenAfter,
      blunderMove:    { from: chosen.mv.from, to: chosen.mv.to, san: chosen.mv.san },
      hangingSquares: chosen.newHangs.map(h => h.sq),
      hangingPieces:  chosen.newHangs,
      isPass:         false,
      date:           new Date().toLocaleDateString('sv'),
    };
  }

  return null;
}

// ─── Display ──────────────────────────────────────────────────────────────────

async function generateAndDisplay() {
  if (busy) return;
  busy   = true;
  puzzle = null;
  board.removeMarkers(HANG_MARKER);
  setStatus('Generating…');
  setInfo('');

  // Yield to UI, then run the CPU-heavy loop
  const result = await new Promise(resolve =>
    setTimeout(() => resolve(generatePuzzle()), 10)
  );

  if (!result) {
    setStatus('Generation failed — click REJECT to retry');
    document.getElementById('btn-bbgen-reject').disabled = false;
    busy = false;
    return;
  }

  puzzle = result;

  // Show "before" state, animate the move — same flow for both blunder and PASS
  board.setPosition(puzzle.fenBefore, false);
  setStatus("Before black's move…");

  await new Promise(r => setTimeout(r, randInt(1000, 2500)));

  setStatus(`Black plays ${puzzle.blunderMove.san}`);
  await board.setPosition(puzzle.fenAfter, true);

  await new Promise(r => setTimeout(r, 500));

  if (puzzle.isPass) {
    setStatus('PASS — nothing to grab');
    setInfo(`Black played ${puzzle.blunderMove.san}`);
  } else {
    for (const sq of puzzle.hangingSquares) {
      board.addMarker(HANG_MARKER, sq);
    }
    const desc = puzzle.hangingPieces
      .map(h => `${PIECE_NAMES[h.type]} on ${h.sq}`)
      .join(', ');
    setStatus(`Hanging: ${desc}`);
    setInfo(`Blunder: ${puzzle.blunderMove.san}`);
  }

  busy = false;
  setControls(true);
}
