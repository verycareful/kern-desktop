// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pdfPageInfo, type PdfHandle } from "../ipc";

// Where each page of a document sits in the scroll, and how large it is drawn. Sizes are the
// displayed ones: the engine gives a page's width and height after its rotation, so a rotated
// page is measured as it is and never swapped again here.

export type PageRotation = 0 | 90 | 180 | 270;

export interface PageSize {
  widthPt: number;
  heightPt: number;
  rotate: PageRotation;
}

/** CSS pixels to a point: a page at zoom 1 is as wide as it is printed, at 96 pixels to the inch. */
export const CSS_PX_PER_PT = 96 / 72;

/** The zoom a document may take, as the text editor's (store.rs ZOOM_MIN, ZOOM_MAX) in 25% steps. */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 0.25;

/** The gap between pages, and the margin around them, in CSS pixels. */
export const PAGE_GAP = 12;
export const PAGE_MARGIN = 16;

/** Pages asked about at once; a long document is not a thousand calls in flight. */
const SIZE_BATCH = 16;

const EPSILON = 1e-9;

/** How a page is scaled: to the width of the view, or by a factor of its printed size. */
export type Zoom = { fit: true } | { fit: false; factor: number };

export const FIT_WIDTH: Zoom = { fit: true };

export const clampZoom = (factor: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));

const rotation = (degrees: number): PageRotation => {
  const turn = ((degrees % 360) + 360) % 360;
  return turn === 90 || turn === 180 || turn === 270 ? turn : 0;
};

/**
 * The zoom one step above (`direction` 1) or below (-1) `factor`, on the multiples of
 * ZOOM_STEP and inside ZOOM_MIN to ZOOM_MAX. A factor between two steps goes to the nearer
 * step in that direction, so zooming in from a fit of 87% lands on 100%.
 */
export function stepZoom(factor: number, direction: 1 | -1): number {
  const steps = factor / ZOOM_STEP;
  const next = direction === 1 ? Math.floor(steps + EPSILON) + 1 : Math.ceil(steps - EPSILON) - 1;
  return clampZoom(next * ZOOM_STEP);
}

/** CSS pixels to a point that makes the widest page as wide as `viewWidth` leaves room for. */
export function fitScale(sizes: readonly PageSize[], viewWidth: number): number {
  const widest = sizes.reduce((w, s) => Math.max(w, s.widthPt), 0);
  const room = Math.max(1, viewWidth - 2 * PAGE_MARGIN);
  return widest > 0 ? room / widest : CSS_PX_PER_PT;
}

/** CSS pixels to a point for `zoom` in a view `viewWidth` wide. */
export function scaleOf(zoom: Zoom, sizes: readonly PageSize[], viewWidth: number): number {
  return zoom.fit ? fitScale(sizes, viewWidth) : clampZoom(zoom.factor) * CSS_PX_PER_PT;
}

/** The zoom factor a scale stands for, for showing and for stepping from a fit. */
export const factorOf = (scale: number): number => scale / CSS_PX_PER_PT;

/** Where a page sits in the scrolled content, in CSS pixels. */
export interface PageBox {
  top: number;
  width: number;
  height: number;
}

export interface PageBoxes {
  pages: PageBox[];
  /** The height of the whole scrolled content. */
  total: number;
}

/** The box of every page at `scale`, one under the other. */
export function pageBoxes(sizes: readonly PageSize[], scale: number): PageBoxes {
  const pages: PageBox[] = [];
  let y = PAGE_MARGIN;
  for (const size of sizes) {
    const height = size.heightPt * scale;
    pages.push({ top: y, width: size.widthPt * scale, height });
    y += height + PAGE_GAP;
  }
  return { pages, total: y - PAGE_GAP + PAGE_MARGIN };
}

/**
 * The page at `offset` from the top of the content: the page whose box holds it, or the one
 * above when it falls in a gap. 0 for an offset above the first page.
 */
export function pageAtOffset(pages: readonly { top: number }[], offset: number): number {
  let low = 0;
  let high = pages.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((pages[mid]?.top ?? Infinity) <= offset) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, low);
}

/**
 * The size of every page of the document, from the engine. `stale` is asked after each batch:
 * a document that went, or a view that no longer wants the answer, stops the reads.
 */
export async function pageSizes(
  handle: PdfHandle,
  pages: number,
  stale: () => boolean = () => false
): Promise<PageSize[]> {
  const sizes: PageSize[] = [];
  for (let first = 0; first < pages; first += SIZE_BATCH) {
    const last = Math.min(pages, first + SIZE_BATCH);
    const batch = await Promise.all(
      Array.from({ length: last - first }, (_, i) => pdfPageInfo(handle, first + i))
    );
    if (stale()) return sizes;
    for (const info of batch) {
      sizes.push({
        widthPt: info.width_pt,
        heightPt: info.height_pt,
        rotate: rotation(info.rotate),
      });
    }
  }
  return sizes;
}
