'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const { spawn } = require('child_process');

// ── Build task allow-list ─────────────────────────────────────────────────────
// Defined at module level to avoid reallocating the array on every request.

const ALLOWED_BUILD_TASKS = ['assembleDebug', 'assembleRelease', 'bundleRelease', 'bundleDebug', 'clean'];

/**
 * Build routes: GET /api/build, DELETE /api/build
 */
module.exports = function buildRoutes({ PROJECT_ROOT, ANDROID_STUDIO_JDK, findByExt, startSSE, emitLog }) {
  const router = express.Router();

  // ── Active build process ──────────────────────────────────────────────────────
  // Only one Gradle build may run at a time.
  let activeBuild = null;

  /**
   * GET /api/build?task=<gradleTask>
   * Spawns ./gradlew <task> and streams output over Server-Sent Events.
   *
   * Allowed tasks: assembleDebug, assembleRelease, bundleRelease, bundleDebug, clean
   *
   * SSE event shape: { type: 'out'|'err'|'done'|'fail'|'files', line?: string, code?: number }
   *   - out: a line of stdout
   *   - err: a line of stderr (including JDK warnings)
   *   - done: build finished successfully (code 0)
   *   - fail: build failed (code != 0 or spawn error)
   *   - files: artefacts copied to droidlane-output/ ({ files: string[], outputDir: string })
   *
   * Only one build may run at a time; returns 409 if one is already active.
   * The client can cancel via DELETE /api/build.
   */
  router.get('/api/build', (req, res) => {
    const task = req.query.task || 'assembleDebug';
    if (!ALLOWED_BUILD_TASKS.includes(task)) return res.status(400).json({ error: 'unknown task' });
    if (activeBuild)                         return res.status(409).json({ error: 'build already running' });

    startSSE(res);

    // Track whether the client has already disconnected so we don't write to a
    // closed response after the process fires its 'close' event.
    let clientGone = false;
    const send   = (obj) => { if (!clientGone) res.write(`data: ${JSON.stringify(obj)}\n\n`); };
    const finish = ()    => { if (!clientGone) res.end(); };

    // Prefer the project's own ./gradlew wrapper; fall back to system gradle
    const gradlew    = path.join(PROJECT_ROOT, 'gradlew');
    const useGradlew = fs.existsSync(gradlew);
    const cmd        = useGradlew ? gradlew : 'gradle';
    const cmdLabel   = useGradlew ? './gradlew' : 'gradle';

    emitLog('cmd', `${cmdLabel} ${task}`, { action: 'build:start', task });
    send({ type: 'out', line: `$ ${cmdLabel} ${task}` });

    if (ANDROID_STUDIO_JDK) {
      send({ type: 'out', line: `  JDK: ${ANDROID_STUDIO_JDK}` });
    } else {
      send({ type: 'err', line: '  Android Studio JDK not found — using system Java (may fail)' });
      send({ type: 'err', line: '    Set ANDROID_STUDIO_JDK=/path/to/jbr to fix' });
    }

    const buildEnv = {
      ...process.env,
      TERM: 'dumb',
      GRADLE_OPTS: '-Dorg.gradle.console=plain',
      ...(ANDROID_STUDIO_JDK ? { JAVA_HOME: ANDROID_STUDIO_JDK } : {}),
    };

    const buildStartTime = Date.now();
    activeBuild = spawn(cmd, [task], { cwd: PROJECT_ROOT, env: buildEnv });

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
        // Collect only artefacts produced during this build (mtime >= buildStartTime)
        // so that re-running a single flavour doesn't copy stale files from other flavours.
        const aabDir    = path.join(PROJECT_ROOT, 'app', 'build', 'outputs', 'bundle');
        const apkDir    = path.join(PROJECT_ROOT, 'app', 'build', 'outputs', 'apk');
        const artefacts = [...findByExt(aabDir, '.aab'), ...findByExt(apkDir, '.apk')]
          .filter(f => { try { return fs.statSync(f).mtimeMs >= buildStartTime; } catch { return false; } });
        const outputDir = path.join(PROJECT_ROOT, 'droidlane-output');

        if (artefacts.length) {
          try {
            fs.mkdirSync(outputDir, { recursive: true });
            const copied = [];
            for (const src of artefacts) {
              const dest = path.join(outputDir, path.basename(src));
              fs.copyFileSync(src, dest);
              copied.push(path.basename(src));
            }
            send({ type: 'files', files: copied, outputDir: 'droidlane-output' });
            emitLog('success', `Copied ${copied.length} file(s) → droidlane-output/`,
                    { action: 'build:files', task });
          } catch (copyErr) {
            send({ type: 'out', line: `[droidlane] copy warning: ${copyErr.message}` });
          }
        }

        emitLog('success', `Build succeeded: ${task}`, { action: 'build:done', task, code });
        send({ type: 'done', code: 0, line: 'BUILD SUCCESSFUL' });
      } else {
        emitLog('error', `Build failed: ${task} (exit ${code})`, { action: 'build:fail', task, code });
        send({ type: 'fail', code, line: `BUILD FAILED (exit ${code})` });
      }
      finish();
    });

    activeBuild.on('error', (err) => {
      activeBuild = null;
      emitLog('error', `Build error: ${err.message}`, { action: 'build:error' });
      send({ type: 'fail', code: -1, line: `Error: ${err.message}` });
      finish();
    });

    // If the browser disconnects, kill the build
    req.on('close', () => {
      clientGone = true;
      if (activeBuild) { activeBuild.kill('SIGTERM'); activeBuild = null; }
    });
  });

  /**
   * DELETE /api/build
   * Cancels the currently running Gradle build by sending SIGTERM.
   * Response: { ok: boolean }
   */
  router.delete('/api/build', (req, res) => {
    if (!activeBuild) return res.json({ ok: false, message: 'no active build' });
    activeBuild.kill('SIGTERM');
    activeBuild = null;
    emitLog('warn', 'Build cancelled by user', { action: 'build:cancel' });
    res.json({ ok: true });
  });

  return router;
};
