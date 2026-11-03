// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The short facts the welcome pane of the editor layout rotates through, beside the keyboard tips
// (which come from the action table, WelcomePane.tsx). Each is true of Kern as built, says nothing
// of other software and carries no version number, and names its source: a file of this
// repository and a symbol or phrase in it. welcome-content.test.ts opens each source and looks for
// the symbol, so a fact whose source moved or went fails there.

export interface WelcomeFact {
  /** The sentence shown. */
  text: string;
  /** The file, relative to the repository root, that makes it true. */
  source: string;
  /** What to look for in that file. */
  symbol: string;
}

export const WELCOME_FACTS: readonly WelcomeFact[] = [
  {
    // The content security policy allows only the application's own origin and the IPC channel
    // (tauri.conf.json app.security.csp, connect-src), and scripts/check-no-network.sh fails the
    // build when a source names a network API.
    text: "Kern never connects to the network: its pages may talk only to the application itself.",
    source: "src-tauri/tauri.conf.json",
    symbol: "connect-src ipc: http://ipc.localhost",
  },
  {
    // textOpen and textSave take the path of the file itself (src/ipc/kernkraft.ts): there is no
    // project, library or copy that a document is imported into.
    text: "Kern edits a file where it is. There is no project or library to add it to first.",
    source: "src/ipc/kernkraft.ts",
    symbol: "export const textSave",
  },
  {
    // The registry of open documents (OpenRegistry, route's Target::Focus) sends an open of a file
    // that is open anywhere, under any of its names, to the window that has it.
    text: "A file is never open twice: opening it again brings the window that has it forward.",
    source: "src-tauri/src/open.rs",
    symbol: "Target::Focus",
  },
  {
    // Moving a tab to a new window hands the editor's state over (HandedDoc, stateToHand), unsaved
    // text included.
    text: "A tab moved to a new window takes its unsaved text with it.",
    source: "src/shell/move-doc.ts",
    symbol: "export async function moveTabToWindow",
  },
  {
    // closeWindow asks about every document that closing would lose something of.
    text: "Closing a window with unsaved changes asks first. So does closing a tab.",
    source: "src/shell/useCloseGuard.ts",
    symbol: "export async function closeWindow",
  },
  {
    // A save expects the file as it was opened (TextExpect "unchanged"); a file another program
    // changed is not written over without a question (useTextDoc, ExternalModification).
    text: "If another program changes a file you are editing, Kern asks before it writes over it.",
    source: "src/editor/useTextDoc.ts",
    symbol: "ExternalModification",
  },
] as const;
