// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { parent, type WireEntry, type WirePath } from "../ipc";
import { useLayout } from "../store/layout";
import { isFolder } from "./file-type";
import { useTreeMenu } from "./tree-menu-store";

// The row of the folder tree the pointer is over, so a key can be aimed at it as a right-click
// is: F4 opens a terminal in that row's folder, and in the tree's root when the pointer is over
// no row. The tree sets and clears it (FolderTree.tsx); it holds nothing for a row that has gone.

interface TreeHoverState {
  /** The tree row's key, and the entry it lists. */
  key: string | null;
  entry: WireEntry | null;
  set(key: null): void;
  set(key: string, entry: WireEntry): void;
  /** The pointer left row `key`: forgotten only if that row is the one held. */
  leave(key: string): void;
}

export const useTreeHover = create<TreeHoverState>()((set, get) => ({
  key: null,
  entry: null,
  set: (key: string | null, entry?: WireEntry) =>
    set(key !== null && entry ? { key, entry } : { key: null, entry: null }),
  leave: (key) => {
    if (get().key === key) set({ key: null, entry: null });
  },
}));

/**
 * The folder a terminal opens in from the keyboard: the folder under the pointer, the folder a
 * file under it is in, else the root of the tree. Null when there is none of these.
 */
export function terminalFolder(): WirePath | null {
  const { entry } = useTreeHover.getState();
  const root = useLayout.getState().treeRoot;
  if (!entry) return root;
  return (isFolder(entry) ? entry.path : parent(entry.path)) ?? root;
}

/**
 * Aims the tree's operations at the row under the pointer, or at the root when the pointer is over
 * no row, as a right-click does: a mouse button bound to a tree action acts on the row it is pressed over.
 */
export function aimTreeAtPointer(): void {
  useTreeMenu.getState().setCurrent(useTreeHover.getState().entry, useLayout.getState().treeRoot);
}
