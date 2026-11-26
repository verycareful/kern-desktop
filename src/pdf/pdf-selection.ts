// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { CharRef } from "./selection";

// The selected text of a PDF tab and the request "search for it", keyed by tab id. The text layer
// of a page writes the selection while the pointer drags; the actions (Copy, Select all) and the
// menu read it, so none of them needs the page's React tree.

/** A selection on one page, from where it began to where it ends (either way round). */
export interface PdfSelection {
  /** Counted from 0. */
  page: number;
  from: CharRef;
  to: CharRef;
}

export interface SearchRequest {
  text: string;
  /** Grows with every request, so asking for the same text twice is two requests. */
  seq: number;
}

interface PdfSelectionState {
  byTab: Record<string, PdfSelection>;
  searches: Record<string, SearchRequest>;
  select(tabId: string, selection: PdfSelection): void;
  clear(tabId: string): void;
  /** Asks the tab's find bar to search for `text`. */
  requestSearch(tabId: string, text: string): void;
}

export const usePdfSelection = create<PdfSelectionState>()((set) => ({
  byTab: {},
  searches: {},
  select: (tabId, selection) => set((s) => ({ byTab: { ...s.byTab, [tabId]: selection } })),
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
  requestSearch: (tabId, text) =>
    set((s) => ({
      searches: { ...s.searches, [tabId]: { text, seq: (s.searches[tabId]?.seq ?? 0) + 1 } },
    })),
}));
