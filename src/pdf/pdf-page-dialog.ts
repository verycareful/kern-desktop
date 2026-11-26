// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// Which of the page-file dialogs (Merge, Extract, Split) is open in a PDF tab, keyed by tab id so
// an action opens it without reaching into the viewer's React tree.

export type PageDialog =
  | { kind: "merge" }
  /** `pages` is what the page field starts with: the chosen pages, as `1-3,5`, or empty. */
  | { kind: "extract" | "split"; pages: string };

interface PageDialogState {
  byTab: Record<string, PageDialog>;
  open(tabId: string, dialog: PageDialog): void;
  close(tabId: string): void;
}

export const usePageDialog = create<PageDialogState>()((set) => ({
  byTab: {},
  open: (tabId, dialog) => set((s) => ({ byTab: { ...s.byTab, [tabId]: dialog } })),
  close: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));
