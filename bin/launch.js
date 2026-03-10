#!/usr/bin/env node

/**
 * bin/launch.js — CLI entry point for droidlane
 *
 * Usage:
 *   droidlane /path/to/android/project
 *   npx droidlane /path/to/android/project
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

// ── Sub-commands ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// droidlane ignore <name1> [name2 ...] [--project /path]
// Appends one or more names to .droidlane-ignore in the given project (default: cwd)
if (args[0] === 'ignore') {
  const rest = args.slice(1);
  const projFlagIdx = rest.indexOf('--project');
  let projectDir;
  let names;
  if (projFlagIdx !== -1) {
    projectDir = path.resolve(rest[projFlagIdx + 1] || process.cwd());
    names = rest.filter((_, i) => i !== projFlagIdx && i !== projFlagIdx + 1);
  } else {
    projectDir = process.cwd();
    names = rest;
  }
  if (!names.length) {
    console.error('\n  Usage: droidlane ignore <name1> [name2 ...] [--project /path]\n');
    process.exit(1);
  }
  const ignorePath = path.join(projectDir, '.droidlane-ignore');
  let existing = '';
  try { existing = fs.readFileSync(ignorePath, 'utf8'); } catch {}
  const existingSet = new Set(existing.split('\n').map(l => l.trim()));
  let appended = '';
  const added = [], skipped = [];
  for (const name of names) {
    if (existingSet.has(name)) { skipped.push(name); continue; }
    appended += `${name}\n`;
    existingSet.add(name);
    added.push(name);
  }
  if (appended) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(ignorePath, `${prefix}${appended}`);
    console.log(`  Added to ${ignorePath}: ${added.map(n => `"${n}"`).join(', ')}`);
  }
  if (skipped.length) {
    console.log(`  Already present: ${skipped.map(n => `"${n}"`).join(', ')}`);
  }
  process.exit(0);
}

// ── Argument validation ───────────────────────────────────────────────────────

const projectRoot = args[0];

if (!projectRoot) {
  console.error('\n  Usage: droidlane /path/to/android/project\n');
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

  console.log(`\n  ◈ DROIDLANE`);
  console.log(`  Project : ${resolved}`);
  console.log(`  Local   : ${localURL}`);
  console.log(`  Tailnet : ${tailURL ?? '(tailscale not detected)'}`);
  console.log();
}, 800);
