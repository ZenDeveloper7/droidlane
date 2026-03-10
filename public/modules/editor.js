/**
 * modules/editor.js — Monaco editor initialisation, file load/save
 */

import { state } from './state.js';
import { showToast, detectLang, setUnsaved, $ } from './utils.js';

// ── Monaco init ───────────────────────────────────────────────────────────────
// Monaco is loaded asynchronously via its own AMD loader (require/define).
// state.pendingFileLoad holds a path if the user clicks a file before Monaco is ready.

export function initMonaco() {
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

    state.monacoReady = true;

    // Drain the pending load if a file was clicked before Monaco finished initialising
    if (state.pendingFileLoad) {
      const pf = state.pendingFileLoad;
      state.pendingFileLoad = null;
      loadFileIntoEditor(pf);
    }
  });
}

// ── File loading ──────────────────────────────────────────────────────────────

/**
 * Fetch a project file from the server and open it in Monaco.
 * If Monaco isn't ready yet, queues the load in pendingFileLoad.
 *
 * @param {string} relPath - path relative to project root
 */
export async function loadFileIntoEditor(relPath) {
  if (!state.monacoReady) { state.pendingFileLoad = relPath; return; }

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
    $('tab-filename').textContent = relPath.split('/').pop();
    $('editor-tab').classList.add('has-file');
    $('lang-badge').textContent = lang;
    setUnsaved(false);

    // Show "Add to Build List" only for files inside a flavours/ directory
    const isFlavour = relPath.includes('/flavours/') && relPath.endsWith('.gradle');
    $('add-to-build-btn').style.display = isFlavour ? '' : 'none';

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
export async function saveCurrentFile() {
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

// ── Editor toolbar wiring ─────────────────────────────────────────────────────

export function initEditorListeners() {
  $('save-btn').addEventListener('click', saveCurrentFile);

  $('add-to-build-btn').addEventListener('click', async () => {
    const flavour = state.currentFile.split('/').pop().replace('.gradle', '');
    try {
      const res = await fetch('/api/flavour/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flavour }),
      });
      if (!res.ok) { showToast('Failed to update release.gradle', 'error'); return; }
      showToast(`${flavour} → release.gradle`, 'success');
      // Open release.gradle so the user sees the change
      await loadFileIntoEditor('app/release.gradle');
    } catch {
      showToast('Error applying flavour', 'error');
    }
  });
}
