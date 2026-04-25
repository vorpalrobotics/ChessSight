import { getPersonalBest, setPersonalBest, getGoals } from './storage.js';

/**
 * Check if this session beats the stored personal best for a drill.
 * Score = accuracy × (positions / seconds) — higher is better.
 * Returns true if a new PB was set, false otherwise.
 *
 * @param {string} drill
 * @param {number} positions  number of puzzles completed
 * @param {number} correct    total correct answers
 * @param {number} misses     total wrong answers
 * @param {number} seconds    total elapsed seconds
 */
export async function checkAndUpdatePB(drill, positions, correct, misses, seconds) {
  if (positions <= 0 || seconds <= 0) return false;
  const total = correct + misses;
  const accuracy = total > 0 ? correct / total : 0;
  const score = accuracy * positions / seconds;
  if (score <= 0) return false;

  const existing = await getPersonalBest(drill);
  if (existing && existing.score >= score) return false;

  const date = new Date().toLocaleDateString('sv');
  await setPersonalBest(drill, { drill, score, positions, correct, misses, seconds, date });
  return true;
}

/**
 * Check whether this session met the stored accuracy/time goals for a drill.
 * Returns { accMet, timeMet }. Both are false if no goal has been set.
 */
export async function checkGoals(drill, positions, correct, misses, seconds) {
  const goals = await getGoals();
  const g = goals[drill];
  if (!g) return { accMet: false, timeMet: false };
  const total = correct + misses;
  const accuracy = total > 0 ? Math.round(correct / total * 100) : 0;
  const avgTime = positions > 0 ? seconds / positions : Infinity;
  return {
    accMet:  accuracy >= g.acc,
    timeMet: avgTime  <= g.time,
  };
}

function makeCelebrationOverlay(iconText, labelText, extraTextClass) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'pb-celebration';

    const inner = document.createElement('div');
    inner.className = 'pb-celebration-inner';

    if (iconText) {
      const icon = document.createElement('span');
      icon.className = 'pb-icon';
      icon.textContent = iconText;
      inner.appendChild(icon);
    }

    const text = document.createElement('span');
    text.className = `pb-text${extraTextClass ? ' ' + extraTextClass : ''}`;
    text.textContent = labelText;

    inner.appendChild(text);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.remove();
      resolve();
    }, 3000);
  });
}

/**
 * Show a goal-met celebration overlay.
 * Returns a Promise that resolves after the animation completes (~3 s).
 */
export function showGoalCelebration(accMet, timeMet) {
  const label = (accMet && timeMet) ? 'ALL GOALS MET!'
              : accMet              ? 'ACCURACY GOAL MET!'
              :                       'TIME GOAL MET!';
  return makeCelebrationOverlay('✓', label, 'goal-text');
}

/**
 * Show a full-screen PB celebration overlay.
 * Returns a Promise that resolves after the animation completes (~3 s).
 */
export function showPBCelebration() {
  return makeCelebrationOverlay('🏆', 'Personal Best!', null);
}
