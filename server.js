/**
 * server.js — Express backend for droidlane
 *
 * Responsibilities:
 *   - Serves the static frontend (public/) and Monaco Editor (node_modules)
 *   - File tree: recursive walk of the Android project, with sensible excludes
 *   - File read/write: safe path resolution guarded against traversal attacks
 *   - Git: list branches and checkout via simple-git
 *   - Build: spawns ./gradlew and streams output line-by-line over SSE
 *   - Server logs: an in-process event bus that streams structured log entries
 *     to the frontend's log strip panel via SSE
 *
 * Environment:
 *   ANDROID_PROJECT_ROOT — absolute path to the Android project (set by launch.js)
 *
 * Port: 3131 (hardcoded, bound to 0.0.0.0 for Tailscale/LAN access)
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const PROJECT_ROOT = process.env.ANDROID_PROJECT_ROOT;
const PORT = 3131;

if (!PROJECT_ROOT) {
  console.error('ANDROID_PROJECT_ROOT not set. Use: droidlane /path/to/project');
  process.exit(1);
}

// ── lib modules ───────────────────────────────────────────────────────────────
// Modules that read PROJECT_ROOT or env vars are require()d after the guard
// above to ensure the env var is present.

const { logBus, logBuffer, emitLog }              = require('./lib/logs');
const { ANDROID_STUDIO_JDK }                      = require('./lib/jdk');
const { walkTree, EXCLUDED_NAMES, EXCLUDED_PATHS } = require('./lib/tree');
const { safeResolve, findFile, findByExt, startSSE } = require('./lib/helpers');

// ── JDK detection feedback ────────────────────────────────────────────────────

if (ANDROID_STUDIO_JDK) {
  console.log(`  ☕ JDK  : ${ANDROID_STUDIO_JDK}`);
} else {
  console.warn('  ⚠ JDK  : Android Studio JDK not found — using system Java');
  console.warn('           Set ANDROID_STUDIO_JDK=/path/to/jbr to override');
}

// ── App setup ─────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Static: frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Static: Monaco Editor served locally to avoid CDN latency
app.use('/monaco', express.static(path.join(__dirname, 'node_modules/monaco-editor/min')));

// ── Request logger middleware ─────────────────────────────────────────────────
// Logs every API request with method, path, HTTP status, and latency.
// Skipped for /api/logs and /api/build (those are long-lived SSE streams).

app.use((req, res, next) => {
  if (req.path.startsWith('/api/logs') || req.path.startsWith('/api/build')) return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms    = Date.now() - start;
    const level = res.statusCode >= 400 ? 'error' : 'info';
    emitLog(level, `${req.method} ${req.path}`, { status: res.statusCode, ms });
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

const fileRoutes  = require('./routes/file');
const gitRoutes   = require('./routes/git');
const buildRoutes = require('./routes/build');
const configRoutes = require('./routes/config');
const logsRoutes  = require('./routes/logs');

app.use(fileRoutes({
  PROJECT_ROOT,
  walkTree,
  safeResolve,
  emitLog,
}));

app.use(gitRoutes({
  PROJECT_ROOT,
  emitLog,
}));

app.use(buildRoutes({
  PROJECT_ROOT,
  ANDROID_STUDIO_JDK,
  findByExt,
  startSSE,
  emitLog,
}));

app.use(configRoutes({
  PROJECT_ROOT,
  ANDROID_STUDIO_JDK,
  safeResolve,
  findFile,
  EXCLUDED_NAMES,
  emitLog,
}));

app.use(logsRoutes({
  logBus,
  logBuffer,
  startSSE,
}));

// ── Start ─────────────────────────────────────────────────────────────────────
// Bind to 0.0.0.0 so the dashboard is reachable over Tailscale / LAN,
// not just from localhost.

app.listen(PORT, '0.0.0.0', () => {
  emitLog('info', `Server started on port ${PORT}`, { action: 'server:start' });
  console.log(`  Server ready on port ${PORT}`);
});
