// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// The address a link of a PDF tab asks to open, shown by the viewer's `LinkPrompt` before
// anything is handed to the system.
interface LinkPromptState {
  byTab: Record<string, string>;
  ask(tabId: string, url: string): void;
  close(tabId: string): void;
}

export const useLinkPrompt = create<LinkPromptState>()((set) => ({
  byTab: {},
  ask: (tabId, url) => set((s) => ({ byTab: { ...s.byTab, [tabId]: url } })),
  close: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));
