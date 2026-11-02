// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The keys of the file operations (Delete, Ctrl+C, F2 and the others of an action
// with `scope: "view"`) belong to the folder view and the tab row above it. The
// elements that hold them carry this attribute; the same key in another pane
// (the Places strip, Pinned and Recent) is that pane's, and does nothing to the
// folder's selection. A part of the view that shows something other than the
// folder's items (the results of a search) carries NO_FILE_KEYS_ATTR, and the
// nearer of the two attributes decides: the folder's selection is not on show
// there, so no key may act on it.
export const FILE_KEYS_ATTR = "data-file-keys";
export const NO_FILE_KEYS_ATTR = "data-no-file-keys";

/** True when a key aimed at `target` may run a file operation: inside the view or the tab row, or aimed at nothing in particular (the window, the page body). */
export function inFileKeysArea(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement) return true;
  const zone = target.closest(`[${FILE_KEYS_ATTR}], [${NO_FILE_KEYS_ATTR}]`);
  return zone !== null && zone.hasAttribute(FILE_KEYS_ATTR);
}
