// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// What the status bar shows for a folder tab (design 4.1): the item count and,
// with a selection, its count and total size. The folder view publishes it.
export interface FolderStatus {
  items: number;
  selected: number;
  /** The sizes of the selected files; a selected folder has no size here and is counted below. */
  selectedBytes: number;
  selectedFolders: number;
}

interface FolderStatusState {
  byTab: Record<string, FolderStatus>;
  set(tabId: string, status: FolderStatus): void;
  clear(tabId: string): void;
}

export const useFolderStatus = create<FolderStatusState>()((set) => ({
  byTab: {},
  set: (tabId, status) => set((s) => ({ byTab: { ...s.byTab, [tabId]: status } })),
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));
