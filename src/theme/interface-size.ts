// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The interface size: the percentage the whole interface is
// zoomed to, the same in every window. The backend applies it as the webview's
// zoom (store.rs INTERFACE_SIZES holds the same list); Settings offers
// these sizes. It is independent of the density and of the editor's text zoom.

/** The sizes offered, in percent, ascending. */
export const INTERFACE_SIZES = [80, 90, 100, 110, 125] as const;
/** The size before the user picks one: a step below the browser default. */
export const DEFAULT_INTERFACE_SIZE = 90;

/** The webview zoom factor for a size in percent. */
export const zoomFactor = (percent: number): number => percent / 100;
