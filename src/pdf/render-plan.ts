// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Region } from "../ipc";
import type { PageSize } from "./page-geometry";

// How a page is drawn at a width: one picture, or tiles when the page is larger than a picture
// may be. The engine draws at most 16384 pixels on a side and 1 GiB in a picture, and a canvas
// larger than the webview's limit draws nothing, so a large page is cut into tiles that each
// stay inside both. A page whose pixels would pass 1 GiB in all is drawn at the width that
// reaches it, and the browser scales that picture up to the width asked for.

/** The most pixels the engine draws on a side of a picture. */
export const MAX_SIDE_PX = 16384;
/** The most bytes of a picture, and of one page's pictures together. */
export const MAX_BYTES = 2 ** 30;
const BYTES_PER_PIXEL = 4;

export interface Tile {
  /** The part of the displayed page, as fractions of it. */
  region: Region;
  /** The width of the picture of this part. */
  widthPx: number;
}

export interface RenderPlan {
  /** The width of the whole page in pixels, after any clamp. */
  widthPx: number;
  /** The height of the whole page in pixels. */
  heightPx: number;
  /** The page was drawn narrower than asked, to stay inside `maxBytes`. */
  clamped: boolean;
  tiles: Tile[];
}

const bytesOf = (width: number, height: number): number => width * height * BYTES_PER_PIXEL;

/** `count` equal parts of `length` pixels, as [from, to] pairs on whole pixels. */
const spans = (length: number, count: number): [number, number][] =>
  Array.from({ length: count }, (_, i): [number, number] => [
    Math.round((i * length) / count),
    Math.round(((i + 1) * length) / count),
  ]);

export function planRender(
  page: PageSize,
  cssWidth: number,
  dpr: number,
  maxPx = MAX_SIDE_PX,
  maxBytes = MAX_BYTES
): RenderPlan {
  const aspect = page.heightPt / page.widthPt;
  const heightFor = (width: number) => Math.max(1, Math.round(width * aspect));
  const asked = Math.max(1, Math.round(cssWidth * dpr));
  let widthPx = asked;
  while (widthPx > 1 && bytesOf(widthPx, heightFor(widthPx)) > maxBytes) {
    // The estimate puts the width within a pixel of the answer; the loop settles the rest.
    const over = Math.sqrt(maxBytes / bytesOf(widthPx, heightFor(widthPx)));
    widthPx = Math.max(1, Math.min(widthPx - 1, Math.floor(widthPx * over)));
  }
  const heightPx = heightFor(widthPx);
  const side = Math.max(1, Math.min(maxPx, Math.floor(Math.sqrt(maxBytes / BYTES_PER_PIXEL))));
  const across = Math.ceil(widthPx / side);
  const down = Math.ceil(heightPx / side);
  const columns = spans(widthPx, across);
  const rows = spans(heightPx, down);
  const whole = across === 1 && down === 1;
  const tiles: Tile[] = rows.flatMap(([top, bottom]) =>
    columns.map(([left, right]): Tile => ({
      region: whole
        ? [0, 0, 1, 1]
        : [left / widthPx, top / heightPx, right / widthPx, bottom / heightPx],
      widthPx: right - left,
    }))
  );
  return { widthPx, heightPx, clamped: widthPx < asked, tiles };
}
