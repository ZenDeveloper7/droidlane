'use strict';

const express = require('express');
const fs      = require('fs');

/**
 * File routes: GET /api/tree, GET /api/file, POST /api/file
 */
module.exports = function fileRoutes({ PROJECT_ROOT, walkTree, safeResolve, emitLog }) {
  const router = express.Router();
  const path   = require('path');

  /**
   * GET /api/tree
   * Returns the full file tree of the Android project as a nested JSON array.
   * Excludes generated/vendor directories defined in EXCLUDED_NAMES and EXCLUDED_PATHS.
   */
  router.get('/api/tree', (req, res) => {
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
  router.get('/api/file', (req, res) => {
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
  router.post('/api/file', (req, res) => {
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

  return router;
};
