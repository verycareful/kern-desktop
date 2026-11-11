// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { FIRST_DIR } from "./folder-ui";
import type { SortBy, SortDir } from "./sort";

// How the folder tree of the editor layout is ordered. The tree is one per window, so the choice
// is the window's: it is kept while the window is open, as a folder tab keeps its own, and every
// folder the tree lists follows it. The order itself (folders first, then the files, each group by
// the field) is sort-core.ts's, the same as a folder view.

/** The fields a tree can be sorted by: the folder view's, but not the Library's Location. */
export type TreeSortBy = Exclude<SortBy, "location">;

export interface TreeSortSpec {
  by: TreeSortBy;
  dir: SortDir;
}

/** Name, A to Z. */
export const DEFAULT_TREE_SORT: TreeSortSpec = { by: "name", dir: "asc" };

interface TreeSortState {
  sort: TreeSortSpec;
  /** Another field starts in the direction that suits it; the field already chosen is left alone. */
  chooseBy(by: TreeSortBy): void;
  chooseDir(dir: SortDir): void;
}

export const useTreeSort = create<TreeSortState>()((set) => ({
  sort: DEFAULT_TREE_SORT,
  chooseBy: (by) => set((s) => (s.sort.by === by ? s : { sort: { by, dir: FIRST_DIR[by] } })),
  chooseDir: (dir) => set((s) => (s.sort.dir === dir ? s : { sort: { ...s.sort, dir } })),
}));

const ORDER_WORDS: Record<TreeSortBy, Record<SortDir, string>> = {
  name: { asc: "A to Z", desc: "Z to A" },
  type: { asc: "A to Z", desc: "Z to A" },
  size: { asc: "Smallest first", desc: "Largest first" },
  modified: { asc: "Oldest first", desc: "Newest first" },
};

/** The direction of a sort in the words that fit its field. */
export function orderWords(by: TreeSortBy, dir: SortDir): string {
  return ORDER_WORDS[by][dir];
}
