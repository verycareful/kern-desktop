// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { useTabs } from "../store/tabs";
import type { SortBy, SortDir } from "./sort";

export interface SortSpec {
  by: SortBy;
  dir: SortDir;
}

export const DEFAULT_SORT: SortSpec = { by: "name", dir: "asc" };

// Handoff README, Interactions, Sort: choosing a field applies its sensible
// direction (Date and Size newest and largest first, Name and Type A to Z);
// choosing the active field again flips it.
const FIRST_DIR: Record<SortBy, SortDir> = {
  name: "asc",
  size: "desc",
  modified: "desc",
  type: "asc",
};

// What a folder tab remembers while it is open and not shown: how it is sorted.
interface FolderUiState {
  sort: Record<string, SortSpec>;
  sortOf(tabId: string): SortSpec;
  chooseSort(tabId: string, by: SortBy): void;
}

export const useFolderUi = create<FolderUiState>()((set, get) => ({
  sort: {},
  sortOf: (tabId) => get().sort[tabId] ?? DEFAULT_SORT,
  chooseSort(tabId, by) {
    const cur = get().sortOf(tabId);
    const dir: SortDir = cur.by === by ? (cur.dir === "asc" ? "desc" : "asc") : FIRST_DIR[by];
    set((s) => ({ sort: { ...s.sort, [tabId]: { by, dir } } }));
  },
}));

// A closed tab's choices go with it.
useTabs.subscribe((s) => {
  const open = new Set(s.tabs.map((t) => t.id));
  const sort = useFolderUi.getState().sort;
  if (Object.keys(sort).every((id) => open.has(id))) return;
  useFolderUi.setState({
    sort: Object.fromEntries(Object.entries(sort).filter(([id]) => open.has(id))),
  });
});
