// ─── Vimsy Cloud Sync ─────────────────────────────────────────────────────────
// Integrates ChessSight with the Vimsy health tracking system via Firebase.
// Firebase compat SDK (v10) is loaded as global scripts in index.html.

import { getDrillSecondsForDate } from './storage.js';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyAf5eAoatlp9cf8Fn7eJJy7hISE25_3aGg',
  authDomain:        'studio-6393664499-ac49e.firebaseapp.com',
  projectId:         'studio-6393664499-ac49e',
  appId:             '1:1075087361735:web:f5538786ae0c389ebba0e2',
  messagingSenderId: '1075087361735',
};

const VIMSY_APP_ID   = 'chesssight';
const VIMSY_APP_NAME = 'ChessSight';
const USER_KEY       = 'vimsy-user';  // localStorage key for cached user info

let _fbApp = null;
let _auth  = null;
let _db    = null;
let _statusUnsubscribe = null;

// ─── Firebase init (lazy) ─────────────────────────────────────────────────────

function ensureFirebase() {
  if (_fbApp) return true;
  if (typeof firebase === 'undefined') {
    vimsyLog('Firebase SDK not loaded — check network', 'error');
    return false;
  }
  try {
    _fbApp = firebase.apps.length
      ? firebase.app()
      : firebase.initializeApp(FIREBASE_CONFIG);
    _auth = firebase.auth();
    _db   = firebase.firestore();
    vimsyLog('[Firebase] Initialised', 'info');
    return true;
  } catch (err) {
    vimsyLog(`[Firebase] Init error: ${err.message}`, 'error');
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initVimsy() {
  // Register auth listener as soon as Firebase is ready.
  // Defer until DOMContentLoaded in case modal elements aren't yet available.
  const setup = () => {
    if (!ensureFirebase()) return;
    _auth.onAuthStateChanged(user => {
      if (user) {
        localStorage.setItem(USER_KEY, JSON.stringify({
          uid: user.uid, email: user.email, displayName: user.displayName,
        }));
        vimsyLog(`[Auth] Signed in as ${user.email}`, 'info');
      } else {
        localStorage.removeItem(USER_KEY);
      }
      // Refresh modal if it's visible
      const modal = document.getElementById('modal-vimsy');
      if (modal && !modal.classList.contains('hidden')) renderVimsyModal();
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
}

export function getVimsyUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'); }
  catch { return null; }
}

export async function connectVimsy() {
  if (!ensureFirebase()) return;
  vimsyLog('[Auth] Opening Google sign-in…', 'info');
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result   = await _auth.signInWithPopup(provider);
    vimsyLog(`[Auth] Signed in as ${result.user.email}`, 'success');
  } catch (err) {
    vimsyLog(`[Auth] Sign-in failed: ${err.message}`, 'error');
  }
}

export async function disconnectVimsy() {
  if (!ensureFirebase()) return;
  try {
    await _auth.signOut();
    localStorage.removeItem(USER_KEY);
    vimsyLog('[Auth] Signed out and disconnected', 'info');
    renderVimsyModal();
  } catch (err) {
    vimsyLog(`[Auth] Sign-out error: ${err.message}`, 'error');
  }
}

export async function syncToday() {
  const user = getVimsyUser();
  if (!user) { vimsyLog('Not connected — please sign in first', 'error'); return; }
  if (!ensureFirebase()) return;

  const today = new Date().toLocaleDateString('sv');  // YYYY-MM-DD
  vimsyLog(`[Sync] Fetching training data for ${today}…`, 'info');

  let drillData;
  try {
    drillData = await getDrillSecondsForDate(today);
  } catch (err) {
    vimsyLog(`[Sync] Failed to read training data: ${err.message}`, 'error');
    return;
  }

  if (drillData.total < 30) {
    vimsyLog('[Sync] No training data recorded today (< 30 s)', 'info');
    return;
  }

  const totalMinutes = Math.round(drillData.total / 60 * 100) / 100;

  // Build drill breakdown for notes and customFields
  const DRILL_NAMES = {
    checks: 'Checks', captures: 'Captures', loose: 'Loose',
    under: 'Underguarded', queen: 'QueenAttack', knight: 'KnightRoute',
    'dlm-rook': 'SpiralRook', 'dlm-bishop': 'SpiralBishop',
    'dlm-knight': 'SpiralKnight', mix: 'Mix', memory: 'Memory',
    discipline: 'Discipline',
  };

  const parts = [];
  const customBreakdown = {};
  for (const [drill, secs] of Object.entries(drillData.byDrill)) {
    if (secs < 30) continue;
    const mins = Math.round(secs / 60 * 100) / 100;
    parts.push(`${DRILL_NAMES[drill] ?? drill}:${mins}m`);
    customBreakdown[drill] = mins;
  }

  const notes = parts.length
    ? `ChessSight--${parts.join(', ')}. `
    : 'ChessSight. ';

  const documentId = `${VIMSY_APP_ID}-${today}`;  // same ID each day → idempotent

  const importDoc = {
    metadata: {
      appId:      VIMSY_APP_ID,
      appName:    VIMSY_APP_NAME,
      version:    '1.0',
      timestamp:  new Date().toISOString(),
      userId:     user.uid,
      documentId,
    },
    data: {
      type:  'Mind',
      items: [{
        date:       today,
        activityId: 2,
        duration:   totalMinutes,
        notes,
        customFields: { totalSeconds: drillData.total, drillBreakdown: customBreakdown },
      }],
    },
    status:      'pending',
    processedAt: null,
    errors:      [],
  };

  vimsyLog(`[Upload] Uploading ${totalMinutes}m of training…`, 'info');
  const path = `users/${user.uid}/externalAppData/${VIMSY_APP_ID}/documents/${documentId}`;
  vimsyLog(`[Upload] Path: ${path}`, 'info');

  try {
    await _db.doc(path).set(importDoc);
    vimsyLog('[Upload] Document uploaded — waiting for Vimsy to process…', 'success');
  } catch (err) {
    vimsyLog(`[Upload] Upload failed: ${err.message}`, 'error');
    return;
  }

  // Monitor status with 30-second timeout
  if (_statusUnsubscribe) { _statusUnsubscribe(); _statusUnsubscribe = null; }

  const timeout = setTimeout(() => {
    vimsyLog('[Monitor] Timed out waiting for Vimsy (30 s)', 'error');
    if (_statusUnsubscribe) { _statusUnsubscribe(); _statusUnsubscribe = null; }
  }, 30000);

  _statusUnsubscribe = _db.doc(path).onSnapshot(snap => {
    if (!snap.exists) return;
    const doc = snap.data();
    if (doc.status === 'processed') {
      clearTimeout(timeout);
      _statusUnsubscribe(); _statusUnsubscribe = null;
      vimsyLog('[Monitor] Vimsy processed the import successfully!', 'success');
      _db.doc(path).delete().catch(() => {});  // clean up staging doc
    } else if (doc.status === 'error') {
      clearTimeout(timeout);
      _statusUnsubscribe(); _statusUnsubscribe = null;
      vimsyLog(`[Monitor] Vimsy import error: ${(doc.errors || []).join(', ')}`, 'error');
    }
  }, err => {
    vimsyLog(`[Monitor] Snapshot error: ${err.message}`, 'error');
  });
}

// ─── Modal rendering ──────────────────────────────────────────────────────────

export async function renderVimsyModal() {
  const user           = getVimsyUser();
  const connEl         = document.getElementById('vimsy-connected-section');
  const discEl         = document.getElementById('vimsy-disconnected-section');
  const emailEl        = document.getElementById('vimsy-user-email');
  const todayEl        = document.getElementById('vimsy-today-mins');

  if (user) {
    connEl.classList.remove('hidden');
    discEl.classList.add('hidden');
    emailEl.textContent = user.email;
    try {
      const today = new Date().toLocaleDateString('sv');
      const data  = await getDrillSecondsForDate(today);
      const mins  = Math.round(data.total / 60);
      todayEl.textContent = mins > 0 ? `${mins} min of training recorded today` : 'No training recorded yet today';
    } catch { todayEl.textContent = ''; }
  } else {
    connEl.classList.add('hidden');
    discEl.classList.remove('hidden');
  }
}

// ─── Activity log ─────────────────────────────────────────────────────────────

export function vimsyLog(message, type = 'info') {
  const log = document.getElementById('vimsy-activity-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = `vimsy-log-entry vimsy-log-${type}`;
  entry.innerHTML =
    `<span class="vimsy-log-time">${new Date().toLocaleTimeString()}</span> ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}
