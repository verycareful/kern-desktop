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

/**
 * Where a submenu of a w by h box goes for the row it opens from: beside the row, level with its
 * top, on the right unless that runs past the viewport and then on the left, and moved up to stay
 * above the bottom edge.
 */
export function submenuPosition(
  row: { left: number; right: number; top: number },
  size: { w: number; h: number },
  view: { w: number; h: number }
): { x: number; y: number } {
  const fitsRight = row.right + size.w <= view.w;
  return {
    x: fitsRight ? row.right : Math.max(0, row.left - size.w),
    y: Math.max(0, Math.min(row.top, view.h - size.h)),
  };
}
