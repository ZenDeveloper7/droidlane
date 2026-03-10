/**
 * modules/build.js — Gradle build console: SSE stream, log output, button states
 */

import { state } from './state.js';
import { showToast } from './utils.js';

// ── Build log ─────────────────────────────────────────────────────────────────

/**
 * Append a line to the build output log with the appropriate colour class.
 *
 * @param {string} line
 * @param {'out'|'err'} type - raw type from the SSE event
 */
export function appendBuildLog(line, type) {
  const buildLog = document.getElementById('build-log');
  const el = document.createElement('div');
  el.className = `log-line ${classifyLine(line, type)}`;
  el.dataset.line = line;
  el.textContent = line;

  const copyBtn = document.createElement('button');
  copyBtn.className = 'log-copy-btn';
  copyBtn.title = 'Copy line';
  copyBtn.textContent = '⎘';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(line).then(() => showToast('Copied', 'success'));
  });
  el.appendChild(copyBtn);

  buildLog.appendChild(el);
  buildLog.scrollTop = buildLog.scrollHeight;
}

/**
 * Classify a Gradle output line into a CSS class for colouring.
 * Order matters: err > warning heuristics > task names > muted > plain out.
 *
 * @param {string} line
 * @param {string} rawType
 * @returns {string} CSS class name
 */
function classifyLine(line, rawType) {
  if (rawType === 'err') return 'err';
  if (/^\s*w:/i.test(line) || /warning/i.test(line)) return 'warn';
  if (/^>\s*Task\s+:/.test(line)) return 'task';
  if (/^(Starting|Deprecated|Note:|Download|Configure)/i.test(line.trim())) return 'muted';
  return 'out';
}

// ── Build state ───────────────────────────────────────────────────────────────

/**
 * Update button states and the cancel button visibility.
 *
 * @param {boolean}         running  - whether a build is now in progress
 * @param {HTMLElement|null} taskBtn - the button that triggered the build
 */
export function setBuildRunning(running, taskBtn) {
  const cancelBtn   = document.getElementById('cancel-btn');
  const buildResult = document.getElementById('build-result');
  state.isBuildRunning = running;
  document.querySelectorAll('.build-btn').forEach(b => {
    b.disabled = running;
    b.classList.remove('running');
  });
  if (running && taskBtn) taskBtn.classList.add('running');
  cancelBtn.classList.toggle('visible', running);
  buildResult.className = '';
}

// ── Output files ──────────────────────────────────────────────────────────────

/**
 * Render the list of copied output files below the build result banner.
 *
 * @param {string[]} files     - filenames produced by the build
 * @param {string}   outputDir - directory they were copied into
 */
export function renderOutputFiles(files, outputDir) {
  const buildResult = document.getElementById('build-result');
  let list = document.getElementById('build-file-list');
  if (!list) {
    list = document.createElement('div');
    list.id = 'build-file-list';
    buildResult.insertAdjacentElement('afterend', list);
  }
  list.innerHTML = '';
  const heading = document.createElement('div');
  heading.className = 'build-files-heading';
  heading.textContent = `Output → ${outputDir}/`;
  list.appendChild(heading);
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'build-file-row';
    row.textContent = f;
    list.appendChild(row);
  }
}

// ── Build start ───────────────────────────────────────────────────────────────

/**
 * Start a Gradle build task and consume its SSE stream.
 *
 * @param {string} task - Gradle task name (e.g. 'assembleRelease')
 */
export function startBuild(task) {
  if (state.isBuildRunning) return;
  const buildLog    = document.getElementById('build-log');
  const buildResult = document.getElementById('build-result');
  buildLog.innerHTML = '';
  document.getElementById('build-file-list')?.remove();

  // For "Build Both", highlight the both-button as running
  const taskBtn = document.querySelector(
    state.buildBothPending || task === 'bundleRelease'
      ? '[data-task="both"]'
      : `[data-task="${task}"]`
  );
  setBuildRunning(true, taskBtn);

  const es = new EventSource(`/api/build?task=${encodeURIComponent(task)}`);
  state.buildEvtSource = es;

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'done') {
      es.close(); state.buildEvtSource = null;
      setBuildRunning(false, null);
      // Build Both: bundleRelease finished — chain assembleRelease
      if (state.buildBothPending) {
        state.buildBothPending = false;
        appendBuildLog('─── bundleRelease done, starting assembleRelease ───', 'out');
        startBuild('assembleRelease');
        return;
      }
      buildResult.textContent = '✓ BUILD SUCCESSFUL';
      buildResult.className = 'success';
      showToast('Build successful', 'success');
    } else if (data.type === 'fail') {
      es.close(); state.buildEvtSource = null;
      state.buildBothPending = false;
      setBuildRunning(false, null);
      buildResult.textContent = '✗ BUILD FAILED';
      buildResult.className = 'fail';
      showToast('Build failed', 'error');
    } else if (data.type === 'files') {
      renderOutputFiles(data.files, data.outputDir);
    } else {
      appendBuildLog(data.line, data.type);
    }
  };

  es.onerror = () => {
    es.close(); state.buildEvtSource = null;
    state.buildBothPending = false;
    setBuildRunning(false, null);
    buildResult.textContent = '✗ CONNECTION LOST';
    buildResult.className = 'fail';
  };
}

// ── Build UI listeners ────────────────────────────────────────────────────────

export function initBuildListeners() {
  const cancelBtn      = document.getElementById('cancel-btn');
  const clearLogBtn    = document.getElementById('clear-log-btn');
  const copyErrorsBtn  = document.getElementById('copy-errors-btn');
  const buildExpandBtn = document.getElementById('build-expand-btn');
  const panelBuild     = document.getElementById('panel-build');
  const buildLog       = document.getElementById('build-log');
  const buildResult    = document.getElementById('build-result');

  document.querySelectorAll('.build-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.task === 'both') {
        state.buildBothPending = true;
        startBuild('bundleRelease');
      } else {
        state.buildBothPending = false;
        startBuild(btn.dataset.task);
      }
    });
  });

  cancelBtn.addEventListener('click', async () => {
    state.buildBothPending = false;
    if (state.buildEvtSource) { state.buildEvtSource.close(); state.buildEvtSource = null; }
    try { await fetch('/api/build', { method: 'DELETE' }); } catch {}
    setBuildRunning(false, null);
    appendBuildLog('Build cancelled by user.', 'err');
    buildResult.textContent = '✗ CANCELLED';
    buildResult.className = 'fail';
  });

  clearLogBtn.addEventListener('click', () => {
    buildLog.innerHTML = '';
    buildResult.className = '';
    document.getElementById('build-file-list')?.remove();
  });

  buildExpandBtn.addEventListener('click', () => {
    const expanded = panelBuild.classList.toggle('expanded');
    buildExpandBtn.classList.toggle('active', expanded);
    buildExpandBtn.title = expanded ? 'Collapse panel' : 'Expand panel';
  });

  copyErrorsBtn.addEventListener('click', () => {
    const errors = [...buildLog.querySelectorAll('.log-line.err')]
      .map(el => el.dataset.line ?? el.textContent)
      .join('\n');
    if (!errors) { showToast('No errors to copy', ''); return; }
    navigator.clipboard.writeText(errors).then(() =>
      showToast(`Copied ${errors.split('\n').length} error line(s)`, 'success')
    );
  });
}
