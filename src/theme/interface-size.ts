// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The interface size (design 7.2): the percentage the whole interface is
// zoomed to, the same in every window. The backend applies it as the webview's
// zoom (store.rs INTERFACE_SIZES holds the same list); this file steps through
// the sizes. It is independent of the density and of the editor's text zoom.

/** The sizes offered, in percent, ascending. */
export const INTERFACE_SIZES = [80, 90, 100, 110, 125] as const;
/** Slightly smaller than the browser default (maintainer, 2026-10-28). */
export const DEFAULT_INTERFACE_SIZE = 90;

/**
 * The size one step up (`1`) or down (`-1`) from `current`, never beyond the
 * ends. A value that is not one of the sizes moves to the nearest size in
 * the direction asked.
 */
export function stepInterfaceSize(current: number, direction: 1 | -1): number {
  const first = INTERFACE_SIZES[0];
  const last = INTERFACE_SIZES[INTERFACE_SIZES.length - 1]!;
  if (direction === 1) return INTERFACE_SIZES.find((s) => s > current) ?? last;
  return [...INTERFACE_SIZES].reverse().find((s) => s < current) ?? first;
}

/** The webview zoom factor for a size in percent. */
export const zoomFactor = (percent: number): number => percent / 100;
