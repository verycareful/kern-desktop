// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Rect } from "../ipc/pdf";
import { failureText } from "./block-edit";
import type { PdfOpInput } from "./edit-state";
import type { PageText } from "./text-lines";
import type { PdfDoc } from "./usePdfDoc";

// New text on a page: where its box stands and how wide it runs, and what the engine is asked.
// Every place and width is a fraction of the displayed page, as the engine takes them; a turned
// page needs nothing of its own, since the engine sets the text upright on the page as shown.

/** The margin a page with no text to line up with keeps on its right, in points (one inch). */
export const PAGE_MARGIN_PT = 72;
/** The narrowest box new text is given, in points: about a short word at the sizes of body text. */
export const MIN_WIDTH_PT = 36;
/** How near, in CSS pixels, the end of a drag comes to a width of the page's text to take it. */
export const SNAP_PX = 8;
/** The size a page with no text to follow offers for new text, in points. */
export const DEFAULT_NEW_SIZE_PT = 12;
/** The sizes a page with no text to follow accepts, in points. */
export const NEW_SIZE_RANGE_PT = { min: 1, max: 1000 } as const;

/** Where new text goes: the top left corner of its box and the box's width. */
export interface NewTextPlace {
  /** Counted from 0. */
  page: number;
  at: [number, number];
  width: number;
}

/** The change that puts `text` in the box `place`. `size` only when the page has none to follow. */
export function addTextOp(place: NewTextPlace, text: string, size?: number): PdfOpInput {
  const op: PdfOpInput = {
    op: "addText",
    page: place.page,
    at: place.at,
    width: place.width,
    text,
  };
  return size === undefined ? op : { ...op, size };
}

/**
 * The right edge a box started at `x` runs to when no width was dragged: the furthest right edge
 * of the page's text, so new text lines up with the column it is put in; on a page with no text
 * past `x`, one margin short of the page's edge; and where even that is too near, the page's edge.
 */
export function defaultRight(text: PageText | null, x: number, widthPt: number): number {
  const min = MIN_WIDTH_PT / widthPt;
  const rights = (text?.blocks ?? []).map((b) => b.rect[2]).filter((right) => right >= x + min);
  if (rights.length > 0) return Math.max(...rights);
  const margin = 1 - PAGE_MARGIN_PT / widthPt;
  return margin >= x + min ? margin : 1;
}

/**
 * The right edge a drag that ends at `right` gives a box started at `left`: the nearest of the
 * page's own widths within `tolerance` (a block's right edge, so the text ends where a column
 * does, or `left` plus a block's width, so it is as wide as a block), else `right` itself.
 */
export function snapRight(
  text: PageText | null,
  left: number,
  right: number,
  tolerance: number
): number {
  let best = right;
  let distance = tolerance;
  for (const block of text?.blocks ?? []) {
    for (const candidate of [block.rect[2], left + block.rect[2] - block.rect[0]]) {
      const d = Math.abs(candidate - right);
      if (d <= distance && candidate > left && candidate <= 1) {
        best = candidate;
        distance = d;
      }
    }
  }
  return best;
}

/**
 * The box of new text from where the pointer went down and where it came up, in page fractions;
 * `dragged` is whether the pointer moved far enough to mean a width. The box starts at the left of
 * the two points, at the height the press was made, and is never narrower than the least width
 * nor past the page's edge. Null when there is no room for a box on the page there.
 */
export function placeNewText(args: {
  text: PageText | null;
  page: number;
  down: [number, number];
  up: [number, number];
  dragged: boolean;
  widthPt: number;
  cssWidth: number;
}): NewTextPlace | null {
  const { text, page, down, up, dragged, widthPt, cssWidth } = args;
  const min = MIN_WIDTH_PT / widthPt;
  const left = dragged ? Math.min(down[0], up[0]) : down[0];
  const y = down[1];
  if (left < 0 || left >= 1 || y < 0 || y >= 1) return null;
  const right = dragged
    ? snapRight(text, left, Math.max(down[0], up[0]), SNAP_PX / cssWidth)
    : defaultRight(text, left, widthPt);
  const width = Math.min(Math.max(right - left, min), 1 - left);
  return width > 0 ? { page, at: [left, y], width } : null;
}

/**
 * The line whose look new text at `at` is drawn with in its box while it is typed: a line of the
 * nearest block that can be edited. The engine chooses the style it sets; this is only the box.
 */
export function nearestLineRect(text: PageText | null, at: [number, number]): Rect | null {
  let best: Rect | null = null;
  let distance = Infinity;
  for (const block of text?.blocks ?? []) {
    if (!block.editable) continue;
    const d = distanceTo(block.rect, at);
    if (d >= distance) continue;
    const line = text?.lines.find((l) => l.block === block.id);
    if (!line) continue;
    best = line.rect;
    distance = d;
  }
  return best;
}

const distanceTo = (r: Rect, [x, y]: [number, number]): number => {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dy = Math.max(r[1] - y, 0, y - r[3]);
  return Math.hypot(dx, dy);
};

/** How a request to put new text on a page ended. */
export type NewTextResult =
  | { status: "done" }
  /** Nothing was changed and nothing went wrong: the copy question was cancelled. */
  | { status: "declined" }
  /** The page has no text to follow, so the text needs a size. */
  | { status: "needs-size" }
  | { status: "failed"; message: string };

/** Puts new text on a page, with `size` only when the page has no text to follow. */
export async function submitNewText(
  doc: PdfDoc,
  place: NewTextPlace,
  text: string,
  size?: number
): Promise<NewTextResult> {
  const outcome = await doc.applyChecked(addTextOp(place, text, size));
  switch (outcome.status) {
    case "applied":
      return { status: "done" };
    case "declined":
      return { status: "declined" };
    case "refused":
      return { status: "failed", message: outcome.message };
    case "failed":
      return outcome.error.kind === "NoSizeForNewText" && size === undefined
        ? { status: "needs-size" }
        : { status: "failed", message: failureText(outcome.error) };
  }
}
