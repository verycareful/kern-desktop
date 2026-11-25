// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// What the status bar shows of a PDF tab: the page in view out of the document's pages, and
// whether the Go to page box is open. The viewer publishes it here, keyed by tab id, as a text
// document publishes its cursor (editor/doc-status.ts), so a scroll re-renders the status bar
// and not the viewer.

export interface PdfViewStatus {
  /** The page in view, counted from 0. */
  page: number;
  pages: number;
  /** The zoom as a factor of the printed size (1 is 100%), 0 before the pages are measured. */
  zoom: number;
  /** The Go to page box is open. */
  goTo: boolean;
}

interface PdfViewState {
  byTab: Record<string, PdfViewStatus>;
  /** Merges `patch` into the tab's status; a tab with none yet starts at its first page. */
  patch(tabId: string, patch: Partial<PdfViewStatus>): void;
  clear(tabId: string): void;
}

const START: PdfViewStatus = { page: 0, pages: 0, zoom: 0, goTo: false };

export const usePdfView = create<PdfViewState>()((set) => ({
  byTab: {},
  patch: (tabId, patch) =>
    set((s) => {
      const old = s.byTab[tabId] ?? START;
      const next = { ...old, ...patch };
      if (
        s.byTab[tabId] &&
        old.page === next.page &&
        old.pages === next.pages &&
        old.zoom === next.zoom &&
        old.goTo === next.goTo
      ) {
        return s;
      }
      return { byTab: { ...s.byTab, [tabId]: next } };
    }),
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));
