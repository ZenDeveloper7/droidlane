'use strict';

const path = require('path');
const fs   = require('fs');

// PROJECT_ROOT is needed by loadIgnore; it must be set in the environment
// before this module is first require()d.
const PROJECT_ROOT = process.env.ANDROID_PROJECT_ROOT;

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

  const dirs  = [];
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

module.exports = { loadIgnore, shouldExclude, walkTree, EXCLUDED_NAMES, EXCLUDED_PATHS };
