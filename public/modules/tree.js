/**
 * modules/tree.js — file tree rendering, search, refresh
 */

import { state } from './state.js';
import { showToast, escapeHtml, fileIcon } from './utils.js';
import { loadFileIntoEditor } from './editor.js';

/** Last fetched tree data — used to re-render on expand/collapse without a network call. */
let treeCache = [];

const treeContainer = () => document.getElementById('tree-container');

// ── Tree rendering ────────────────────────────────────────────────────────────

/**
 * Recursively build a DocumentFragment from the tree JSON returned by /api/tree.
 * Directories toggle expand/collapse on click. Files open in the editor.
 *
 * @param {Array}  nodes - tree nodes from the API
 * @param {number} [depth=0] - current nesting depth (controls left padding)
 * @returns {DocumentFragment}
 */
export function renderTree(nodes, depth = 0) {
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
        + `<span class="tree-name">${escapeHtml(node.name)}/</span>`;

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
        + `<span class="tree-name">${escapeHtml(node.name)}</span>`;

      // Pin button — sets this file as the default on startup
      const pinBtn = document.createElement('button');
      pinBtn.className = 'pin-btn';
      pinBtn.title = 'Set as default file (auto-open on startup)';
      pinBtn.setAttribute('aria-label', `Pin ${node.name} as default file`);
      pinBtn.textContent = '⊙';
      if (node.path === state.pinnedFile) pinBtn.classList.add('pinned');
      pinBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const res = await fetch('/api/default-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: node.path }),
          });
          if (!res.ok) { showToast('Failed to pin file', 'error'); return; }
          state.pinnedFile = node.path;
          showToast(`Pinned: ${node.name}`, 'success');
          renderTreeInto(treeCache); // refresh to update pin highlights
        } catch {
          showToast('Error pinning file', 'error');
        }
      });
      el.appendChild(pinBtn);

      el.addEventListener('click', () => {
        if (state.isUnsaved && !confirm('Discard unsaved changes?')) return;
        loadFileIntoEditor(node.path);
      });

      frag.appendChild(el);
    }
  }

  return frag;
}

/**
 * Replace the tree container's content with a freshly rendered fragment.
 *
 * @param {Array} tree - tree nodes (same shape as /api/tree response)
 */
export function renderTreeInto(tree) {
  treeContainer().innerHTML = '';
  treeContainer().appendChild(renderTree(tree, 0));
}

/**
 * Fetch fresh tree data from the server, cache it, and render it.
 * Shows an error toast on network or server failure.
 */
export async function refreshTree() {
  try {
    const res = await fetch('/api/tree');
    if (!res.ok) { showToast('Failed to load file tree', 'error'); return; }
    const { tree } = await res.json();
    treeCache = tree;
    renderTreeInto(tree);
  } catch {
    showToast('Error loading file tree', 'error');
  }
}

/**
 * Flatten a nested tree structure into a flat array of file nodes only.
 *
 * @param {Array}  nodes  - tree nodes
 * @param {Array}  [result=[]] - accumulator (used in recursion)
 * @returns {Array} flat list of file-type nodes
 */
export function flattenTree(nodes, result = []) {
  for (const node of nodes) {
    if (node.type === 'file') result.push(node);
    else if (node.children) flattenTree(node.children, result);
  }
  return result;
}

/**
 * Filter the cached tree by query and render a flat list of matching files.
 * Clears search and restores the full tree when the query is empty.
 *
 * @param {string} query - raw value from the file-search input
 */
export function renderSearchResults(query) {
  const q = query.trim().toLowerCase();
  treeContainer().innerHTML = '';
  if (!q) { renderTreeInto(treeCache); return; }

  const matches = flattenTree(treeCache).filter(f =>
    f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  );

  if (!matches.length) {
    treeContainer().innerHTML = '<div style="padding:10px 14px;color:var(--muted);font-size:12px">no matches</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const file of matches) {
    const el = document.createElement('div');
    el.className = 'tree-node';
    el.dataset.path = file.path;
    el.style.paddingLeft = '8px';
    if (state.currentFile === file.path) el.classList.add('active');

    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    el.innerHTML = `<span class="tree-toggle"></span>`
      + `<span class="tree-icon" style="color:var(--muted);font-size:10px">${fileIcon(file.name)}</span>`
      + `<span class="tree-name">${escapeHtml(file.name)}</span>`
      + (dir ? `<span class="tree-path-hint">${escapeHtml(dir)}</span>` : '');

    el.addEventListener('click', () => {
      if (state.isUnsaved && !confirm('Discard unsaved changes?')) return;
      loadFileIntoEditor(file.path);
    });
    frag.appendChild(el);
  }
  treeContainer().appendChild(frag);
}

// ── Tree search wiring ────────────────────────────────────────────────────────

export function initTreeListeners() {
  let fileSearchTimer;
  document.getElementById('file-search').addEventListener('input', (e) => {
    clearTimeout(fileSearchTimer);
    fileSearchTimer = setTimeout(() => renderSearchResults(e.target.value), 200);
  });
}
