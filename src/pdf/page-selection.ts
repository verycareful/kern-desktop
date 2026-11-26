// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// The pages chosen in a PDF tab's thumbnail strip or grid, kept by tab id so the strip, the grid
// and the actions (rotate, remove, extract) read the same choice. Pages are counted from 0.

export interface PageSelection {
  /** Sorted, each page once. */
  pages: readonly number[];
  /** The page a Shift-click extends from; null when no page was clicked since the last change. */
  anchor: number | null;
}

export interface ClickKeys {
  ctrl: boolean;
  shift: boolean;
}

export const EMPTY: PageSelection = { pages: [], anchor: null };

const sorted = (pages: Iterable<number>): number[] => [...new Set(pages)].sort((a, b) => a - b);

/** The selection after a click on `page` with the keys held. */
export function afterClick(before: PageSelection, page: number, keys: ClickKeys): PageSelection {
  if (keys.shift) {
    const from = before.anchor ?? page;
    const [lo, hi] = from <= page ? [from, page] : [page, from];
    const run = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const pages = keys.ctrl ? sorted([...before.pages, ...run]) : run;
    return { pages, anchor: from };
  }
  if (keys.ctrl) {
    const has = before.pages.includes(page);
    const pages = has ? before.pages.filter((p) => p !== page) : sorted([...before.pages, page]);
    return { pages, anchor: page };
  }
  return { pages: [page], anchor: page };
}

/** `selection` without the pages a document of `count` pages does not have. */
export function clamped(selection: PageSelection, count: number): PageSelection {
  if (selection.pages.every((p) => p < count)) return selection;
  return { pages: selection.pages.filter((p) => p < count), anchor: null };
}

interface PageSelectionState {
  byTab: Record<string, PageSelection>;
  /** Applies a click on `page` of a document of `count` pages. */
  click(tabId: string, page: number, count: number, keys: ClickKeys): void;
  /** Chooses exactly `pages`. */
  set(tabId: string, pages: readonly number[]): void;
  /** Drops the pages beyond `count`. */
  fit(tabId: string, count: number): void;
  clear(tabId: string): void;
}

export const usePageSelection = create<PageSelectionState>()((set) => ({
  byTab: {},
  click: (tabId, page, count, keys) =>
    set((s) => {
      if (page < 0 || page >= count) return s;
      return { byTab: { ...s.byTab, [tabId]: afterClick(s.byTab[tabId] ?? EMPTY, page, keys) } };
    }),
  set: (tabId, pages) =>
    set((s) => {
      const list = sorted(pages);
      const anchor = list.length > 0 ? (list[list.length - 1] ?? null) : null;
      return { byTab: { ...s.byTab, [tabId]: { pages: list, anchor } } };
    }),
  fit: (tabId, count) =>
    set((s) => {
      const before = s.byTab[tabId];
      if (!before) return s;
      const after = clamped(before, count);
      if (after === before) return s;
      const rest = { ...s.byTab };
      if (after.pages.length === 0) delete rest[tabId];
      else rest[tabId] = after;
      return { byTab: rest };
    }),
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));

/** The pages chosen in a tab; none when nothing is. */
export const selectedPages = (tabId: string): readonly number[] =>
  usePageSelection.getState().byTab[tabId]?.pages ?? [];
