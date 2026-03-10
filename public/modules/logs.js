/**
 * modules/logs.js — server log SSE stream and log strip resize
 */

import { showToast, escapeHtml, formatTs, formatMeta } from './utils.js';

// ── Server log rendering ──────────────────────────────────────────────────────

/**
 * Append a server log entry to the bottom strip.
 *
 * @param {{ ts, level, msg, ...meta }} entry
 */
export function appendServerLog(entry) {
  const serverLog = document.getElementById('server-log');
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

// ── Log SSE stream ────────────────────────────────────────────────────────────

/**
 * Open an SSE connection to /api/logs/stream and pipe entries into the strip.
 * Automatically reconnects after 3 seconds if the connection drops unexpectedly.
 */
export function connectLogStream() {
  const logStripStatus = document.getElementById('log-strip-status');
  const es = new EventSource('/api/logs/stream');

  es.onopen    = () => { logStripStatus.classList.add('live'); };
  es.onmessage = (e) => { appendServerLog(JSON.parse(e.data)); };
  es.onerror   = () => {
    logStripStatus.classList.remove('live');
    es.close();
    setTimeout(connectLogStream, 3000);
  };
}

// ── Log strip resize ──────────────────────────────────────────────────────────
// Drag the handle upward to expand, downward to shrink.
// Height is clamped between 60px (collapsed) and 70% of the window.

export function initLogStripListeners() {
  const logResizeHandle  = document.getElementById('log-resize-handle');
  const logStrip         = document.getElementById('log-strip');
  const serverLog        = document.getElementById('server-log');
  const clearServerLogBtn = document.getElementById('clear-server-log-btn');

  clearServerLogBtn.addEventListener('click', () => { serverLog.innerHTML = ''; });

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
}
