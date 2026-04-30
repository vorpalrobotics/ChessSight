// ─── Walkthrough system ───────────────────────────────────────────────────────
// Usage: await runWalkthrough('checks', [ {text, target?, arrowAlign?}, ... ])
// Returns a Promise that resolves when the walkthrough finishes (or immediately
// with false if it has already been seen).

const PREFIX = 'chesssight-wt-';

export function runWalkthrough(drillKey, steps) {
  return new Promise(resolve => {
    if (false && localStorage.getItem(PREFIX + drillKey)) { resolve(false); return; } // DEBUG: always show
    showStep(drillKey, steps, 0, resolve);
  });
}

export function clearWalkthroughState(drillKey) {
  localStorage.removeItem(PREFIX + drillKey);
}

function dismiss() {
  // Restore target element
  const el = document.querySelector('[data-wt-active]');
  if (el) {
    el.style.boxShadow = el.dataset.wtOrigShadow;
    el.style.zIndex    = el.dataset.wtOrigZ;
    el.style.position  = el.dataset.wtOrigPos;
    el.removeAttribute('data-wt-active');
    el.removeAttribute('data-wt-orig-shadow');
    el.removeAttribute('data-wt-orig-z');
    el.removeAttribute('data-wt-orig-pos');
  }
  document.getElementById('wt-overlay')?.remove();
  document.getElementById('wt-bubble')?.remove();
}

function showStep(drillKey, steps, idx, resolve) {
  dismiss();

  if (idx >= steps.length) {
    // localStorage.setItem(PREFIX + drillKey, '1'); // DEBUG: don't save seen state
    resolve(true);
    return;
  }

  const { text, target, arrowAlign } = steps[idx];
  const targetEl = target ? document.querySelector(target) : null;

  // ── Overlay ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'wt-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:4999', 'pointer-events:auto',
    targetEl ? 'background:transparent' : 'background:rgba(0,0,0,0.72)',
  ].join(';');
  // Click on backdrop skips to next step
  overlay.addEventListener('click', () => showStep(drillKey, steps, idx + 1, resolve));
  document.body.appendChild(overlay);

  // ── Spotlight on target ───────────────────────────────────────────────────
  if (targetEl) {
    targetEl.dataset.wtActive      = '1';
    targetEl.dataset.wtOrigShadow  = targetEl.style.boxShadow  || '';
    targetEl.dataset.wtOrigZ       = targetEl.style.zIndex      || '';
    targetEl.dataset.wtOrigPos     = targetEl.style.position    || '';
    targetEl.style.position  = targetEl.style.position || 'relative';
    targetEl.style.zIndex    = '5000';
    targetEl.style.boxShadow = '0 0 0 9999px rgba(0,0,0,0.72), 0 0 0 3px rgba(255,255,255,0.25)';
  }

  // ── Bubble ────────────────────────────────────────────────────────────────
  const isLast = idx === steps.length - 1;
  const bubble = document.createElement('div');
  bubble.id = 'wt-bubble';
  bubble.style.position = 'fixed'; // set early so ::before/::after anchors work
  bubble.innerHTML = `
    <p class="wt-text">${text}</p>
    <div class="wt-footer">
      <span class="wt-step">${idx + 1} / ${steps.length}</span>
      <button class="wt-btn">${isLast ? 'Got it ✓' : 'Got it →'}</button>
    </div>`;
  document.body.appendChild(bubble);

  positionBubble(bubble, targetEl, arrowAlign);

  bubble.querySelector('.wt-btn').addEventListener('click', e => {
    e.stopPropagation();
    showStep(drillKey, steps, idx + 1, resolve);
  });
}

function positionBubble(bubble, targetEl, arrowAlign) {
  // Bubble is fixed-width, horizontally centred
  bubble.style.position  = 'fixed';
  bubble.style.zIndex    = '5001';
  bubble.style.left      = '50%';
  bubble.style.transform = 'translateX(-50%)';
  bubble.style.width     = 'min(300px, 88vw)';

  if (!targetEl) {
    bubble.style.top       = '50%';
    bubble.style.transform = 'translate(-50%, -50%)';
    bubble.removeAttribute('data-arrow');
    bubble.removeAttribute('data-arrow-align');
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  const vh   = window.innerHeight;

  bubble.dataset.arrowAlign = arrowAlign || '';

  if (rect.bottom < vh * 0.55) {
    // Target in upper half → bubble below, arrow points up
    bubble.style.top    = Math.min(rect.bottom + 18, vh - 160) + 'px';
    bubble.dataset.arrow = 'up';
  } else {
    // Target in lower half → bubble above, arrow points down
    bubble.style.bottom = (vh - rect.top + 18) + 'px';
    bubble.dataset.arrow = 'down';
  }
}
