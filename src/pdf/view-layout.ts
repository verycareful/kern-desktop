// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// How the pages of a PDF are set out: in one column (scroll), one page at a time (single), two
// side by side (spread) or in rows of several (grid). A layout is only which pages share a row;
// the sizes and the scroll belong to page-geometry.ts and PdfPages.tsx.

export type ViewLayout =
  { kind: "scroll" } | { kind: "single" } | { kind: "spread" } | { kind: "grid"; across: number };

/** The stored name of a layout (store.rs PdfLayout). */
export type ViewLayoutKind = ViewLayout["kind"];

export const VIEW_LAYOUT_KINDS: readonly ViewLayoutKind[] = ["scroll", "single", "spread", "grid"];

/** The grid's columns: the range Settings takes (store.rs PDF_GRID_ACROSS_MIN, PDF_GRID_ACROSS_MAX) and its default. */
export const GRID_ACROSS_MIN = 1;
export const GRID_ACROSS_MAX = 12;
export const GRID_ACROSS_DEFAULT = 4;

const SPREAD_ACROSS = 2;

/** `across` as a whole number inside the grid's range; a value that is not a number is the default. */
export function clampAcross(across: number): number {
  if (!Number.isFinite(across)) return GRID_ACROSS_DEFAULT;
  return Math.min(GRID_ACROSS_MAX, Math.max(GRID_ACROSS_MIN, Math.trunc(across)));
}

/** The layout a stored name and the stored grid columns stand for. */
export function layoutOf(kind: ViewLayoutKind, across: number): ViewLayout {
  return kind === "grid" ? { kind, across } : { kind };
}

/** The most pages a row of `layout` holds. */
export function acrossOf(layout: ViewLayout): number {
  switch (layout.kind) {
    case "scroll":
    case "single":
      return 1;
    case "spread":
      return SPREAD_ACROSS;
    case "grid":
      return clampAcross(layout.across);
  }
}

/** The pages of each row, counted from 0, in order; the last row may hold fewer. */
export function layoutRows(layout: ViewLayout, pages: number): number[][] {
  const across = acrossOf(layout);
  const rows: number[][] = [];
  for (let first = 0; first < pages; first += across) {
    const row: number[] = [];
    for (let page = first; page < Math.min(pages, first + across); page += 1) row.push(page);
    rows.push(row);
  }
  return rows;
}

/** The index of the row that holds `page`; 0 when none does. */
export function rowOfPage(rows: readonly (readonly number[])[], page: number): number {
  const row = rows.findIndex((pages) => pages.includes(page));
  return Math.max(0, row);
}
