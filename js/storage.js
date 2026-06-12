const DB_NAME = 'ChessSight';
const DB_VERSION = 6;
const STORE = 'drillDays';
const GAME_STORE = 'disciplineGames';
const GOALS_STORE = 'goals';
const PB_STORE = 'personalBests';
const BB_STORE = 'bbPuzzles';
const FALLBACK_FEN_STORE = 'fallbackFens';
const FALLBACK_FEN_CAP = 100;

// Lazy singleton DB connection
let _dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      // v1: drill-day accumulation store
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['date', 'drill'] });
        store.createIndex('date', 'date');
        store.createIndex('drill', 'drill');
      }
      // v2: per-game discipline records
      if (!db.objectStoreNames.contains(GAME_STORE)) {
        db.createObjectStore(GAME_STORE, { keyPath: 'id', autoIncrement: true });
      }
      // v3: per-drill training goals
      if (!db.objectStoreNames.contains(GOALS_STORE)) {
        db.createObjectStore(GOALS_STORE, { keyPath: 'drill' });
      }
      // v4: per-drill personal bests
      if (!db.objectStoreNames.contains(PB_STORE)) {
        db.createObjectStore(PB_STORE, { keyPath: 'drill' });
      }
      // v5: blunder buster generated puzzles
      if (!db.objectStoreNames.contains(BB_STORE)) {
        db.createObjectStore(BB_STORE, { keyPath: 'id', autoIncrement: true });
      }
      // v6: shared pool of fallback FENs harvested from successful lichess fetches
      if (!db.objectStoreNames.contains(FALLBACK_FEN_STORE)) {
        const store = db.createObjectStore(FALLBACK_FEN_STORE, { keyPath: 'fen' });
        store.createIndex('ts', 'ts');
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function getDB() {
  if (!_dbPromise) _dbPromise = openDB();
  return _dbPromise;
}

// Returns today's date as "YYYY-MM-DD" in the user's local timezone.
function localToday() {
  return new Date().toLocaleDateString('sv'); // 'sv' locale gives YYYY-MM-DD
}

/**
 * Upsert one puzzle's worth of results into today's record for a drill.
 * Call once per completed puzzle.
 *
 * @param {string} drill   e.g. 'captures'
 * @param {{ seconds: number, correct: number, misses: number, puzzleId: string }} result
 */
export async function upsertDrillDay(drill, { seconds, correct, misses, puzzleId }) {
  const db = await getDB();
  const date = localToday();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    const getReq = store.get([date, drill]);
    getReq.onsuccess = () => {
      const rec = getReq.result ?? {
        date,
        drill,
        positions: 0,
        totalSeconds: 0,
        totalMisses: 0,
        totalCorrect: 0,
        puzzleIds: '',
      };

      rec.positions    += 1;
      rec.totalSeconds += seconds;
      rec.totalMisses  += misses;
      rec.totalCorrect += correct;

      if (puzzleId) {
        rec.puzzleIds = rec.puzzleIds ? `${rec.puzzleIds},${puzzleId}` : puzzleId;
      }

      store.put(rec);
    };

    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Save one complete discipline game record.
 * Each game gets its own row (auto-increment id).
 */
export async function addDisciplineGame(data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_STORE, 'readwrite');
    tx.objectStore(GAME_STORE).add(data);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Return every discipline game record, newest first.
 */
export async function getDisciplineGames() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_STORE, 'readonly');
    const req = tx.objectStore(GAME_STORE).getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Return all data from both stores for export.
 */
export async function exportAllData() {
  const [drillDays, disciplineGames] = await Promise.all([getAllRecords(), getDisciplineGames()]);
  return { drillDays, disciplineGames };
}

/**
 * Import data previously exported by exportAllData.
 * drillDays: upsert by [date, drill] key (imported wins on conflict).
 * disciplineGames: strip id and add as new records.
 */
export async function importAllData({ drillDays = [], disciplineGames = [] }) {
  const db = await getDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    drillDays.forEach(rec => store.put(rec));
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(GAME_STORE, 'readwrite');
    const store = tx.objectStore(GAME_STORE);
    disciplineGames.forEach(({ id, ...rest }) => store.add(rest));
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Return total seconds trained on a given date, broken down by drill.
 * @param {string} dateStr  "YYYY-MM-DD"
 * @returns {{ total: number, byDrill: Object<string, number> }}
 */
export async function getDrillSecondsForDate(dateStr) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('date').getAll(dateStr);
    req.onsuccess = () => {
      const byDrill = {};
      let total = 0;
      for (const rec of req.result) {
        byDrill[rec.drill] = (byDrill[rec.drill] || 0) + rec.totalSeconds;
        total += rec.totalSeconds;
      }
      resolve({ total, byDrill });
    };
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Return all goal records as a map: { [drill]: { drill, acc, time } }.
 * Missing drills are absent from the map (callers should apply defaults).
 */
export async function getGoals() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(GOALS_STORE, 'readonly');
    const req = tx.objectStore(GOALS_STORE).getAll();
    req.onsuccess = () => {
      const map = {};
      for (const rec of req.result) map[rec.drill] = rec;
      resolve(map);
    };
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Upsert a goal for one drill.
 * @param {string} drill  e.g. 'captures'
 * @param {number} acc    minimum accuracy % (0-100)
 * @param {number} time   maximum seconds per puzzle
 */
export async function setGoal(drill, acc, time) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GOALS_STORE, 'readwrite');
    tx.objectStore(GOALS_STORE).put({ drill, acc, time });
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Return the personal best record for a drill, or undefined if none exists.
 */
export async function getPersonalBest(drill) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(PB_STORE, 'readonly');
    const req = tx.objectStore(PB_STORE).get(drill);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Upsert (overwrite) the personal best for a drill.
 * @param {string} drill
 * @param {{ drill, score, positions, correct, misses, seconds, date }} data
 */
export async function setPersonalBest(drill, data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PB_STORE, 'readwrite');
    tx.objectStore(PB_STORE).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Return all personal best records as a map: { [drill]: record }.
 */
export async function getAllPersonalBests() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(PB_STORE, 'readonly');
    const req = tx.objectStore(PB_STORE).getAll();
    req.onsuccess = () => {
      const map = {};
      for (const rec of req.result) map[rec.drill] = rec;
      resolve(map);
    };
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Save one approved BB puzzle record.
 * id is auto-incremented by IDB.
 */
export async function addBBPuzzle(data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BB_STORE, 'readwrite');
    tx.objectStore(BB_STORE).add(data);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Return the total number of BB puzzle records saved.
 */
export async function getBBPuzzleCount() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(BB_STORE, 'readonly');
    const req = tx.objectStore(BB_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Add a FEN to the shared fallback pool if not already present.
 * Caps the pool at FALLBACK_FEN_CAP entries, evicting the oldest when full.
 * Intended to be called fire-and-forget after a successful lichess fetch.
 */
export async function addFallbackFen(fen) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FALLBACK_FEN_STORE, 'readwrite');
    const store = tx.objectStore(FALLBACK_FEN_STORE);

    const getReq = store.get(fen);
    getReq.onsuccess = () => {
      if (getReq.result) return; // already in the pool

      store.put({ fen, ts: Date.now() });

      const countReq = store.count();
      countReq.onsuccess = () => {
        if (countReq.result > FALLBACK_FEN_CAP) {
          const cursorReq = store.index('ts').openCursor();
          cursorReq.onsuccess = e => {
            const cursor = e.target.result;
            if (cursor) store.delete(cursor.primaryKey);
          };
        }
      };
    };

    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Return all FENs in the shared fallback pool.
 */
export async function getAllFallbackFens() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(FALLBACK_FEN_STORE, 'readonly');
    const req = tx.objectStore(FALLBACK_FEN_STORE).getAll();
    req.onsuccess = () => resolve(req.result.map(r => r.fen));
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Return every record in the store, sorted newest-date first.
 */
export async function getAllRecords() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(req.result.sort((a, b) => b.date.localeCompare(a.date) || a.drill.localeCompare(b.drill)));
    req.onerror = e => reject(e.target.error);
  });
}
