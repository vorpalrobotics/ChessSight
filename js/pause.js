// ─── Shared pause manager ────────────────────────────────────────────────────
// Each active drill registers pauseFn / resumeFn.
// app.js controls the button and overlay; drills just register callbacks.

let _pauseFn  = null;
let _resumeFn = null;
let _paused   = false;

export function registerPause(pauseFn, resumeFn) {
  _pauseFn  = pauseFn;
  _resumeFn = resumeFn;
}

export function clearPause() {
  if (_paused && _resumeFn) _resumeFn();   // auto-resume on navigate away
  _pauseFn = _resumeFn = null;
  _paused  = false;
}

export function isPaused() { return _paused; }

// Returns new paused state. app.js uses the return value to update the button.
export function togglePause() {
  _paused = !_paused;
  if (_paused) { if (_pauseFn)  _pauseFn();  }
  else         { if (_resumeFn) _resumeFn(); }
  return _paused;
}
