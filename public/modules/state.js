/**
 * modules/state.js — single source of truth for all shared mutable state
 */

export const state = {
  currentFile: null,        // relative path of the file open in the editor
  pinnedFile: null,         // file set as default (auto-open on startup)
  isUnsaved: false,         // true when editor content differs from disk
  isBuildRunning: false,    // true while a Gradle build SSE stream is active
  buildBothPending: false,  // true when assembleRelease should auto-start after bundleRelease
  currentBranch: null,      // name of the checked-out git branch
  allBranches: [],          // full list returned by /api/git/branches
  buildEvtSource: null,     // active EventSource for the build stream
  editor: null,             // Monaco editor instance
  expandedDirs: new Set(),  // set of dir paths currently expanded in the tree
  monacoReady: false,       // true once the Monaco editor has finished initialising
  pendingFileLoad: null,    // path queued for loading before Monaco was ready
};
