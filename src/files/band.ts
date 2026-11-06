// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Where the items are, in the coordinates of the scrolled content. The list is
// one column of rows; the grid is rows of cards with `gap` between them, the
// first card `padding` from the left edge, and `rowHeight` the pitch from one
// row of cards to the next (card height plus gap).
export type Layout =
  | { kind: "list"; rowHeight: number; count: number }
  | {
      kind: "grid";
      count: number;
      columns: number;
      cardWidth: number;
      cardHeight: number;
      gap: number;
      padding: number;
      rowHeight: number;
    };

/** The indices of the items a rubber band touches, ascending. */
export function bandIndices(layout: Layout, band: Rect): number[] {
  const out: number[] = [];
  if (band.right <= band.left || band.bottom <= band.top) return out;
  if (layout.kind === "list") {
    const first = Math.max(0, Math.floor(band.top / layout.rowHeight));
    const last = Math.min(layout.count - 1, Math.ceil(band.bottom / layout.rowHeight) - 1);
    for (let i = first; i <= last; i++) out.push(i);
    return out;
  }
  const colPitch = layout.cardWidth + layout.gap;
  const rowFirst = Math.max(0, Math.floor(band.top / layout.rowHeight));
  const rowLast = Math.floor((band.bottom - Number.EPSILON) / layout.rowHeight);
  const colFirst = Math.max(0, Math.floor((band.left - layout.padding) / colPitch));
  const colLast = Math.min(
    layout.columns - 1,
    Math.floor((band.right - layout.padding - Number.EPSILON) / colPitch)
  );
  for (let r = rowFirst; r <= rowLast; r++) {
    const top = r * layout.rowHeight;
    if (top >= band.bottom || top + layout.cardHeight <= band.top) continue;
    for (let c = colFirst; c <= colLast; c++) {
      const left = layout.padding + c * colPitch;
      if (left >= band.right || left + layout.cardWidth <= band.left) continue;
      const i = r * layout.columns + c;
      if (i < layout.count) out.push(i);
    }
  }
  return out;
}
