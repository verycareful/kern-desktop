// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** The label of the window this page runs in ("main", "doc-<n>"), or null outside Tauri's webview. */
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
