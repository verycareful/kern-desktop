// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// Where a page dragged over the thumbnails or the grid would be dropped, as a gap between pages:
// gap g is the space before page g, and the gap after the last page is the page count.

export interface PageBox {
  page: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How far `at` is from the span `[low, high]`; 0 inside it. */
const outside = (at: number, low: number, high: number) =>
  at < low ? low - at : at > high ? at - high : 0;

/**
 * The gap nearest `point`. The row nearest the point vertically is found first (a column's rows
 * are its pages), then the page in it nearest horizontally; the gap is the one before that page
 * when the point is before its centre along `axis` (`y` for a column of thumbnails, `x` for a row
 * or a grid), else the one after it. Null when there are no boxes.
 */
export function gapAt(point: Point, boxes: readonly PageBox[], axis: "x" | "y"): number | null {
  let best: PageBox | null = null;
  let bestRow = Infinity;
  let bestAcross = Infinity;
  for (const box of boxes) {
    const row = outside(point.y, box.top, box.bottom);
    const across = outside(point.x, box.left, box.right);
    if (row < bestRow || (row === bestRow && across < bestAcross)) {
      best = box;
      bestRow = row;
      bestAcross = across;
    }
  }
  if (!best) return null;
  const centre = axis === "y" ? (best.top + best.bottom) / 2 : (best.left + best.right) / 2;
  const at = axis === "y" ? point.y : point.x;
  return at < centre ? best.page : best.page + 1;
}
