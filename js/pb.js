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

/**
 * Populate (or clear) the goal annotations on the shared drill summary screen.
 * Call once per showSummary invocation before navigating.
 */
export async function updateSummaryGoals(drill, count) {
  const timeEl = document.getElementById('stat-time-goal');
  const accEl  = document.getElementById('stat-acc-goal');
  if (count <= 0) {
    timeEl.classList.add('hidden');
    accEl.classList.add('hidden');
    return;
  }
  const goals = await getGoals();
  const g = goals[drill];
  if (g) {
    timeEl.textContent = `(goal: ${g.time}s)`;
    accEl.textContent  = `(goal: ${g.acc}%)`;
    timeEl.classList.remove('hidden');
    accEl.classList.remove('hidden');
  } else {
    timeEl.classList.add('hidden');
    accEl.classList.add('hidden');
  }
}

function makeCelebrationOverlay(iconText, labelText, extraTextClass, subText) {
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

    if (subText) {
      const sub = document.createElement('span');
      sub.className = 'pb-subtext';
      sub.textContent = subText;
      inner.appendChild(sub);
    }

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
export function showGoalCelebration(accMet, timeMet, accuracy, avgTime) {
  const label = (accMet && timeMet) ? 'ALL GOALS MET!'
              : accMet              ? 'ACCURACY GOAL MET!'
              :                       'TIME GOAL MET!';
  const subText = (accMet && timeMet) ? `${accuracy}% Accuracy  ·  ${avgTime.toFixed(1)}s avg`
                : accMet              ? `${accuracy}% Accuracy`
                :                       `${avgTime.toFixed(1)}s avg`;
  return makeCelebrationOverlay('✓', label, 'goal-text', subText);
}

/**
 * Show a full-screen PB celebration overlay.
 * Returns a Promise that resolves after the animation completes (~3 s).
 */
export function showPBCelebration() {
  return makeCelebrationOverlay('🏆', 'Personal Best!', null);
}
