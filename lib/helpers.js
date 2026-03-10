'use strict';

const path = require('path');
const fs   = require('fs');

// PROJECT_ROOT must be set before this module is first require()d.
const PROJECT_ROOT = process.env.ANDROID_PROJECT_ROOT;

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

/**
 * Recursively searches a directory tree for the first file matching `filename`.
 * Skips directories listed in EXCLUDED_NAMES. Silent if the directory does not
 * exist.
 *
 * @param {string} dir           - absolute directory to search
 * @param {string} filename      - exact filename to look for (e.g. 'release.gradle')
 * @param {string} relBase       - path relative to PROJECT_ROOT (used to build return value)
 * @param {Set}    excludedNames - set of directory names to skip
 * @returns {string|null} relative path from PROJECT_ROOT, or null if not found
 */
function findFile(dir, filename, relBase, excludedNames) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isFile() && entry.name === filename) return rel;
    if (entry.isDirectory() && !excludedNames.has(entry.name)) {
      const found = findFile(path.join(dir, entry.name), filename, rel, excludedNames);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Recursively find all files with a given extension under a directory.
 * Silent if the directory does not exist.
 *
 * @param {string} dir - absolute directory to walk
 * @param {string} ext - extension including dot, e.g. '.aab'
 * @returns {string[]} absolute file paths
 */
function findByExt(dir, ext) {
  const results = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(ext)) results.push(full);
    }
  }
  walk(dir);
  return results;
}

// ── SSE helper ────────────────────────────────────────────────────────────────

/**
 * Configures a response for Server-Sent Events and flushes the headers.
 * Extracted here to avoid repeating the same three header lines in every
 * SSE endpoint.
 *
 * @param {import('express').Response} res
 */
function startSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

module.exports = { safeResolve, findFile, findByExt, startSSE };
