/**
 * public/app.js — DroidLane frontend
 *
 * Pure vanilla JS, no framework, no bundler. Runs as an ES module in the browser.
 *
 * Sections:
 *   1. State          — single shared object, mutated directly (no reactivity layer needed)
 *   2. Monaco init    — loads the editor async; queues any file open that arrives before ready
 *   3. Clock          — live HH:MM display in the header
 *   4. Toast          — transient notification overlay
 *   5. File Tree      — recursive DOM renderer driven by /api/tree JSON
 *   6. File Load/Save — reads and writes files via /api/file
 *   7. Git Branches   — loads branches, renders searchable dropdown, handles checkout
 *   8. Build Console  — SSE consumer for /api/build, drives log output and button states
 *   9. Server Logs    — SSE consumer for /api/logs/stream, renders the bottom strip
 *  10. Boot           — kicks everything off
 */

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  currentFile: null,       // relative path of the file open in the editor
  isUnsaved: false,        // true when editor content differs from disk
  isBuildRunning: false,   // true while a Gradle build SSE stream is active
  currentBranch: null,     // name of the checked-out git branch
  allBranches: [],         // full list returned by /api/git/branches
  buildEvtSource: null,    // active EventSource for the build stream
  editor: null,            // Monaco editor instance
  expandedDirs: new Set(), // set of dir paths currently expanded in the tree
};

// ── Monaco init ───────────────────────────────────────────────────────────────
// Monaco is loaded asynchronously via its own AMD loader (require/define).
// pendingFileLoad holds a path if the user clicks a file before Monaco is ready.

let monacoReady = false;
let pendingFileLoad = null;

require.config({ paths: { vs: '/monaco/vs' } });

require(['vs/editor/editor.main'], () => {
  // Custom theme that matches the dashboard palette
  monaco.editor.defineTheme('droidlane', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '',           foreground: 'E6EDF3', background: '080A0F' },
      { token: 'comment',    foreground: '4A5568', fontStyle: 'italic' },
      { token: 'keyword',    foreground: '00D4FF' },
      { token: 'string',     foreground: '00FF88' },
      { token: 'number',     foreground: 'FFB800' },
      { token: 'type',       foreground: '00D4FF' },
      { token: 'identifier', foreground: 'E6EDF3' },
    ],
    colors: {
      'editor.background':                '#080A0F',
      'editor.foreground':                '#E6EDF3',
      'editorLineNumber.foreground':      '#2A3244',
      'editorLineNumber.activeForeground':'#4A5568',
      'editor.selectionBackground':       '#1C2333',
      'editor.lineHighlightBackground':   '#0D1117',
      'editorCursor.foreground':          '#00D4FF',
      'editorWhitespace.foreground':      '#1C2333',
      'editorIndentGuide.background':     '#1C2333',
      'scrollbar.shadow':                 '#00000000',
      'scrollbarSlider.background':       '#1C233380',
      'scrollbarSlider.hoverBackground':  '#1C2333',
    },
  });

  state.editor = monaco.editor.create(document.getElementById('editor-mount'), {
    theme: 'droidlane',
    automaticLayout: true,       // reflows when the container resizes
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    fontLigatures: true,
    lineNumbers: 'on',
    renderLineHighlight: 'line',
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    padding: { top: 12 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    renderWhitespace: 'none',
    wordWrap: 'off',
    tabSize: 4,
  });

  // Hide the placeholder text now that Monaco owns the mount div
  document.getElementById('editor-placeholder').style.display = 'none';

  // Mark as unsaved whenever the user types (but not on programmatic model changes)
  state.editor.onDidChangeModelContent(() => {
    if (state.currentFile) setUnsaved(true);
  });

  monacoReady = true;

  // Drain the pending load if a file was clicked before Monaco finished initialising
  if (pendingFileLoad) {
    const pf = pendingFileLoad;
    pendingFileLoad = null;
    loadFileIntoEditor(pf);
  }
});

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const branchBtn         = $('branch-btn');
const branchName        = $('branch-name');
const branchDropdown    = $('branch-dropdown');
const branchSearch      = $('branch-search');
const branchList        = $('branch-list');
const branchNoResults   = $('branch-no-results');
const treeContainer     = $('tree-container');
const editorTab         = $('editor-tab');
const tabFilename       = $('tab-filename');
const langBadge         = $('lang-badge');
const saveBtn           = $('save-btn');
const unsavedDot        = $('unsaved-dot');
const buildLog          = $('build-log');
const buildResult       = $('build-result');
const cancelBtn         = $('cancel-btn');
const clearLogBtn       = $('clear-log-btn');
const clock             = $('clock');
const refreshBtn        = $('refresh-btn');
const toast             = $('toast');
const serverLog         = $('server-log');
const logStripStatus    = $('log-strip-status');
const clearServerLogBtn = $('clear-server-log-btn');
const logStrip          = $('log-strip');
const logResizeHandle   = $('log-resize-handle');

// ── Clock ─────────────────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  clock.textContent =
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
updateClock();
setInterval(updateClock, 10000);

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;

/**
 * Show a transient notification in the bottom-right corner.
 *
 * @param {string} msg          - message text
 * @param {'success'|'error'|''} [type=''] - colour variant
 */
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `show ${type}`;
  toastTimer = setTimeout(() => { toast.className = ''; }, 2500);
}

// ── Unsaved state ─────────────────────────────────────────────────────────────

/**
 * Toggle the unsaved indicator dot, tab bullet, and save button highlight.
 *
 * @param {boolean} val
 */
function setUnsaved(val) {
  state.isUnsaved = val;
  unsavedDot.classList.toggle('visible', val);
  editorTab.classList.toggle('unsaved', val);
  saveBtn.classList.toggle('active', val);
}

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Map a filename extension to the Monaco language identifier.
 *
 * @param {string} filename
 * @returns {string} Monaco language id
 */
function detectLang(filename) {
  if (!filename) return 'plaintext';
  const ext = filename.split('.').pop().toLowerCase();
  return {
    gradle: 'groovy', groovy: 'groovy',
    kt: 'kotlin',     kts: 'kotlin',
    java: 'java',     xml: 'xml',
    json: 'json',     yaml: 'yaml',
    yml: 'yaml',      md: 'markdown',
    sh: 'shell',      toml: 'ini',
    pro: 'plaintext',
  }[ext] || 'plaintext';
}

/**
 * Return a short text icon for a filename, used in the file tree.
 *
 * @param {string} filename
 * @returns {string}
 */
function fileIcon(filename) {
  if (!filename) return '—';
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'gradle' || ext === 'groovy') return '◆';
  if (ext === 'json')  return '{}';
  if (ext === 'xml')   return '<>';
  if (ext === 'kt' || ext === 'kts') return 'K';
  if (ext === 'java')  return 'J';
  return '—';
}

// ── File loading ──────────────────────────────────────────────────────────────

/**
 * Fetch a project file from the server and open it in Monaco.
 * If Monaco isn't ready yet, queues the load in pendingFileLoad.
 *
 * @param {string} relPath - path relative to project root
 */
async function loadFileIntoEditor(relPath) {
  if (!monacoReady) { pendingFileLoad = relPath; return; }

  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(relPath)}`);
    if (!res.ok) { showToast('Failed to load file', 'error'); return; }
    const { content, path: fp } = await res.json();

    const lang  = detectLang(fp);
    const model = monaco.editor.createModel(content, lang);
    const old   = state.editor.getModel();
    state.editor.setModel(model);
    if (old) old.dispose(); // avoid memory leak from the previous model

    state.currentFile = relPath;
    tabFilename.textContent = relPath.split('/').pop();
    editorTab.classList.add('has-file');
    langBadge.textContent = lang;
    setUnsaved(false);

    // Sync the active highlight in the file tree
    document.querySelectorAll('.tree-node').forEach(n => {
      n.classList.toggle('active', n.dataset.path === relPath);
    });
  } catch {
    showToast('Error loading file', 'error');
  }
}

// ── File saving ───────────────────────────────────────────────────────────────

/**
 * Write the current editor content back to disk via POST /api/file.
 */
async function saveCurrentFile() {
  if (!state.currentFile || !state.editor) return;
  try {
    const res = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.currentFile, content: state.editor.getValue() }),
    });
    if (!res.ok) { showToast('Save failed', 'error'); return; }
    setUnsaved(false);
    showToast('Saved', 'success');
  } catch {
    showToast('Save error', 'error');
  }
}

saveBtn.addEventListener('click', saveCurrentFile);

// Ctrl+S / Cmd+S global shortcut
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
});

// ── File Tree ─────────────────────────────────────────────────────────────────

/**
 * Recursively build a DocumentFragment from the tree JSON returned by /api/tree.
 * Directories toggle expand/collapse on click. Files open in the editor.
 *
 * @param {Array}  nodes - tree nodes from the API
 * @param {number} [depth=0] - current nesting depth (controls left padding)
 * @returns {DocumentFragment}
 */
function renderTree(nodes, depth = 0) {
  const frag = document.createDocumentFragment();

  for (const node of nodes) {
    const el = document.createElement('div');
    el.className = 'tree-node';
    el.dataset.path = node.path;
    el.dataset.type = node.type;
    el.style.paddingLeft = `${8 + depth * 14}px`;

    if (node.type === 'dir') {
      const isExpanded = state.expandedDirs.has(node.path);
      el.innerHTML = `<span class="tree-toggle">${isExpanded ? '▾' : '▸'}</span>`
        + `<span class="tree-icon" style="color:var(--muted)">▫</span>`
        + `<span class="tree-name">${node.name}/</span>`;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedDirs.has(node.path)
          ? state.expandedDirs.delete(node.path)
          : state.expandedDirs.add(node.path);
        renderTreeInto(treeCache); // re-render from cached data (no network call)
      });

      frag.appendChild(el);

      if (isExpanded && node.children?.length) {
        frag.appendChild(renderTree(node.children, depth + 1));
      }
    } else {
      if (state.currentFile === node.path) el.classList.add('active');
      el.innerHTML = `<span class="tree-toggle"></span>`
        + `<span class="tree-icon" style="color:var(--muted);font-size:10px">${fileIcon(node.name)}</span>`
        + `<span class="tree-name">${node.name}</span>`;

      el.addEventListener('click', () => {
        if (state.isUnsaved && !confirm('Discard unsaved changes?')) return;
        loadFileIntoEditor(node.path);
      });

      frag.appendChild(el);
    }
  }

  return frag;
}

/** Last fetched tree data — used to re-render on expand/collapse without a network call */
let treeCache = [];

/** Fetch fresh tree data from the server and render it */
async function refreshTree() {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) return;
    const { tree } = await res.json();
    treeCache = tree;
    renderTreeInto(tree);
  } catch {}
}

/** Replace the tree container's content with a freshly rendered fragment */
function renderTreeInto(tree) {
  treeContainer.innerHTML = '';
  treeContainer.appendChild(renderTree(tree, 0));
}

// ── Git Branches ──────────────────────────────────────────────────────────────

/** Fetch branch list from the server and populate the dropdown */
async function loadBranches() {
  try {
    const res = await fetch('/api/git/branches');
    if (!res.ok) { branchName.textContent = 'git error'; return; }
    const { branches, current } = await res.json();
    state.currentBranch = current;
    state.allBranches   = branches;
    branchName.textContent = current || 'detached';
    renderBranchList(branches, current, '');
  } catch {
    branchName.textContent = 'no git';
  }
}

/**
 * Escape HTML special characters to prevent injection in innerHTML.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Render the branch list into #branch-list, filtered and highlighted by query.
 *
 * @param {string[]} branches - full list of branch names
 * @param {string}   current  - currently checked-out branch
 * @param {string}   query    - search string (empty = show all)
 */
function renderBranchList(branches, current, query) {
  branchList.innerHTML = '';
  const q = query.trim().toLowerCase();
  let count = 0;

  for (const b of branches) {
    if (q && !b.toLowerCase().includes(q)) continue;
    count++;

    const item = document.createElement('div');
    item.className = `branch-item${b === current ? ' active' : ''}`;

    if (q) {
      // Wrap the matching substring in a highlight span
      const idx    = b.toLowerCase().indexOf(q);
      const before = escapeHtml(b.slice(0, idx));
      const match  = escapeHtml(b.slice(idx, idx + q.length));
      const after  = escapeHtml(b.slice(idx + q.length));
      item.innerHTML = `${before}<span class="match-highlight">${match}</span>${after}`;
    } else {
      item.textContent = b;
    }

    item.addEventListener('click', () => switchBranch(b));
    branchList.appendChild(item);
  }

  branchNoResults.style.display = count === 0 ? 'block' : 'none';
}

// Open / close dropdown
branchBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = branchDropdown.classList.toggle('open');
  if (isOpen) {
    branchSearch.value = '';
    renderBranchList(state.allBranches, state.currentBranch, '');
    requestAnimationFrame(() => branchSearch.focus());
  }
});

// Filter as the user types
branchSearch.addEventListener('input', () => {
  renderBranchList(state.allBranches, state.currentBranch, branchSearch.value);
});

// Don't propagate clicks inside the dropdown (would close it via the doc listener)
branchDropdown.addEventListener('click', (e) => e.stopPropagation());

// Click outside → close
document.addEventListener('click', () => branchDropdown.classList.remove('open'));

// Keyboard: Escape closes, Enter picks first filtered result
branchSearch.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { branchDropdown.classList.remove('open'); branchSearch.blur(); }
  if (e.key === 'Enter') { branchList.querySelector('.branch-item')?.click(); }
});

/**
 * Check out a git branch.
 * Guards against unsaved changes and shows errors as toasts.
 *
 * @param {string} branch
 */
async function switchBranch(branch) {
  if (branch === state.currentBranch) { branchDropdown.classList.remove('open'); return; }
  if (state.isUnsaved && !confirm('Switching branches will discard unsaved changes. Continue?')) return;

  branchDropdown.classList.remove('open');
  branchName.textContent = '…';

  try {
    const res  = await fetch('/api/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(`Checkout failed: ${data.error}`, 'error');
      branchName.textContent = state.currentBranch;
      return;
    }

    state.currentBranch = branch;
    branchName.textContent = branch;
    await loadBranches();
    // Re-read the open file from the new branch so the editor reflects the new content
    if (state.currentFile) await loadFileIntoEditor(state.currentFile);
    await refreshTree();
    showToast(`Switched to ${branch}`, 'success');
  } catch {
    showToast('Branch switch error', 'error');
    branchName.textContent = state.currentBranch;
  }
}

// ── Build Console ─────────────────────────────────────────────────────────────

/**
 * Append a line to the build output log with the appropriate colour class.
 *
 * @param {string} line
 * @param {'out'|'err'} type - raw type from the SSE event
 */
function appendBuildLog(line, type) {
  const el = document.createElement('div');
  el.className = `log-line ${classifyLine(line, type)}`;
  el.textContent = line;
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

/**
 * Update button states and the cancel button visibility.
 *
 * @param {boolean}         running  - whether a build is now in progress
 * @param {HTMLElement|null} taskBtn - the button that triggered the build
 */
function setBuildRunning(running, taskBtn) {
  state.isBuildRunning = running;
  document.querySelectorAll('.build-btn').forEach(b => {
    b.disabled = running;
    b.classList.remove('running');
  });
  if (running && taskBtn) taskBtn.classList.add('running');
  cancelBtn.classList.toggle('visible', running);
  buildResult.className = '';
}

/**
 * Start a Gradle build task and consume its SSE stream.
 *
 * @param {string} task - Gradle task name (e.g. 'assembleRelease')
 */
function startBuild(task) {
  if (state.isBuildRunning) return;
  buildLog.innerHTML = '';
  buildResult.className = '';

  const taskBtn = document.querySelector(`[data-task="${task}"]`);
  setBuildRunning(true, taskBtn);

  const es = new EventSource(`/api/build?task=${encodeURIComponent(task)}`);
  state.buildEvtSource = es;

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'done') {
      es.close(); state.buildEvtSource = null;
      setBuildRunning(false, null);
      buildResult.textContent = '✓ BUILD SUCCESSFUL';
      buildResult.className = 'success';
      showToast('Build successful', 'success');
    } else if (data.type === 'fail') {
      es.close(); state.buildEvtSource = null;
      setBuildRunning(false, null);
      buildResult.textContent = '✗ BUILD FAILED';
      buildResult.className = 'fail';
      showToast('Build failed', 'error');
    } else {
      appendBuildLog(data.line, data.type);
    }
  };

  es.onerror = () => {
    es.close(); state.buildEvtSource = null;
    setBuildRunning(false, null);
    buildResult.textContent = '✗ CONNECTION LOST';
    buildResult.className = 'fail';
  };
}

document.querySelectorAll('.build-btn').forEach(btn => {
  btn.addEventListener('click', () => startBuild(btn.dataset.task));
});

cancelBtn.addEventListener('click', async () => {
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
});

// ── Server Log Strip ──────────────────────────────────────────────────────────

/**
 * Format a Unix millisecond timestamp as HH:MM:SS.
 *
 * @param {number} ts
 * @returns {string}
 */
function formatTs(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

/**
 * Summarise the meta fields of a log entry into a short inline annotation.
 * Example: "200 · 4ms" or "bundleRelease"
 *
 * @param {Object} entry
 * @returns {string}
 */
function formatMeta(entry) {
  const parts = [];
  if (entry.status !== undefined) parts.push(`${entry.status}`);
  if (entry.ms     !== undefined) parts.push(`${entry.ms}ms`);
  if (entry.bytes  !== undefined) parts.push(`${entry.bytes}b`);
  if (entry.task)                 parts.push(entry.task);
  return parts.join(' · ');
}

/**
 * Append a server log entry to the bottom strip.
 *
 * @param {{ ts, level, msg, ...meta }} entry
 */
function appendServerLog(entry) {
  const el = document.createElement('div');
  el.className = 'slog-line';
  const meta = formatMeta(entry);

  // cmd entries get a distinct "$ command" treatment so they stand out as
  // the actual shell/git/gradle commands being executed
  const msgSpan = entry.level === 'cmd'
    ? `<span class="slog-cmd">${escapeHtml(entry.msg)}</span>`
    : `<span class="slog-msg">${escapeHtml(entry.msg)}</span>`;

  el.innerHTML =
    `<span class="slog-ts">${formatTs(entry.ts)}</span>` +
    `<span class="slog-level ${entry.level}">${entry.level === 'cmd' ? 'run' : entry.level}</span>` +
    msgSpan +
    (meta ? `<span class="slog-meta">${escapeHtml(meta)}</span>` : '');

  serverLog.appendChild(el);
  serverLog.scrollTop = serverLog.scrollHeight;
}

/**
 * Open an SSE connection to /api/logs/stream and pipe entries into the strip.
 * Automatically reconnects after 3 s if the connection drops.
 */
function connectLogStream() {
  const es = new EventSource('/api/logs/stream');

  es.onopen    = () => { logStripStatus.classList.add('live'); };
  es.onmessage = (e) => { appendServerLog(JSON.parse(e.data)); };
  es.onerror   = () => {
    logStripStatus.classList.remove('live');
    es.close();
    setTimeout(connectLogStream, 3000);
  };
}

clearServerLogBtn.addEventListener('click', () => { serverLog.innerHTML = ''; });

// ── Log strip resize ──────────────────────────────────────────────────────────
// Drag the handle upward to expand, downward to shrink.
// Height is clamped between 60px (collapsed) and 70% of the window.

(function initLogResize() {
  let startY = 0;
  let startHeight = 0;

  logResizeHandle.addEventListener('mousedown', (e) => {
    startY      = e.clientY;
    startHeight = logStrip.offsetHeight;
    logResizeHandle.classList.add('dragging');
    document.body.style.userSelect = 'none'; // prevent text selection while dragging
    document.body.style.cursor = 'ns-resize';

    function onMove(e) {
      const delta     = startY - e.clientY;          // up = positive = taller
      const maxHeight = Math.floor(window.innerHeight * 0.7);
      const newHeight = Math.max(60, Math.min(maxHeight, startHeight + delta));
      logStrip.style.height    = `${newHeight}px`;
      logStrip.style.minHeight = `${newHeight}px`;
      serverLog.scrollTop = serverLog.scrollHeight;   // keep scroll pinned
    }

    function onUp() {
      logResizeHandle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ── Refresh button ────────────────────────────────────────────────────────────

refreshBtn.addEventListener('click', async () => {
  // Spin the icon as a visual cue
  refreshBtn.style.transform  = 'rotate(360deg)';
  refreshBtn.style.transition = 'transform 400ms ease-out';
  setTimeout(() => { refreshBtn.style.transform = ''; refreshBtn.style.transition = ''; }, 400);

  await Promise.all([refreshTree(), loadBranches()]);
  showToast('Refreshed');
});

// ── Boot ──────────────────────────────────────────────────────────────────────

/**
 * Initialise the dashboard:
 *   1. Fetch project name and update the page title
 *   2. Start the server log SSE stream
 *   3. Load the file tree and git branches in parallel
 */
async function boot() {
  try {
    const res = await fetch('/api/project');
    if (res.ok) {
      const { name } = await res.json();
      document.title = `${name} — DROIDLANE`;
    }
  } catch {}

  connectLogStream();
  await Promise.all([refreshTree(), loadBranches()]);
}

boot();
