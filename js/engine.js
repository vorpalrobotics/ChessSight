// Stockfish 10 pure-JS wrapper
// Fetched via CDN and run in a blob Worker to avoid cross-origin restrictions.
const STOCKFISH_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
  'https://cdn.jsdelivr.net/npm/stockfish@10.0.2/stockfish.js',
];

export class Engine {
  constructor() {
    this._worker = null;
    this._listener = null;
    this.ready = false;
  }

  async init() {
    let blob = null;
    for (const url of STOCKFISH_URLS) {
      try {
        const res = await fetch(url);
        if (res.ok) { blob = await res.blob(); break; }
        console.warn(`Stockfish fetch failed (${res.status}): ${url}`);
      } catch (err) {
        console.warn(`Stockfish fetch error: ${url}`, err);
      }
    }
    if (!blob) throw new Error('Could not load Stockfish from any CDN source');
    const blobUrl = URL.createObjectURL(blob);

    this._worker = new Worker(blobUrl);
    this._worker.onmessage = ({ data }) => this._listener?.(data);

    // Handshake
    await this._command('uci', line => line === 'uciok');
    await this._command('isready', line => line === 'readyok');
    this.ready = true;
  }

  _send(cmd) {
    this._worker?.postMessage(cmd);
  }

  _command(cmd, isDone) {
    return new Promise(resolve => {
      this._listener = line => {
        if (isDone(line)) {
          this._listener = null;
          resolve(line);
        }
      };
      this._send(cmd);
    });
  }

  // Returns { score: centipawns (null if mate), bestMove: algebraic string }
  evaluate(fen, depth = 14) {
    let score = null;
    let bestMove = null;

    return new Promise(resolve => {
      this._listener = line => {
        if (line.startsWith('info')) {
          const cpMatch = line.match(/score cp (-?\d+)/);
          if (cpMatch) score = parseInt(cpMatch[1], 10);

          const mateMatch = line.match(/score mate (-?\d+)/);
          if (mateMatch) score = parseInt(mateMatch[1], 10) > 0 ? 99999 : -99999;

          const pvMatch = line.match(/ pv (\S+)/);
          if (pvMatch) bestMove = pvMatch[1];
        }

        if (line.startsWith('bestmove')) {
          const bmMatch = line.match(/bestmove (\S+)/);
          if (bmMatch && bmMatch[1] !== '(none)') bestMove = bmMatch[1];
          this._listener = null;
          resolve({ score, bestMove });
        }
      };

      this._send('stop');
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  stop() {
    this._send('stop');
    this._listener = null;
  }
}
