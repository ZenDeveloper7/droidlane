'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

/**
 * Config routes:
 *   GET  /api/project
 *   GET  /api/jdk
 *   GET  /api/default-file
 *   POST /api/default-file
 *   POST /api/flavour/apply
 */
module.exports = function configRoutes({ PROJECT_ROOT, ANDROID_STUDIO_JDK, safeResolve, findFile, EXCLUDED_NAMES, emitLog }) {
  const router = express.Router();

  /**
   * GET /api/project
   * Returns basic metadata about the loaded project.
   * Response: { name: string, root: string }
   */
  router.get('/api/project', (req, res) => {
    res.json({ name: path.basename(PROJECT_ROOT), root: PROJECT_ROOT });
  });

  /**
   * GET /api/jdk
   * Returns the JDK that will be used for Gradle builds.
   * Response: { path: string | null, source: 'android-studio' | 'system' }
   */
  router.get('/api/jdk', (req, res) => {
    res.json({
      path: ANDROID_STUDIO_JDK,
      source: ANDROID_STUDIO_JDK ? 'android-studio' : 'system',
    });
  });

  /**
   * GET /api/default-file
   * Returns the file to auto-open on dashboard startup.
   * Priority: .droidlane-config.json pinned file only.
   * Response: { path: string } | { path: null, prompt: true }
   */
  router.get('/api/default-file', (req, res) => {
    const configPath = path.join(PROJECT_ROOT, '.droidlane-config.json');
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.defaultFile) {
        try { safeResolve(config.defaultFile); return res.json({ path: config.defaultFile }); } catch {}
      }
    } catch {}

    // No pinned file — tell the frontend to prompt the user
    res.json({ path: null, prompt: true });
  });

  /**
   * POST /api/default-file
   * Saves the default file preference to .droidlane-config.json.
   * Body: { path: string }
   */
  router.post('/api/default-file', (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    try { safeResolve(filePath); } catch (err) { return res.status(400).json({ error: err.message }); }

    const configPath = path.join(PROJECT_ROOT, '.droidlane-config.json');
    let config = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    config.defaultFile = filePath;
    try {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      emitLog('error', `Failed to write config: ${err.message}`, { action: 'config:default-file' });
      return res.status(500).json({ error: err.message });
    }
    emitLog('info', `Default file set: ${filePath}`, { action: 'config:default-file' });
    res.json({ ok: true });
  });

  /**
   * POST /api/flavour/apply
   * Updates app/release.gradle to use the specified product flavour.
   * Replaces both the `apply from:` import and the `productFlavors` signing line.
   * Body: { flavour: string }
   */
  router.post('/api/flavour/apply', (req, res) => {
    const { flavour } = req.body;
    if (!flavour || !/^\w+$/.test(flavour)) return res.status(400).json({ error: 'invalid flavour name' });

    const releasePath = path.join(PROJECT_ROOT, 'app', 'release.gradle');
    if (!fs.existsSync(releasePath)) return res.status(404).json({ error: 'app/release.gradle not found' });

    let content;
    try {
      content = fs.readFileSync(releasePath, 'utf8');
    } catch (err) {
      emitLog('error', `Failed to read release.gradle: ${err.message}`, { action: 'flavour:apply' });
      return res.status(500).json({ error: err.message });
    }

    content = content.replace(
      /apply from:\s*['"]\.\/flavours\/\w+\.gradle['"]/,
      `apply from: './flavours/${flavour}.gradle'`
    );
    content = content.replace(
      /productFlavors\.\w+\.signingConfig\s+signingConfigs\.\w+/,
      `productFlavors.${flavour}.signingConfig signingConfigs.${flavour}`
    );

    try {
      fs.writeFileSync(releasePath, content, 'utf8');
    } catch (err) {
      emitLog('error', `Failed to write release.gradle: ${err.message}`, { action: 'flavour:apply' });
      return res.status(500).json({ error: err.message });
    }

    emitLog('info', `Flavour applied: ${flavour}`, { action: 'flavour:apply', flavour });
    res.json({ ok: true, flavour });
  });

  return router;
};
