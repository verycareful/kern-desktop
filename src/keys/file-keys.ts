// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The keys of the file operations (Delete, Ctrl+C, F2 and the others of an action
// with `scope: "view"`) belong to the folder view and the tab row above it. The
// elements that hold them carry this attribute; the same key in another pane
// (the Places strip, Pinned and Recent) is that pane's, and does nothing to the
// folder's selection.
export const FILE_KEYS_ATTR = "data-file-keys";

/** True when a key aimed at `target` may run a file operation: inside the view or the tab row, or aimed at nothing in particular (the window, the page body). */
export function inFileKeysArea(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement) return true;
  return target.closest(`[${FILE_KEYS_ATTR}]`) !== null;
}
