# ◈ Droid Forge

A futuristic terminal-style dashboard for Android projects — file editor, Gradle build console, and git branch switcher in one local web app. No cloud, no accounts, no build step.

![Dashboard aesthetic: dark matter terminal with cyan accents](https://raw.githubusercontent.com/ZenDeveloper7/droid-forge/main/docs/preview.png)

---

## Install

```bash
npm install -g droid-forge
```

Then point it at any Android project:

```bash
droid-forge /path/to/your/android/project
```

Opens `http://localhost:3131` automatically. No config needed.

---

## Or run without installing

```bash
npx droid-forge /path/to/your/android/project
```

---

## Features

| Panel | What it does |
|---|---|
| **Explorer** | File tree with collapsible dirs, active-file highlight, excludes build/generated dirs |
| **Editor** | Monaco Editor (same engine as VS Code) with a custom dark theme, Ctrl+S save, unsaved indicator |
| **Build Console** | One-click `assembleRelease` / `bundleRelease`, live Gradle output streamed line-by-line, cancel button |
| **Server Logs** | Real-time strip at the bottom — every API call, file save, git op, and build event |
| **Branch Switcher** | Searchable dropdown in the header, type-to-filter across all local + remote branches |
| **Tailscale / LAN** | Binds to `0.0.0.0`, prints your Tailnet URL on start so you can open it from any device |

---

## Usage

```
droid-forge <project-path>

  project-path   Absolute or relative path to the root of an Android project
                 (the directory that contains gradlew)
```

On launch you'll see:

```
  ◈ DROID FORGE
  Project : /home/you/projects/MyApp
  Local   : http://localhost:3131
  Tailnet : http://100.x.x.x:3131
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+S` / `Cmd+S` | Save current file |
| `Escape` | Close branch dropdown |
| `Enter` (in branch search) | Checkout first filtered branch |

---

## What gets excluded from the file tree

The explorer hides directories that are either generated or too large to be useful:

`build/` · `.gradle/` · `.git/` · `.idea/` · `node_modules/` · `captures/` · `amplify/` · `.vscode/` · `mobilertc/` · `app/src/`

---

## Architecture

```
droid-forge/
├── bin/
│   └── launch.js      # CLI entry point — validates path, detects Tailscale IP, opens browser
├── public/
│   ├── index.html     # Shell layout, all CSS, font imports
│   └── app.js         # Vanilla JS frontend — no framework, no bundler
├── server.js          # Express backend — file I/O, git, Gradle SSE, log bus
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
- Git (optional — branch switcher gracefully degrades if not a repo)
- Tailscale (optional — remote access feature only)

---

## Local development

```bash
git clone https://github.com/ZenDeveloper7/droid-forge
cd droid-forge
npm install
node bin/launch.js /path/to/android/project
```

---

## License

MIT
