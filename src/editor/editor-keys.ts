// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";

// The keys the text editor binds itself. The window's own shortcuts (keys/actions.ts) must not
// collide with them: a key the editor binds inside the text is taken by the editor first.

/** Mod-d selects the next occurrence in CodeMirror's search keymap; Kern gives Ctrl+D to Pin. */
export const KEYS = [
  ...defaultKeymap,
  ...historyKeymap,
  ...searchKeymap.filter((k) => k.key !== "Mod-d"),
];
