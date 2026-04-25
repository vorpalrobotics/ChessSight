import { Chessboard, COLOR, INPUT_EVENT_TYPE } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';
import { Markers } from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/extensions/markers/Markers.js';
import { Chess } from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';
import { Engine } from './engine.js';
import { initChecks, startChecks } from './checks.js';
import { initCaptures, startCaptures } from './captures.js';
import { initLoose, startLoose } from './loose.js';
import { initUnder, startUnder } from './under.js';
// import { initThreats, startThreats } from './threats.js';  // disabled — drill needs rethink
import { initQueenAttack, startQueenAttack } from './queen.js';
import { initKnightRoute, startKnightRoute } from './knight.js';
import { initDeLaMaza, startDeLaMaza } from './delamaza.js';
import { initDiscipline, startDiscipline } from './discipline.js';
import { initHangGrab, startHangGrab } from './hanggrab.js';
import { initMix, startMix } from './mix.js';
import { initMemory, startMemory } from './memory.js';
import { getAllRecords, getDisciplineGames, exportAllData, importAllData, getGoals, setGoal, getAllPersonalBests } from './storage.js';
import { togglePause, clearPause } from './pause.js';
import { initVimsy, connectVimsy, disconnectVimsy, syncToday, renderVimsyModal } from './vimsy.js';

// --- Screen management ---
const SCREEN_IDS = ['screen-select', 'screen-checks', 'screen-captures', 'screen-loose', 'screen-under', 'screen-queen', 'screen-knight', 'screen-hanggrab', 'screen-mix', 'screen-dlm', 'screen-discipline', 'screen-memory', 'screen-summary', 'screen-engine'];

const pauseOverlay = document.getElementById('pause-overlay');

function doPauseToggle() {
  const paused = togglePause();
  document.querySelectorAll('.drill-pause-btn').forEach(b => b.textContent = paused ? '▶' : '⏸');
  pauseOverlay.classList.toggle('hidden', !paused);
}

function launchChessConfetti() {
  const pieces  = ['♟','♞','♝','♜','♛','♔','♙','♘','♗','♖','♕','♚'];
  const colors  = ['#f87171','#fb923c','#fbbf24','#4ade80','#60a5fa','#a78bfa','#f472b6','#22d3ee'];
  const container = document.createElement('div');
  container.id = 'confetti-container';
  document.body.appendChild(container);
  for (let i = 0; i < 48; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-piece';
    el.textContent = pieces[Math.floor(Math.random() * pieces.length)];
    el.style.color = colors[Math.floor(Math.random() * colors.length)];
    const angle    = Math.random() * Math.PI * 2;
    const distance = 100 + Math.random() * 320;
    el.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    el.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    el.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    el.style.animationDuration  = `${0.8 + Math.random() * 0.7}s`;
    el.style.animationDelay     = `${Math.random() * 0.3}s`;
    container.appendChild(el);
  }
  setTimeout(() => container.remove(), 2500);
}

function showScreen(id) {
  SCREEN_IDS.forEach(s =>
    document.getElementById(s).classList.toggle('hidden', s !== id)
  );
  const isSelect = id === 'screen-select';
  document.getElementById('btn-menu').classList.toggle('hidden', isSelect);
  if (isSelect) {
    clearPause();
    pauseOverlay.classList.add('hidden');
    document.querySelectorAll('.drill-pause-btn').forEach(b => b.textContent = '⏸');
  }
  if (id === 'screen-summary') {
    const count = parseInt(document.getElementById('stat-count').textContent, 10);
    if (count >= 5 && document.getElementById('stat-accuracy').textContent === '100%') {
      launchChessConfetti();
    }
  }
}

// Event delegation: any .drill-pause-btn click triggers pause toggle
document.addEventListener('click', e => {
  if (e.target.matches('.drill-pause-btn')) doPauseToggle();
});

// Tapping the overlay itself also resumes
pauseOverlay.addEventListener('click', doPauseToggle);

document.getElementById('mode-checks').addEventListener('click', async () => {
  showScreen('screen-checks');
  await startChecks();
});

document.getElementById('mode-captures').addEventListener('click', async () => {
  showScreen('screen-captures');
  await startCaptures();
});

document.getElementById('mode-loose').addEventListener('click', async () => {
  showScreen('screen-loose');
  await startLoose();
});

document.getElementById('mode-under').addEventListener('click', async () => {
  showScreen('screen-under');
  await startUnder();
});

// document.getElementById('mode-threats') — disabled

document.getElementById('mode-queen').addEventListener('click', () => {
  showScreen('screen-queen');
  startQueenAttack();
});

document.getElementById('mode-knight').addEventListener('click', () => {
  showScreen('screen-knight');
  startKnightRoute();
});

document.getElementById('mode-hanggrab').addEventListener('click', () => {
  showScreen('screen-hanggrab');
  startHangGrab();
});

document.getElementById('mode-mix').addEventListener('click', () => {
  showScreen('screen-mix');
  startMix();
});

document.getElementById('mode-dlm').addEventListener('click', () => {
  showScreen('screen-dlm');
  startDeLaMaza();
});

document.getElementById('mode-discipline').addEventListener('click', () => {
  showScreen('screen-discipline');
  startDiscipline();
});

document.getElementById('mode-memory').addEventListener('click', () => {
  showScreen('screen-memory');
  startMemory();
});

document.getElementById('btn-menu').addEventListener('click', () => {
  showScreen('screen-select');
});

document.getElementById('btn-home').addEventListener('click', () => {
  showScreen('screen-select');
});

document.getElementById('btn-summary-menu').addEventListener('click', () => {
  showScreen('screen-select');
});

// --- Hamburger menu ---
const hamburgerDropdown = document.getElementById('hamburger-dropdown');

document.getElementById('btn-hamburger').addEventListener('click', (e) => {
  e.stopPropagation();
  hamburgerDropdown.classList.toggle('hidden');
});

// Close dropdown when clicking outside the hamburger menu
document.addEventListener('click', (e) => {
  if (!e.target.closest('.hamburger-menu')) {
    hamburgerDropdown.classList.add('hidden');
  }
});

// --- Settings modal ---
const modalSettings = document.getElementById('modal-settings');

document.getElementById('btn-settings').addEventListener('click', () => {
  hamburgerDropdown.classList.add('hidden');
  modalSettings.classList.remove('hidden');
});

document.getElementById('btn-settings-close').addEventListener('click', () => {
  modalSettings.classList.add('hidden');
});

modalSettings.addEventListener('click', (e) => {
  if (e.target === modalSettings) modalSettings.classList.add('hidden');
});

// Persist "positions per drill" to localStorage
const selectPositions = document.getElementById('select-positions-per-drill');
const POSITIONS_KEY = 'chesssight-positions-per-drill';
const savedPositions = localStorage.getItem(POSITIONS_KEY);
if (savedPositions) selectPositions.value = savedPositions;
selectPositions.addEventListener('change', () => {
  localStorage.setItem(POSITIONS_KEY, selectPositions.value);
});

// --- About modal ---
const modalAbout = document.getElementById('modal-about');

document.getElementById('btn-about').addEventListener('click', () => {
  hamburgerDropdown.classList.add('hidden');
  modalAbout.classList.remove('hidden');
});

document.getElementById('btn-modal-close').addEventListener('click', () => {
  modalAbout.classList.add('hidden');
});

modalAbout.addEventListener('click', (e) => {
  if (e.target === modalAbout) modalAbout.classList.add('hidden');
});

// --- History modal (charts) ---
const DRILL_LABELS = { checks: 'Checks', captures: 'Captures', loose: 'Loose Pieces', under: 'Underguarded', queen: 'Queen Attack', knight: 'Knight Route', hanggrab: 'Hang Grab', 'dlm-rook': 'Spiral: Rook', 'dlm-bishop': 'Spiral: Bishop', 'dlm-knight': 'Spiral: Knight' };

const DRILL_COLORS = {
  checks:       '#e94560',
  captures:     '#3a9fd0',
  loose:        '#f0a030',
  under:        '#8bc34a',
  // threats:   '#ff6b35',  // disabled
  queen:        '#c080ff',
  knight:       '#4ecdc4',
  hanggrab:     '#26de81',
  'dlm-rook':   '#ff6688',
  'dlm-bishop': '#ffaa44',
  'dlm-knight': '#44ccff',
};

const GOAL_DRILLS      = ['checks','captures','loose','under','queen','knight','hanggrab','dlm-rook','dlm-bishop','dlm-knight'];
const GOAL_LABELS_FULL = ['Checks','Captures','Loose','Underguarded','Queen Attack','Knight Route','Hang Grab','Spiral: Rook','Spiral: Bishop','Spiral: Knight'];
const GOAL_LABELS_RADAR = ['Checks','Captures','Loose','Underguarded','Queen Atk','Knight','Hang Grab','Sp:Rook','Sp:Bishop','Sp:Knight'];
const DEFAULT_GOAL     = { acc: 95, time: 10 };

let chartTime = null, chartAcc = null, chartRadarAcc = null, chartRadarTime = null;
let activeRange = 'all';
let radarTooltipCleanups = [];

function filterByRange(records, range) {
  if (range === 'all') return records;
  const days = parseInt(range, 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toLocaleDateString('sv');
  return records.filter(r => r.date >= cutoffStr);
}

// --- Cloud Sync / Vimsy modal ---
const modalVimsy = document.getElementById('modal-vimsy');

document.getElementById('btn-cloud-sync').addEventListener('click', async () => {
  hamburgerDropdown.classList.add('hidden');
  await renderVimsyModal();
  modalVimsy.classList.remove('hidden');
});

document.getElementById('btn-vimsy-close').addEventListener('click', () => {
  modalVimsy.classList.add('hidden');
});

modalVimsy.addEventListener('click', (e) => {
  if (e.target === modalVimsy) modalVimsy.classList.add('hidden');
});

document.getElementById('btn-vimsy-connect').addEventListener('click', connectVimsy);
document.getElementById('btn-vimsy-disconnect').addEventListener('click', disconnectVimsy);
document.getElementById('btn-vimsy-sync').addEventListener('click', syncToday);
document.getElementById('btn-vimsy-clear-log').addEventListener('click', () => {
  document.getElementById('vimsy-activity-log').innerHTML = '';
});

// --- History modal (charts) ---
const modalHistory = document.getElementById('modal-history');

function openHistoryModal() { modalHistory.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeHistoryModal() { modalHistory.classList.add('hidden'); document.body.style.overflow = ''; }

document.getElementById('btn-history').addEventListener('click', async () => {
  hamburgerDropdown.classList.add('hidden');
  const hdr = document.querySelector('header');
  if (hdr) document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px');
  await renderCharts();
  openHistoryModal();
});

document.getElementById('btn-history-modal-close').addEventListener('click', closeHistoryModal);

modalHistory.addEventListener('click', (e) => {
  if (e.target === modalHistory) closeHistoryModal();
});

// Range buttons
document.querySelectorAll('.chart-range-buttons .range-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.chart-range-buttons .range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeRange = btn.dataset.range;
    await renderCharts();
  });
});

// Tab switching
const HISTORY_TABS = ['graph', 'radar', 'goals'];
async function switchTab(activeId) {
  HISTORY_TABS.forEach(t => {
    document.getElementById(`chart-tab-${t}`).classList.toggle('hidden', t !== activeId);
    document.getElementById(`btn-tab-${t}`).classList.toggle('active', t === activeId);
  });
  if (activeId === 'goals')  { await renderGoals(); }
  if (activeId === 'radar')  { await renderCharts(); }
}
HISTORY_TABS.forEach(t =>
  document.getElementById(`btn-tab-${t}`).addEventListener('click', () => switchTab(t))
);

async function renderGoals() {
  const [goals, pbs] = await Promise.all([getGoals(), getAllPersonalBests()]);
  const tbody = document.getElementById('goals-table-body');
  tbody.innerHTML = GOAL_DRILLS.map((drill, i) => {
    const g  = goals[drill] || DEFAULT_GOAL;
    const pb = pbs[drill];
    let pbAcc = '—', pbTime = '—', pbDate = '—';
    if (pb) {
      const total = pb.correct + pb.misses;
      pbAcc  = total > 0 ? `${Math.round(pb.correct / total * 100)}%` : '—';
      pbTime = pb.positions > 0 ? `${(pb.seconds / pb.positions).toFixed(1)}s` : '—';
      pbDate = pb.date;
    }
    return `<tr>
      <td class="goals-drill-name">${GOAL_LABELS_FULL[i]}</td>
      <td class="goals-pb-val">${pbAcc}</td>
      <td class="goals-pb-val">${pbTime}</td>
      <td class="goals-pb-date">${pbDate}</td>
      <td><input class="goals-input" type="number" min="0" max="100" step="1"
          data-drill="${drill}" data-field="acc" value="${g.acc}"></td>
      <td><input class="goals-input" type="number" min="0" step="1"
          data-drill="${drill}" data-field="time" value="${g.time}"></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.goals-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const drill = inp.dataset.drill;
      const field = inp.dataset.field;
      const saved = (await getGoals())[drill] || { ...DEFAULT_GOAL };
      saved[field] = Math.max(0, Number(inp.value));
      inp.value = saved[field];
      await setGoal(drill, saved.acc, saved.time);
    });
  });
}

function attachRadarTooltip(chart, dataArr, goals, formatFn, goalField, goalSuffix) {
  const canvas = chart.canvas;
  const tip = document.createElement('div');
  tip.className = 'radar-label-tip hidden';
  document.body.appendChild(tip);

  const ac = new AbortController();
  const { signal } = ac;

  function tryShow(clientX, clientY) {
    const items = chart.scales.r?._pointLabelItems;
    if (!items?.length) { tip.classList.add('hidden'); return; }

    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;

    let best = -1, bestDist = 44;
    items.forEach((item, i) => {
      const cx = (item.left + item.right) / 2;
      const cy = (item.top + item.bottom) / 2;
      if (Math.hypot(cx - mx, cy - my) < bestDist) {
        bestDist = Math.hypot(cx - mx, cy - my);
        best = i;
      }
    });

    if (best < 0) { tip.classList.add('hidden'); return; }

    const drill = GOAL_DRILLS[best];
    const g = goals[drill] || DEFAULT_GOAL;
    const val = dataArr[best];
    tip.innerHTML =
      `<span class="rtip-name">${GOAL_LABELS_FULL[best]}</span>` +
      `<span class="rtip-val">${val > 0 ? formatFn(val) : '–'}</span>` +
      `<span class="rtip-goal">goal: ${g[goalField]}${goalSuffix}</span>`;
    tip.style.left = (Math.min(clientX + 14, window.innerWidth - 170)) + 'px';
    tip.style.top  = (clientY - 10) + 'px';
    tip.classList.remove('hidden');
  }

  canvas.addEventListener('mousemove', e => tryShow(e.clientX, e.clientY), { signal });
  canvas.addEventListener('mouseleave', () => tip.classList.add('hidden'), { signal });
  canvas.addEventListener('click', e => tryShow(e.clientX, e.clientY), { signal });
  canvas.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    tryShow(t.clientX, t.clientY);
    setTimeout(() => tip.classList.add('hidden'), 3000);
  }, { signal, passive: true });

  radarTooltipCleanups.push(() => { ac.abort(); tip.remove(); });
}

async function renderCharts() {
  radarTooltipCleanups.forEach(fn => fn());
  radarTooltipCleanups = [];
  if (chartTime)      { chartTime.destroy();      chartTime      = null; }
  if (chartAcc)       { chartAcc.destroy();       chartAcc       = null; }
  if (chartRadarAcc)  { chartRadarAcc.destroy();  chartRadarAcc  = null; }
  if (chartRadarTime) { chartRadarTime.destroy(); chartRadarTime = null; }

  const noData = document.getElementById('chart-no-data');
  const wrap   = document.getElementById('chart-wrap');

  let records;
  const goals = await getGoals();
  try { records = await getAllRecords(); }
  catch (err) {
    noData.textContent = `Error reading data: ${err.message}`;
    noData.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }

  records = filterByRange(records, activeRange);

  if (records.length === 0) {
    noData.classList.remove('hidden');
    wrap.classList.add('hidden');
    return;
  }
  noData.classList.add('hidden');
  wrap.classList.remove('hidden');

  // Collect unique dates sorted ascending
  const dates = [...new Set(records.map(r => r.date))].sort();
  const dateLabels = dates.map(d => { const [, m, day] = d.split('-'); return `${m}/${day}`; });

  const drills = ['checks', 'captures', 'loose', 'under', 'queen', 'knight', 'hanggrab', 'dlm-rook', 'dlm-bishop', 'dlm-knight'];

  function makeDatasets(valueFn) {
    return drills.map(drill => ({
      label: DRILL_LABELS[drill],
      data: dates.map(date => {
        const r = records.find(r => r.date === date && r.drill === drill);
        return r ? valueFn(r) : null;
      }),
      borderColor: DRILL_COLORS[drill],
      backgroundColor: DRILL_COLORS[drill] + '22',
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 4,
      pointHoverRadius: 6,
      spanGaps: true,
      fill: false,
    }));
  }

  const timeDatasets = makeDatasets(r => r.positions > 0 ? Math.round(r.totalSeconds / r.positions) : null);
  const accDatasets  = makeDatasets(r => {
    const tot = r.totalCorrect + r.totalMisses;
    return tot > 0 ? Math.round(r.totalCorrect / tot * 100) : null;
  });

  // Build shared legend HTML
  const legend = document.getElementById('chart-legend');
  legend.innerHTML = drills.map((d, i) =>
    `<span class="legend-item" data-idx="${i}">
       <span class="legend-dot" style="background:${DRILL_COLORS[d]}"></span>
       <span class="legend-label">${DRILL_LABELS[d]}</span>
     </span>`
  ).join('');

  const gridColor = 'rgba(255,255,255,0.07)';
  const tickColor = '#888';

  function commonOpts(unitLabel, yOpts, tickCb) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: ctx => ctx.raw !== null ? `${ctx.dataset.label}: ${tickCb(ctx.raw)}` : null },
        },
      },
      scales: {
        x: { ticks: { color: tickColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
        y: {
          ...yOpts,
          ticks: { color: tickColor, callback: tickCb },
          grid: { color: gridColor },
          title: { display: true, text: unitLabel, color: tickColor, font: { size: 11 } },
        },
      },
    };
  }

  chartTime = new Chart(document.getElementById('chart-time'), {
    type: 'line',
    data: { labels: dateLabels, datasets: timeDatasets },
    options: commonOpts('seconds', { min: 0 }, v => `${v}s`),
  });

  chartAcc = new Chart(document.getElementById('chart-acc'), {
    type: 'line',
    data: { labels: dateLabels, datasets: accDatasets },
    options: commonOpts('accuracy', {
      suggestedMax: 102,
      afterBuildTicks: scale => { scale.ticks = scale.ticks.filter(t => t.value <= 100); },
    }, v => `${v}%`),
  });

  // Wire legend click → toggle both charts
  legend.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      const i = parseInt(item.dataset.idx, 10);
      const visible = chartTime.isDatasetVisible(i);
      chartTime.setDatasetVisibility(i, !visible);
      chartAcc.setDatasetVisibility(i, !visible);
      chartTime.update();
      chartAcc.update();
      item.classList.toggle('legend-item-hidden', visible);
    });
  });

  // ── Radar charts ──────────────────────────────────────────────────────────
  const radarAcc = [], radarTime = [];
  for (const drill of GOAL_DRILLS) {
    const recs       = records.filter(r => r.drill === drill);
    const totCorrect = recs.reduce((s, r) => s + r.totalCorrect, 0);
    const totMisses  = recs.reduce((s, r) => s + r.totalMisses,  0);
    const totSecs    = recs.reduce((s, r) => s + r.totalSeconds, 0);
    const totPos     = recs.reduce((s, r) => s + r.positions,    0);
    radarAcc.push( totCorrect + totMisses > 0 ? Math.round(totCorrect / (totCorrect + totMisses) * 100) : 0);
    radarTime.push(totPos > 0 ? Math.round(totSecs / totPos) : 0);
  }

  const accMet  = GOAL_DRILLS.map((d, i) => {
    const g = goals[d] || DEFAULT_GOAL;
    return radarAcc[i]  >= g.acc;
  });
  const timeMet = GOAL_DRILLS.map((d, i) => {
    const g = goals[d] || DEFAULT_GOAL;
    return radarTime[i] > 0 && radarTime[i] <= g.time;
  });
  const radarAccLabels  = GOAL_LABELS_RADAR.map((l, i) => accMet[i]  ? `✓ ${l}` : l);
  const radarTimeLabels = GOAL_LABELS_RADAR.map((l, i) => timeMet[i] ? `✓ ${l}` : l);

  const timeMax = Math.ceil(Math.max(...radarTime, 10) / 5) * 5;

  const rGridColor  = 'rgba(255,255,255,0.1)';
  const rLabelColor = '#bbb';
  const rTickColor  = '#777';

  function radarOpts(max, tickCb, metArr) {
    const labelColors = metArr.map(m => m ? '#4caf50' : rLabelColor);
    return {
      responsive: true,
      aspectRatio: 1,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${tickCb(ctx.raw)}` } },
      },
      scales: {
        r: {
          min: 0, max,
          ticks: { color: rTickColor, backdropColor: 'transparent', stepSize: max / 4 },
          grid:        { color: rGridColor },
          angleLines:  { color: rGridColor },
          pointLabels: { color: labelColors, font: { size: 11 } },
        },
      },
    };
  }

  chartRadarAcc = new Chart(document.getElementById('chart-radar-acc'), {
    type: 'radar',
    data: {
      labels: radarAccLabels,
      datasets: [{ label: 'Accuracy', data: radarAcc,
        borderColor: '#3a9fd0', backgroundColor: 'rgba(58,159,208,0.2)',
        borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#3a9fd0' }],
    },
    options: radarOpts(100, v => `${v}%`, accMet),
  });

  chartRadarTime = new Chart(document.getElementById('chart-radar-time'), {
    type: 'radar',
    data: {
      labels: radarTimeLabels,
      datasets: [{ label: 'Avg Time', data: radarTime,
        borderColor: '#f0a030', backgroundColor: 'rgba(240,160,48,0.2)',
        borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#f0a030' }],
    },
    options: radarOpts(timeMax, v => `${v}s`, timeMet),
  });

  attachRadarTooltip(chartRadarAcc,  radarAcc,  goals, v => `${v}%`, 'acc',  '%');
  attachRadarTooltip(chartRadarTime, radarTime, goals, v => `${v}s`, 'time', 's');
}

// --- Export / Import ---

document.getElementById('btn-export').addEventListener('click', async () => {
  hamburgerDropdown.classList.add('hidden');
  const payload = {
    app: 'ChessSight',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    ...(await exportAllData()),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chesssight-backup-${new Date().toLocaleDateString('sv')}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  hamburgerDropdown.classList.add('hidden');
  const input = document.getElementById('import-file-input');
  input.value = '';
  input.click();
});

document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert('Invalid file: could not parse JSON.');
    return;
  }
  if (!Array.isArray(data.drillDays) || !Array.isArray(data.disciplineGames)) {
    alert('Invalid file: missing drillDays or disciplineGames.');
    return;
  }
  const dd = data.drillDays.length;
  const dg = data.disciplineGames.length;
  const ok = confirm(
    `Import ${dd} drill-day record${dd !== 1 ? 's' : ''} and ${dg} game record${dg !== 1 ? 's' : ''}?\n\n` +
    `Drill stats: existing records for the same date/drill will be overwritten.\n` +
    `Game history: imported games will be added (re-importing the same file creates duplicates).\n\n` +
    `This cannot be undone.`
  );
  if (!ok) return;
  try {
    await importAllData(data);
    alert('Imported successfully.');
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

// --- Debug modal (raw data table) ---
const modalDebug = document.getElementById('modal-debug');

document.getElementById('btn-debug').addEventListener('click', async () => {
  hamburgerDropdown.classList.add('hidden');
  await renderDataTable();
  modalDebug.classList.remove('hidden');
});

document.getElementById('btn-debug-modal-close').addEventListener('click', () => {
  modalDebug.classList.add('hidden');
});

modalDebug.addEventListener('click', (e) => {
  if (e.target === modalDebug) modalDebug.classList.add('hidden');
});

async function renderDataTable() {
  const wrap = document.getElementById('data-table-wrap');
  wrap.innerHTML = '';

  let records;
  try {
    records = await getAllRecords();
  } catch (err) {
    wrap.innerHTML = `<p class="data-empty">Error reading data: ${err.message}</p>`;
    return;
  }

  if (records.length === 0) {
    wrap.innerHTML = '<p class="data-empty">No data saved yet — complete some puzzles first.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr>
      <th>Date</th><th>Drill</th><th>Positions</th>
      <th>Total Time</th><th>Correct</th><th>Misses</th><th>Accuracy</th><th>Puzzle IDs</th>
    </tr></thead>`;

  const tbody = document.createElement('tbody');
  for (const r of records) {
    const total = r.totalCorrect + r.totalMisses;
    const acc = total > 0 ? Math.round(r.totalCorrect / total * 100) + '%' : '—';
    const mins = Math.floor(r.totalSeconds / 60);
    const secs = String(r.totalSeconds % 60).padStart(2, '0');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${DRILL_LABELS[r.drill] ?? r.drill}</td>
      <td>${r.positions}</td>
      <td>${mins}:${secs}</td>
      <td>${r.totalCorrect}</td>
      <td>${r.totalMisses}</td>
      <td>${acc}</td>
      <td class="puzzle-ids">${r.puzzleIds || '—'}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// Custom marker types for move highlighting
const MARKER_SELECTED = { class: 'marker-selected', slice: 'markerFrame' };
const MARKER_TARGET   = { class: 'marker-target',   slice: 'markerSquare' };
const MARKER_LEGAL    = { class: 'marker-legal',    slice: 'markerDot' };
const MARKER_CAPTURE  = { class: 'marker-capture',  slice: 'markerSquare' };

// --- Engine difficulty levels ---
const LEVELS = [
  { label: 'Beginner', skill:  1, depth:  5 },
  { label: 'Easy',     skill:  5, depth:  8 },
  { label: 'Medium',   skill: 10, depth: 10 },
  { label: 'Hard',     skill: 15, depth: 14 },
  { label: 'Expert',   skill: 20, depth: 18 },
  { label: 'Max',      skill: 20, depth: 20 },
];

// --- State ---
const chess = new Chess();
const engine = new Engine();
let board = null;
let orientation = COLOR.white;
let playerColor = COLOR.white;   // which side the human plays
let pendingBestMove = null;
let currentLevel = LEVELS[3];   // default: Hard
let moveIsDrag = false;
let selectedSquare = null;      // tracks the square clicked in click-to-move mode

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
const levelSelect     = document.getElementById('level-select');

// Show errors on-screen (no dev tools needed)
function dbg(msg) {
  console.log(msg);
  debugLog.textContent = msg;
}

// --- Board ---
function initBoard() {
  const boardEl = document.getElementById('board');

  // Detect drag vs click: track pointer movement after moveInputStarted
  let ptrStartX = 0, ptrStartY = 0;
  boardEl.addEventListener('pointerdown', e => {
    ptrStartX = e.clientX;
    ptrStartY = e.clientY;
    moveIsDrag = false;
  }, true);
  boardEl.addEventListener('pointermove', e => {
    if (!moveIsDrag && Math.hypot(e.clientX - ptrStartX, e.clientY - ptrStartY) > 8) {
      moveIsDrag = true;
    }
  });

  board = new Chessboard(boardEl, {
    position: chess.fen(),
    orientation,
    style: {
      pieces: {
        file: 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/pieces/standard.svg'
      }
    },
    extensions: [{
      class: Markers,
      props: { sprite: 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/extensions/markers/markers.svg' }
    }]
  });

  board.enableMoveInput(handleMoveInput, playerColor);
}

function clearMoveMarkers() {
  board.removeMarkers(MARKER_SELECTED);
  board.removeMarkers(MARKER_TARGET);
  board.removeMarkers(MARKER_LEGAL);
  board.removeMarkers(MARKER_CAPTURE);
}

function handleMoveInput(event) {
  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    const piece = chess.get(event.square);
    if (!piece || piece.color !== chess.turn()) {
      clearMoveMarkers();
      selectedSquare = null;
      return false;
    }
    // Clicking the already-selected square cancels the move
    if (event.square === selectedSquare) {
      clearMoveMarkers();
      selectedSquare = null;
      return false;
    }
    clearMoveMarkers();
    selectedSquare = event.square;
    board.addMarker(MARKER_SELECTED, event.square);

    // Show legal destinations: dot for empty squares, tinted square for captures
    for (const m of chess.moves({ square: event.square, verbose: true })) {
      board.addMarker(m.captured ? MARKER_CAPTURE : MARKER_LEGAL, m.to);
    }
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    selectedSquare = null;
    let move = null;
    try {
      move = chess.move({ from: event.squareFrom, to: event.squareTo, promotion: 'q' });
    } catch { /* invalid move — handled below */ }
    if (move) {
      pendingBestMove = null;
      bestMoveDisplay.textContent = '';
      if (moveIsDrag) {
        // Drag: piece is already at dest visually — no animation, clear markers now
        clearMoveMarkers();
        board.setPosition(chess.fen(), false);
      } else {
        // Click: highlight dest, animate piece src→dst, then clear markers
        board.addMarker(MARKER_TARGET, event.squareTo);
        board.setPosition(chess.fen(), true);
        setTimeout(clearMoveMarkers, 350);
      }
      renderMoveList();
      triggerEval();
      return true;
    }
    // Invalid move — clear highlights
    clearMoveMarkers();
    if (moveIsDrag) {
      // Defer setPosition so cm-chessboard can finish drag handling first,
      // then animate the piece back to its source square
      const fen = chess.fen();
      setTimeout(() => board.setPosition(fen, true), 0);
    }
    // For click mode the piece hasn't moved visually, nothing more to do
    return false;
  }

  if (event.type === INPUT_EVENT_TYPE.moveInputCanceled) {
    clearMoveMarkers();
    selectedSquare = null;
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
    const { score, bestMove } = await engine.evaluate(chess.fen(), currentLevel.depth);
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

levelSelect.addEventListener('change', () => {
  currentLevel = LEVELS[parseInt(levelSelect.value, 10)];
  if (engine.ready) engine.setSkillLevel(currentLevel.skill);
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

// --- Engine mode boot (called when engine screen is selected) ---
let engineInitialized = false;

export async function startEngineMode() {
  showScreen('screen-engine');
  if (engineInitialized) return;
  engineInitialized = true;

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
    engine.setSkillLevel(currentLevel.skill);
    engineStatus.textContent = 'Ready';
    dbg('Engine ready');
    triggerEval();
  } catch (err) {
    engineStatus.textContent = 'Engine unavailable';
    dbg(`Engine error: ${err.message}`);
  }
}

// --- Boot ---
initChecks(showScreen);
initCaptures(showScreen);
initLoose(showScreen);
initUnder(showScreen);
// initThreats(showScreen);  // disabled
initQueenAttack(showScreen);
initKnightRoute(showScreen);
initHangGrab(showScreen);
initMix(showScreen);
initDeLaMaza(showScreen, launchChessConfetti);
initDiscipline(showScreen, launchChessConfetti);
initMemory(showScreen);
initVimsy();
