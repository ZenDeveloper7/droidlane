/**
 * modules/utils.js — shared utility functions
 */

import { state } from './state.js';

// ── DOM helper ────────────────────────────────────────────────────────────────

/**
 * Shorthand for document.getElementById.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
export const $ = (id) => document.getElementById(id);

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;

/**
 * Show a transient notification in the bottom-right corner.
 *
 * @param {string} msg          - message text
 * @param {'success'|'error'|''} [type=''] - colour variant
 */
export function showToast(msg, type = '') {
  const toast = $('toast');
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `show ${type}`;
  toastTimer = setTimeout(() => { toast.className = ''; }, 2500);
}

// ── HTML escaping ─────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent injection in innerHTML.
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Language detection ────────────────────────────────────────────────────────

/**
 * Map a filename extension to the Monaco language identifier.
 *
 * @param {string} filename
 * @returns {string} Monaco language id
 */
export function detectLang(filename) {
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
export function fileIcon(filename) {
  if (!filename) return '—';
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'gradle' || ext === 'groovy') return '◆';
  if (ext === 'json')  return '{}';
  if (ext === 'xml')   return '<>';
  if (ext === 'kt' || ext === 'kts') return 'K';
  if (ext === 'java')  return 'J';
  return '—';
}

// ── Unsaved state ─────────────────────────────────────────────────────────────

/**
 * Toggle the unsaved indicator dot, tab bullet, and save button highlight.
 *
 * @param {boolean} val
 */
export function setUnsaved(val) {
  const unsavedDot = $('unsaved-dot');
  const editorTab  = $('editor-tab');
  const saveBtn    = $('save-btn');
  state.isUnsaved = val;
  unsavedDot.classList.toggle('visible', val);
  editorTab.classList.toggle('unsaved', val);
  saveBtn.classList.toggle('active', val);
}

// ── Server log helpers ────────────────────────────────────────────────────────

/**
 * Format a Unix millisecond timestamp as HH:MM:SS.
 *
 * @param {number} ts
 * @returns {string}
 */
export function formatTs(ts) {
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
export function formatMeta(entry) {
  const parts = [];
  if (entry.status !== undefined) parts.push(`${entry.status}`);
  if (entry.ms     !== undefined) parts.push(`${entry.ms}ms`);
  if (entry.bytes  !== undefined) parts.push(`${entry.bytes}b`);
  if (entry.task)                 parts.push(entry.task);
  return parts.join(' · ');
}
