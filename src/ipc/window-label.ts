// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** The label of the window this page runs in ("main", "doc-<n>", "editor-<n>"), or null outside Tauri's webview. */
export function currentWindowLabel(): string | null {
  const internals = (
    window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? null;
}

/**
 * Whether this page is the main (browsing) window. A page with no window label
 * is the browser preview used for development and the Playwright runs: it
 * stands in for the main window there.
 */
export function isMainWindow(): boolean {
  const label = currentWindowLabel();
  return label === null || label === "main";
}

/** Whether this page is a standalone document window (`doc-<n>`). */
export function isDocumentWindow(): boolean {
  return /^doc-\d+$/.test(currentWindowLabel() ?? "");
}

/** Whether this page is an editor window (`editor-<n>`): tabs of documents and a tree. */
export function isEditorWindow(): boolean {
  return /^editor-\d+$/.test(currentWindowLabel() ?? "");
}

/** The label tabs of this window are registered under: the page's own, or "main" in the browser preview. */
export function tabWindow(): string {
  return currentWindowLabel() ?? "main";
}
