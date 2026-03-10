# ◈ DroidLane

A futuristic terminal-style dashboard for Android projects — file editor, Gradle build console, and git branch switcher in one local web app. No cloud, no accounts, no build step.

![Dashboard aesthetic: dark matter terminal with cyan accents](https://raw.githubusercontent.com/ZenDeveloper7/droidlane/main/docs/preview.png)

---

## Install

**Via npm** *(recommended)*
```bash
npm install -g droidlane
droidlane /path/to/your/android/project
```

**Without installing** *(npx, runs latest version every time)*
```bash
npx droidlane /path/to/your/android/project
```

**Directly from GitHub** *(no npm account needed)*
```bash
npm install -g github:ZenDeveloper7/droidlane
droidlane /path/to/your/android/project
```

**From a release tarball** *(offline/air-gapped)*
```bash
# Download droidlane-x.x.x.tgz from GitHub Releases, then:
npm install -g ./droidlane-1.0.0.tgz
droidlane /path/to/your/android/project
```

---

## Features

| Panel | What it does |
|---|---|
| **Explorer** | File tree with collapsible dirs, file search, active-file highlight |
| **Editor** | Monaco Editor (same engine as VS Code) with a custom dark theme, Ctrl+S save, unsaved indicator |
| **Build Console** | One-click `assembleRelease` / `bundleRelease`, live Gradle output streamed line-by-line, cancel button, copy errors |
| **Server Logs** | Real-time strip at the bottom — every API call, file save, git op, and build event |
| **Branch Switcher** | Searchable dropdown in the header, type-to-filter across all local + remote branches |
| **Tailscale / LAN** | Binds to `0.0.0.0`, prints your Tailnet URL on start so you can open it from any device |
| **Flavour Build** | Open any file in `flavours/` → "Add to Build List" updates `release.gradle` in one click |

---

## Usage

```
droidlane <project-path>

  project-path   Absolute or relative path to the root of an Android project
                 (the directory that contains gradlew)
```

On launch you'll see:

```
  ◈ DROIDLANE
  Project : /home/you/projects/MyApp
  Local   : http://localhost:3131
  Tailnet : http://100.x.x.x:3131
  ☕ JDK  : /opt/android-studio/jbr
```

---

## Android Studio JDK (automatic)

Droidlane automatically finds and uses the JDK bundled with Android Studio for all Gradle builds. This prevents the common error:

```
Unsupported class file major version 69
```

which occurs when the system Java is newer than what the Android Gradle Plugin supports.

**How it works:** At startup droidlane searches the standard Android Studio install paths for the bundled JBR and sets `JAVA_HOME` before spawning Gradle. The detected JDK is shown in the terminal output and in the Build Console panel.

**If the JDK is not detected automatically**, set it manually:

```bash
# One-time for the current shell session:
ANDROID_STUDIO_JDK=/path/to/android-studio/jbr droidlane /path/to/project

# Permanently (add to ~/.bashrc or ~/.zshrc):
export ANDROID_STUDIO_JDK=/path/to/android-studio/jbr
```

Common paths by platform:

| Platform | Path |
|---|---|
| Linux | `/opt/android-studio/jbr` |
| macOS | `/Applications/Android Studio.app/Contents/jbr/Contents/Home` |
| Windows | `C:\Program Files\Android Studio\jbr` |

---

## CLI commands

```bash
# Launch the dashboard
droidlane /path/to/project

# Add a folder to .droidlane-ignore (hide from file explorer)
droidlane ignore <folder-name> [project-path]
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` / `Cmd+S` | Save current file |
| `Escape` | Close branch dropdown |
| `Enter` (in branch search) | Checkout first filtered branch |

---

## Excluding folders from the file tree

By default droidlane shows **all** directories. To hide folders, create a `.droidlane-ignore` file in your project root:

```
# .droidlane-ignore

# Bare name → hides any dir with that name anywhere in the tree
build
.gradle
node_modules
.git
.idea

# Path with slash → hides that exact relative path and everything under it
app/src
```

- Lines starting with `#` are comments
- Use `droidlane ignore <folder>` to add entries from the terminal
- Delete the file (or leave it empty) to show everything

---

## Default file (auto-open on startup)

Droidlane auto-opens `release.gradle` on startup if it exists in the project.
For other projects, hover any file in the explorer and click the **⊙** pin icon to set it as the default.
The preference is saved to `.droidlane-config.json` in the project root.

---

## Architecture

```
droidlane/
├── bin/
│   └── launch.js      # CLI entry point — validates path, detects Tailscale IP, opens browser
├── public/
│   ├── index.html     # Shell layout, all CSS, font imports
│   └── app.js         # Vanilla JS frontend — no framework, no bundler
├── server.js          # Express backend — file I/O, git, Gradle SSE, log bus, JDK detection
└── package.json
```

**Backend** — Express on port 3131, bound to `0.0.0.0`.
**Frontend** — Pure ES modules in the browser. Monaco Editor served locally (no CDN, instant load).
**Build output** — Streamed over Server-Sent Events so you see output as Gradle produces it.
**Server logs** — An in-process event bus fans structured log entries to the bottom strip via SSE.

---

## Requirements

- Node.js ≥ 18
- An Android project with a `gradlew` wrapper (or `gradle` on PATH)
- Android Studio installed (for automatic JDK detection — optional but recommended)
- Git (optional — branch switcher gracefully degrades if not a repo)
- Tailscale (optional — remote access feature only)

---

## Releases

Latest release and all tarballs: [github.com/ZenDeveloper7/droidlane/releases](https://github.com/ZenDeveloper7/droidlane/releases)

---

## Local development

```bash
git clone https://github.com/ZenDeveloper7/droidlane
cd droidlane
npm install
node bin/launch.js /path/to/android/project
```

---

## License

MIT
