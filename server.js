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

const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const fs           = require('fs');
const { spawn }    = require('child_process');
const { EventEmitter } = require('events');
const simpleGit    = require('simple-git');

const PROJECT_ROOT = process.env.ANDROID_PROJECT_ROOT;
const PORT = 3131;

if (!PROJECT_ROOT) {
  console.error('ANDROID_PROJECT_ROOT not set. Use: droidlane /path/to/project');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Static: frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Static: Monaco Editor served locally to avoid CDN latency
app.use('/monaco', express.static(path.join(__dirname, 'node_modules/monaco-editor/min')));

// ── Log bus ───────────────────────────────────────────────────────────────────
//
// An in-process EventEmitter that collects structured log entries from all
// request handlers. The /api/logs/stream SSE endpoint fans these out to the
// browser in real time. A rolling buffer replays recent history to new clients.

const logBus = new EventEmitter();
logBus.setMaxListeners(50);

const LOG_BUFFER_SIZE = 200;
const logBuffer = [];

/**
 * Emit a structured log entry to connected clients and the local buffer.
 *
 * @param {'info'|'success'|'warn'|'error'} level - severity
 * @param {string} msg - human-readable message
 * @param {Object} [meta={}] - optional extra fields (action, status, ms, bytes, task, …)
 */
function emitLog(level, msg, meta = {}) {
  const entry = { ts: Date.now(), level, msg, ...meta };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  logBus.emit('log', entry);
}

// ── Request logger middleware ─────────────────────────────────────────────────
// Logs every API request with method, path, HTTP status, and latency.
// Skipped for /api/logs and /api/build (those are long-lived SSE streams).

app.use((req, res, next) => {
  if (req.path.startsWith('/api/logs') || req.path.startsWith('/api/build')) return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 400 ? 'error' : 'info';
    emitLog(level, `${req.method} ${req.path}`, { status: res.statusCode, ms });
  });
  next();
});

// ── Active build process ──────────────────────────────────────────────────────
// Only one Gradle build may run at a time.

let activeBuild = null;

// ── File tree helpers ─────────────────────────────────────────────────────────

/**
 * Load exclusions from .droidlane-ignore in the project root.
 *
 * File format (one entry per line):
 *   - Lines starting with # are comments
 *   - A bare name (e.g. "build") matches any directory with that name anywhere in the tree
 *   - A path with a slash (e.g. "app/src") matches that exact relative path or anything under it
 *
 * If the file doesn't exist, no directories are excluded (show everything).
 */
function loadIgnore() {
  const ignorePath = path.join(PROJECT_ROOT, '.droidlane-ignore');
  const names = new Set();
  const paths = [];
  try {
    const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (line.includes('/')) paths.push(line.replace(/\/$/, ''));
      else names.add(line);
    }
  } catch {
    // No ignore file — show all dirs
  }
  return { names, paths };
}

const { names: EXCLUDED_NAMES, paths: EXCLUDED_PATHS } = loadIgnore();

/**
 * Returns true if a tree entry should be hidden from the explorer.
 *
 * @param {string} relPath - path relative to PROJECT_ROOT
 * @param {string} name    - entry's basename
 * @param {boolean} isDir  - whether the entry is a directory
 */
function shouldExclude(relPath, name, isDir) {
  if (isDir && EXCLUDED_NAMES.has(name)) return true;
  for (const ex of EXCLUDED_PATHS) {
    if (relPath === ex || relPath.startsWith(ex + '/') || relPath.startsWith(ex + path.sep)) return true;
  }
  return false;
}

/**
 * Recursively walks a directory and returns a nested tree structure.
 * Directories come before files; both groups sorted alphabetically.
 *
 * @param {string} dir     - absolute path to walk
 * @param {string} relBase - path relative to PROJECT_ROOT (used for exclusion checks)
 * @returns {Array<{name, type, path, children?}>}
 */
function walkTree(dir, relBase) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs = [];
  const files = [];

  for (const entry of entries) {
    const rel   = relBase ? `${relBase}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory();
    if (shouldExclude(rel, entry.name, isDir)) continue;

    if (isDir) {
      dirs.push({
        name: entry.name,
        type: 'dir',
        path: rel,
        children: walkTree(path.join(dir, entry.name), rel),
      });
    } else {
      files.push({ name: entry.name, type: 'file', path: rel });
    }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...dirs, ...files];
}

/**
 * Resolves a client-supplied relative path to an absolute path,
 * rejecting any path that escapes PROJECT_ROOT (traversal guard).
 *
 * @param {string} relPath
 * @returns {string} absolute path
 * @throws {Error} if the resolved path is outside PROJECT_ROOT
 */
function safeResolve(relPath) {
  const abs = path.resolve(PROJECT_ROOT, relPath);
  if (!abs.startsWith(PROJECT_ROOT + path.sep) && abs !== PROJECT_ROOT) {
    throw new Error('Path traversal blocked');
  }
  return abs;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/tree
 * Returns the full file tree of the Android project as a nested JSON array.
 * Excludes generated/vendor directories defined in EXCLUDED_DIRS.
 */
app.get('/api/tree', (req, res) => {
  try {
    const tree = walkTree(PROJECT_ROOT, '');
    res.json({ tree, root: path.basename(PROJECT_ROOT) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/file?path=<relative-path>
 * Reads and returns the content of a file in the project.
 * Response: { content: string, path: string, modified: number (ms epoch) }
 */
app.get('/api/file', (req, res) => {
  const { path: relPath } = req.query;
  if (!relPath) return res.status(400).json({ error: 'path required' });

  try {
    const abs     = safeResolve(relPath);
    const stat    = fs.statSync(abs);
    const content = fs.readFileSync(abs, 'utf8');
    emitLog('cmd', `cat ${relPath}`, { action: 'file:read' });
    res.json({ content, path: relPath, modified: stat.mtimeMs });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/file
 * Writes content to a file in the project.
 * Body: { path: string, content: string }
 * Response: { ok: true, savedAt: number }
 */
app.post('/api/file', (req, res) => {
  const { path: relPath, content } = req.body;
  if (!relPath || content === undefined) {
    return res.status(400).json({ error: 'path and content required' });
  }

  try {
    const abs = safeResolve(relPath);
    fs.writeFileSync(abs, content, 'utf8');
    emitLog('success', `Saved ${relPath}`, { action: 'file:write', bytes: Buffer.byteLength(content) });
    res.json({ ok: true, savedAt: Date.now() });
  } catch (err) {
    emitLog('error', `Save failed: ${relPath} — ${err.message}`, { action: 'file:write' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/git/branches
 * Lists all local and remote branches in the project's git repo.
 * Response: { branches: string[], current: string }
 */
app.get('/api/git/branches', async (req, res) => {
  try {
    const git     = simpleGit(PROJECT_ROOT);
    const summary = await git.branch();
    res.json({ branches: summary.all, current: summary.current });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/git/checkout
 * Checks out a branch in the project's git repo.
 * Body: { branch: string }
 * Response: { ok: true } or { error: string }
 */
app.post('/api/git/checkout', (req, res) => {
  const { branch } = req.body;
  if (!branch) return res.status(400).json({ error: 'branch required' });

  emitLog('cmd', `git checkout ${branch}`, { action: 'git:checkout' });

  // Spawn git directly so we can stream progress lines to the log bus in real
  // time. simple-git buffers all output until the process exits, which makes
  // large checkouts feel frozen. --progress sends periodic status to stderr.
  const proc = spawn('git', ['checkout', branch, '--progress'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  const onLine = (line) => {
    if (line.trim()) emitLog('info', line.trim(), { action: 'git:checkout' });
  };

  proc.stdout.on('data', (d) => d.toString().split('\n').forEach(onLine));
  proc.stderr.on('data', (d) => d.toString().split('\n').forEach(onLine));

  proc.on('close', (code) => {
    if (code === 0) {
      emitLog('success', `Switched to ${branch}`, { action: 'git:checkout' });
      res.json({ ok: true });
    } else {
      emitLog('error', `Checkout failed (exit ${code})`, { action: 'git:checkout' });
      res.status(500).json({ error: `git exited with code ${code}` });
    }
  });

  proc.on('error', (err) => {
    emitLog('error', `Checkout error: ${err.message}`, { action: 'git:checkout' });
    res.status(500).json({ error: err.message });
  });
});

/**
 * GET /api/build?task=<gradleTask>
 * Spawns ./gradlew <task> and streams output over Server-Sent Events.
 *
 * Allowed tasks: assembleDebug, assembleRelease, bundleRelease, bundleDebug, clean
 *
 * SSE event shape: { type: 'out'|'err'|'done'|'fail', line: string, code?: number }
 *   - out/err: a line of stdout/stderr
 *   - done: build finished successfully (code 0)
 *   - fail: build failed (code != 0 or spawn error)
 *
 * Only one build may run at a time; returns 409 if one is already active.
 * The client can cancel via DELETE /api/build.
 */
app.get('/api/build', (req, res) => {
  const task = req.query.task || 'assembleDebug';
  const ALLOWED = ['assembleDebug', 'assembleRelease', 'bundleRelease', 'bundleDebug', 'clean'];
  if (!ALLOWED.includes(task)) return res.status(400).json({ error: 'unknown task' });
  if (activeBuild)             return res.status(409).json({ error: 'build already running' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // Prefer the project's own ./gradlew wrapper; fall back to system gradle
  const gradlew   = path.join(PROJECT_ROOT, 'gradlew');
  const useGradlew = fs.existsSync(gradlew);
  const cmd        = useGradlew ? gradlew : 'gradle';

  emitLog('cmd', `${useGradlew ? './gradlew' : 'gradle'} ${task}`, { action: 'build:start', task });
  send({ type: 'out', line: `$ ${useGradlew ? './gradlew' : 'gradle'} ${task}` });

  activeBuild = spawn(cmd, [task], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, TERM: 'dumb', GRADLE_OPTS: '-Dorg.gradle.console=plain' },
  });

  const streamLines = (type) => (data) => {
    for (const line of data.toString().split('\n')) {
      if (line.trim()) send({ type, line: line.trimEnd() });
    }
  };

  activeBuild.stdout.on('data', streamLines('out'));
  activeBuild.stderr.on('data', streamLines('err'));

  activeBuild.on('close', (code) => {
    activeBuild = null;
    if (code === 0) {
      emitLog('success', `Build succeeded: ${task}`, { action: 'build:done', task, code });
      send({ type: 'done', code: 0, line: 'BUILD SUCCESSFUL' });
    } else {
      emitLog('error', `Build failed: ${task} (exit ${code})`, { action: 'build:fail', task, code });
      send({ type: 'fail', code, line: `BUILD FAILED (exit ${code})` });
    }
    res.end();
  });

  activeBuild.on('error', (err) => {
    activeBuild = null;
    emitLog('error', `Build error: ${err.message}`, { action: 'build:error' });
    send({ type: 'fail', code: -1, line: `Error: ${err.message}` });
    res.end();
  });

  // If the browser disconnects, kill the build
  req.on('close', () => {
    if (activeBuild) { activeBuild.kill('SIGTERM'); activeBuild = null; }
  });
});

/**
 * DELETE /api/build
 * Cancels the currently running Gradle build by sending SIGTERM.
 * Response: { ok: boolean }
 */
app.delete('/api/build', (req, res) => {
  if (!activeBuild) return res.json({ ok: false, message: 'no active build' });
  activeBuild.kill('SIGTERM');
  activeBuild = null;
  emitLog('warn', 'Build cancelled by user', { action: 'build:cancel' });
  res.json({ ok: true });
});

/**
 * GET /api/logs/stream
 * Server-Sent Events stream of structured server log entries.
 * On connect, replays the last LOG_BUFFER_SIZE entries, then streams live.
 *
 * Entry shape: { ts: number, level: string, msg: string, ...meta }
 */
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Replay history to the new client
  for (const entry of logBuffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const onLog = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
  logBus.on('log', onLog);
  req.on('close', () => logBus.off('log', onLog));
});

/**
 * GET /api/project
 * Returns basic metadata about the loaded project.
 * Response: { name: string, root: string }
 */
app.get('/api/project', (req, res) => {
  res.json({ name: path.basename(PROJECT_ROOT), root: PROJECT_ROOT });
});

/**
 * GET /api/default-file
 * Returns the file to auto-open on dashboard startup.
 * Priority: .droidlane-config.json → first release.gradle found.
 * Response: { path: string | null }
 */
app.get('/api/default-file', (req, res) => {
  // 1. Persisted preference
  const configPath = path.join(PROJECT_ROOT, '.droidlane-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.defaultFile) {
      try { safeResolve(config.defaultFile); return res.json({ path: config.defaultFile }); } catch {}
    }
  } catch {}

  // 2. Search for release.gradle
  function findFile(dir, filename, relBase) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isFile() && entry.name === filename) return rel;
      if (entry.isDirectory() && !EXCLUDED_NAMES.has(entry.name)) {
        const found = findFile(path.join(dir, entry.name), filename, rel);
        if (found) return found;
      }
    }
    return null;
  }

  const releasePath = findFile(PROJECT_ROOT, 'release.gradle', '');
  res.json({ path: releasePath || null });
});

/**
 * POST /api/default-file
 * Saves the default file preference to .droidlane-config.json.
 * Body: { path: string }
 */
app.post('/api/default-file', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try { safeResolve(filePath); } catch (err) { return res.status(400).json({ error: err.message }); }

  const configPath = path.join(PROJECT_ROOT, '.droidlane-config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  config.defaultFile = filePath;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  emitLog('info', `Default file set: ${filePath}`, { action: 'config:default-file' });
  res.json({ ok: true });
});

/**
 * POST /api/flavour/apply
 * Updates app/release.gradle to use the specified product flavour.
 * Replaces both the `apply from:` import and the `productFlavors` signing line.
 * Body: { flavour: string }
 */
app.post('/api/flavour/apply', (req, res) => {
  const { flavour } = req.body;
  if (!flavour || !/^\w+$/.test(flavour)) return res.status(400).json({ error: 'invalid flavour name' });

  const releasePath = path.join(PROJECT_ROOT, 'app', 'release.gradle');
  if (!fs.existsSync(releasePath)) return res.status(404).json({ error: 'app/release.gradle not found' });

  let content = fs.readFileSync(releasePath, 'utf8');
  content = content.replace(
    /apply from:\s*['"]\.\/flavours\/\w+\.gradle['"]/,
    `apply from: './flavours/${flavour}.gradle'`
  );
  content = content.replace(
    /productFlavors\.\w+\.signingConfig\s+signingConfigs\.\w+/,
    `productFlavors.${flavour}.signingConfig signingConfigs.${flavour}`
  );

  fs.writeFileSync(releasePath, content, 'utf8');
  emitLog('info', `Flavour applied: ${flavour}`, { action: 'flavour:apply', flavour });
  res.json({ ok: true, flavour });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Bind to 0.0.0.0 so the dashboard is reachable over Tailscale / LAN,
// not just from localhost.

app.listen(PORT, '0.0.0.0', () => {
  emitLog('info', `Server started on port ${PORT}`, { action: 'server:start' });
  console.log(`  Server ready on port ${PORT}`);
});
