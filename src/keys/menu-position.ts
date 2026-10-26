// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

/** The top-left corner that keeps a w by h box inside a viewport, as near (x, y) as possible. */
export function clampToViewport(
  x: number,
  y: number,
  size: { w: number; h: number },
  view: { w: number; h: number }
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, view.w - size.w)),
    y: Math.max(0, Math.min(y, view.h - size.h)),
  };
}
