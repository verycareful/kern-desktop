// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The two sides of a text box that can be dragged: the left side moves the box's left edge and the
// right side its right edge, so the box is as wide as the two edges leave it. Every number is a
// fraction of the displayed page's width, as the engine takes them.

/** The left and right edges of a box. */
export interface Sides {
  left: number;
  right: number;
}

/** How far a key moves a side, as a fraction of the page's width. */
export const KEY_STEP = 0.005;
/** The same, with Shift held. */
export const KEY_STEP_SHIFT = 0.02;

/** Two edges read twice are the same to within this many page fractions. */
const SAME_EDGE_TOLERANCE = 1e-6;

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), high);

/** The sides with the left edge moved to `left`: on the page and at least `min` short of the right edge. */
export function moveLeft(sides: Sides, left: number, min: number): Sides {
  return { left: clamp(left, 0, Math.max(0, sides.right - min)), right: sides.right };
}

/** The sides with the right edge moved to `right`: on the page and at least `min` past the left edge. */
export function moveRight(sides: Sides, right: number, min: number): Sides {
  return { left: sides.left, right: clamp(right, Math.min(1, sides.left + min), 1) };
}

/**
 * What the engine is told of a block's box that was dragged from `was`: nothing for a side that was
 * not moved. A moved left side is a `left` and the width up to the right edge; a moved right side
 * alone is a `width` from the block's own left edge (the engine keeps the left edge when it is given
 * a width only).
 */
export function boxChange(was: Sides, now: Sides): { left?: number; width?: number } {
  const leftMoved = Math.abs(now.left - was.left) > SAME_EDGE_TOLERANCE;
  const rightMoved = Math.abs(now.right - was.right) > SAME_EDGE_TOLERANCE;
  if (leftMoved) return { left: now.left, width: now.right - now.left };
  if (rightMoved) return { width: now.right - was.left };
  return {};
}
