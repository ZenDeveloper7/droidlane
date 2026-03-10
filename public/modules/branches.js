/**
 * modules/branches.js — git branch loading, rendering, and checkout
 */

import { state } from './state.js';
import { showToast, escapeHtml } from './utils.js';
import { loadFileIntoEditor } from './editor.js';
import { refreshTree } from './tree.js';

// ── Branch loading ────────────────────────────────────────────────────────────

/** Fetch branch list from the server and populate the dropdown */
export async function loadBranches() {
  try {
    const res = await fetch('/api/git/branches');
    if (!res.ok) { document.getElementById('branch-name').textContent = 'git error'; return; }
    const { branches, current } = await res.json();
    state.currentBranch = current;
    state.allBranches   = branches;
    document.getElementById('branch-name').textContent = current || 'detached';
    renderBranchList(branches, current, '');
  } catch {
    document.getElementById('branch-name').textContent = 'no git';
  }
}

// ── Branch list rendering ─────────────────────────────────────────────────────

/**
 * Render the branch list into #branch-list, filtered and highlighted by query.
 *
 * @param {string[]} branches - full list of branch names
 * @param {string}   current  - currently checked-out branch
 * @param {string}   query    - search string (empty = show all)
 */
export function renderBranchList(branches, current, query) {
  const branchList      = document.getElementById('branch-list');
  const branchNoResults = document.getElementById('branch-no-results');
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

// ── Branch checkout ───────────────────────────────────────────────────────────

/**
 * Check out a git branch.
 * Guards against unsaved changes and shows errors as toasts.
 *
 * @param {string} branch
 */
export async function switchBranch(branch) {
  const branchDropdown = document.getElementById('branch-dropdown');
  const branchName     = document.getElementById('branch-name');

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

// ── Branch dropdown wiring ────────────────────────────────────────────────────

export function initBranchListeners() {
  const branchBtn      = document.getElementById('branch-btn');
  const branchDropdown = document.getElementById('branch-dropdown');
  const branchSearch   = document.getElementById('branch-search');

  // Open / close dropdown
  branchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = branchDropdown.classList.toggle('open');
    branchBtn.setAttribute('aria-expanded', String(isOpen));
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
    if (e.key === 'Enter') { document.getElementById('branch-list').querySelector('.branch-item')?.click(); }
  });
}
