#!/usr/bin/env node

/**
 * bin/launch.js — CLI entry point for droid-forge
 *
 * Usage:
 *   droid-forge /path/to/android/project
 *   npx droid-forge /path/to/android/project
 *
 * What it does:
 *   1. Validates the provided Android project path
 *   2. Sets ANDROID_PROJECT_ROOT so server.js knows what to serve
 *   3. Starts the Express server (server.js)
 *   4. Detects the device's Tailscale IP (if available) for remote access
 *   5. Opens the dashboard in the default browser
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Argument validation ───────────────────────────────────────────────────────

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error('\n  Usage: droid-forge /path/to/android/project\n');
  process.exit(1);
}

const resolved = path.resolve(projectRoot);

if (!fs.existsSync(resolved)) {
  console.error(`\n  Error: path does not exist: ${resolved}\n`);
  process.exit(1);
}

if (!fs.statSync(resolved).isDirectory()) {
  console.error(`\n  Error: not a directory: ${resolved}\n`);
  process.exit(1);
}

// ── Environment setup ─────────────────────────────────────────────────────────

process.env.ANDROID_PROJECT_ROOT = resolved;

const PORT = 3131;

// ── Tailscale IP detection ────────────────────────────────────────────────────
// Runs `tailscale ip -4` to get the device's Tailnet IPv4 address.
// Returns null if Tailscale is not installed or not connected.

function getTailscaleIP() {
  try {
    return execSync('tailscale ip -4 2>/dev/null', { timeout: 2000 })
      .toString()
      .trim()
      .split('\n')[0];
  } catch {
    return null;
  }
}

// ── Start server ──────────────────────────────────────────────────────────────

require('../server.js');

// Wait briefly for the server to bind before printing URLs and opening browser

setTimeout(async () => {
  const tsIP = getTailscaleIP();
  const localURL = `http://localhost:${PORT}`;
  const tailURL  = tsIP ? `http://${tsIP}:${PORT}` : null;

  try {
    const open = require('open');
    await open(localURL);
  } catch {
    // Not fatal — user can open manually
  }

  console.log(`\n  ◈ DROID FORGE`);
  console.log(`  Project : ${resolved}`);
  console.log(`  Local   : ${localURL}`);
  console.log(`  Tailnet : ${tailURL ?? '(tailscale not detected)'}`);
  console.log();
}, 800);
