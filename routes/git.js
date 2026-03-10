'use strict';

const express    = require('express');
const { spawn }  = require('child_process');
const simpleGit  = require('simple-git');

// ── Branch name validation ────────────────────────────────────────────────────
// Rejects names that could be mistaken for git options or contain shell-unsafe
// characters. Allows the common subset: alphanumeric, hyphens, underscores,
// dots, and forward slashes (remote-tracking branches, e.g. origin/main).

const SAFE_BRANCH_RE = /^[a-zA-Z0-9._\-\/]+$/;

/**
 * Git routes: GET /api/git/branches, POST /api/git/checkout
 */
module.exports = function gitRoutes({ PROJECT_ROOT, emitLog }) {
  const router = express.Router();

  /**
   * GET /api/git/branches
   * Lists all local and remote branches in the project's git repo.
   * Response: { branches: string[], current: string }
   */
  router.get('/api/git/branches', async (req, res) => {
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
  router.post('/api/git/checkout', (req, res) => {
    const { branch } = req.body;
    if (!branch) return res.status(400).json({ error: 'branch required' });
    if (!SAFE_BRANCH_RE.test(branch)) return res.status(400).json({ error: 'invalid branch name' });

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

  return router;
};
