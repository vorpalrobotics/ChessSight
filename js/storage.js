const DB_NAME = 'ChessSight';
const DB_VERSION = 2;
const STORE = 'drillDays';
const GAME_STORE = 'disciplineGames';

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
