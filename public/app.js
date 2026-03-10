/**
 * public/app.js — DroidLane frontend entry point
 *
 * Pure vanilla JS, no framework, no bundler. Runs as an ES module in the browser.
 *
 * Sections:
 *   1. Imports        — pull in all sub-modules
 *   2. Monaco init    — start AMD loader early so Monaco loads in the background
 *   3. Clock          — live HH:MM display in the header
 *   4. Keyboard       — global Ctrl+S / Cmd+S shortcut
 *   5. Refresh button — triggers tree + branch reload
 *   6. Boot           — kicks everything off
 */

import { state } from './modules/state.js';
import { $, showToast } from './modules/utils.js';
import { initMonaco, initEditorListeners, saveCurrentFile, loadFileIntoEditor } from './modules/editor.js';
import { refreshTree, initTreeListeners } from './modules/tree.js';
import { loadBranches, initBranchListeners } from './modules/branches.js';
import { initBuildListeners } from './modules/build.js';
import { connectLogStream, initLogStripListeners } from './modules/logs.js';

// ── Monaco init ───────────────────────────────────────────────────────────────
// Must run early (before boot) so the AMD loader is configured and Monaco begins
// loading in the background while the rest of the page initialises.

initMonaco();

// ── Clock ─────────────────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  $('clock').textContent =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
updateClock();
setInterval(updateClock, 60000);

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

// Ctrl+S / Cmd+S global shortcut
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
});

// ── Refresh button ────────────────────────────────────────────────────────────

$('refresh-btn').addEventListener('click', async () => {
  // Spin the icon as a visual cue
  const refreshBtn = $('refresh-btn');
  refreshBtn.style.transform  = 'rotate(360deg)';
  refreshBtn.style.transition = 'transform 400ms ease-out';
  setTimeout(() => { refreshBtn.style.transform = ''; refreshBtn.style.transition = ''; }, 400);

  await Promise.all([refreshTree(), loadBranches()]);
  showToast('Refreshed');
});

// ── Wire up all module listeners ──────────────────────────────────────────────

initEditorListeners();
initTreeListeners();
initBranchListeners();
initBuildListeners();
initLogStripListeners();

// ── Boot ──────────────────────────────────────────────────────────────────────

/**
 * Initialise the dashboard:
 *   1. Fetch project name and update the page title
 *   2. Show JDK info in the build panel badge
 *   3. Start the server log SSE stream
 *   4. Load the file tree and git branches in parallel
 *   5. Auto-open the default/pinned file
 */
async function boot() {
  try {
    const res = await fetch('/api/project');
    if (res.ok) {
      const { name } = await res.json();
      document.title = `${name} — DROIDLANE`;
    }
  } catch {}

  // Show which JDK will be used for builds
  try {
    const res = await fetch('/api/jdk');
    if (res.ok) {
      const { path: jdkPath, source } = await res.json();
      const badge = $('jdk-badge');
      if (source === 'android-studio') {
        badge.textContent = `☕ ${jdkPath}`;
        badge.classList.add('ok');
      } else {
        badge.textContent = '⚠ Android Studio JDK not found — using system Java';
        badge.classList.add('warn');
      }
    }
  } catch {}

  connectLogStream();
  await Promise.all([refreshTree(), loadBranches()]);

  // Auto-open the default file (release.gradle if present, or user-pinned file)
  try {
    const res = await fetch('/api/default-file');
    if (res.ok) {
      const { path: defaultPath } = await res.json();
      if (defaultPath) {
        state.pinnedFile = defaultPath;
        loadFileIntoEditor(defaultPath);
      }
    }
  } catch {}
}

boot();
