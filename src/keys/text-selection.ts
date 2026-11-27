// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The page's own text selection: words dragged over in a message, a dialog or a label, outside
// any field. Ctrl+C copies it when there is one (useShortcuts.ts), so each of Kern's own
// selections (files, Trash items, search hits, the tree's current row, a PDF's text) drops it
// when the user changes that selection. A page selection that is there is then always newer than
// any of Kern's, and Ctrl+C copies what was selected last.

/** True when keystrokes in `el` are text input: input, textarea, select or contenteditable. */
export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (el.closest("input, textarea, select")) return true;
  const ce = el.closest("[contenteditable]");
  return ce !== null && ce.getAttribute("contenteditable") !== "false";
}

/** The element holding `node`, or `node` itself when it is one. */
const elementOf = (node: Node | null): Element | null =>
  node instanceof Element ? node : (node?.parentElement ?? null);

/**
 * True when words of the page are selected outside any field. A selection that starts or ends in
 * a field is the field's: the field answers Ctrl+C itself, and an editor that has lost the focus
 * keeps its selection there without it being the page's.
 */
export function pageTextSelected(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString() === "") return false;
  return (
    !isEditable(elementOf(selection.anchorNode)) && !isEditable(elementOf(selection.focusNode))
  );
}

/** True when words of the page are selected and the selection starts and ends inside `root`. */
export function pageTextSelectedIn(root: Element | null): boolean {
  if (!root || !pageTextSelected()) return false;
  const selection = window.getSelection()!;
  return (
    selection.anchorNode !== null &&
    selection.focusNode !== null &&
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode)
  );
}

/** Drops the page's text selection, if there is one; a field's selection is left alone. */
export function dropPageTextSelection(): void {
  if (pageTextSelected()) window.getSelection()?.removeAllRanges();
}
