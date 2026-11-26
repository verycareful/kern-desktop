// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the page operations decide before the engine is asked: the new order for a page that is
// dragged, and whether a set of pages may be removed. Pages are counted from 0.

/**
 * The order `pdf_apply` `reorder` takes when the page at `from` moves to stand at `to`: the list of
 * every page once, where position i holds the page that ends up there (kernkraft-pdf `reorder`).
 * Null when nothing would change or a page is not in the document.
 */
export function reorderOrder(pages: number, from: number, to: number): number[] | null {
  const inside = (n: number) => Number.isInteger(n) && n >= 0 && n < pages;
  if (!inside(from) || !inside(to) || from === to) return null;
  const order = Array.from({ length: pages }, (_, i) => i);
  order.splice(from, 1);
  order.splice(to, 0, from);
  return order;
}

/**
 * Where the page at `from` ends up when it is dropped into `gap`, the space before page `gap`
 * (`gap` equal to the page count is after the last page).
 */
export function moveTarget(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}

/** Why `selected` cannot be removed from a document of `pages` pages, or null when it can. */
export function refuseRemoval(pages: number, selected: readonly number[]): string | null {
  if (selected.length === 0) return "Choose the pages to remove first.";
  const missing = selected.find((p) => p < 0 || p >= pages);
  if (missing !== undefined) return `Page ${missing + 1} is not in this PDF.`;
  if (new Set(selected).size >= pages) return "A PDF keeps at least one page. Choose fewer pages.";
  return null;
}
