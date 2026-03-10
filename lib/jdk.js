'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── Android Studio JDK detection ──────────────────────────────────────────────
//
// Android Studio ships a bundled JBR (JetBrains Runtime). Using it instead of
// the system Java avoids version-mismatch errors like:
//   "Unsupported class file major version 69" (Java 25 on PATH, AGP needs ≤21)
//
// Search order:
//   1. ANDROID_STUDIO_JDK env var (explicit user override)
//   2. Common Android Studio install paths per platform
//   3. null  →  fall back to whatever java is on PATH

function findAndroidStudioJdk() {
  if (process.env.ANDROID_STUDIO_JDK) {
    const override = process.env.ANDROID_STUDIO_JDK;
    const bin = path.join(override, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(bin)) return override;
    console.warn(`[droidlane] ANDROID_STUDIO_JDK set but java not found at: ${bin}`);
  }

  const home = os.homedir();
  const candidates = {
    linux: [
      '/opt/android-studio/jbr',
      '/usr/local/android-studio/jbr',
      `${home}/android-studio/jbr`,
      `${home}/.local/share/JetBrains/Toolbox/apps/AndroidStudio/ch-0/current/jbr`,
      '/snap/android-studio/current/android-studio/jbr',
    ],
    darwin: [
      '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
      '/Applications/Android Studio.app/Contents/jre/Contents/Home',
      '/Applications/Android Studio.app/Contents/jre/jdk/Contents/Home',
    ],
    win32: [
      'C:\\Program Files\\Android Studio\\jbr',
      `${home}\\AppData\\Local\\Programs\\Android Studio\\jbr`,
    ],
  }[process.platform] || [];

  for (const candidate of candidates) {
    const bin = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (fs.existsSync(bin)) return candidate;
  }
  return null;
}

const ANDROID_STUDIO_JDK = findAndroidStudioJdk();

module.exports = { findAndroidStudioJdk, ANDROID_STUDIO_JDK };
