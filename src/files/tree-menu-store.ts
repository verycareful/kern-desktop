// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { parent, type WireEntry, type WirePath } from "../ipc";
import { isFolder } from "./file-type";

// What the folder tree's menu was opened on: an entry of the tree, or the empty part below the
// rows (null, which stands for the tree's root). The actions of that menu (keys/actions.ts, "tree"
// actions) are aimed at it, as the volume actions are aimed at the volume whose menu is open. The
// file operations they run belong to the tree on show (TreeOps), which hands them over here.

/** The file operations of the tree on show, aimed at what the menu was opened on. */
export interface TreeFileOps {
  newFolder(): void;
  newFile(): void;
  rename(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  trash(): void;
  askDelete(): void;
  /** Says what went wrong where the tree shows its problems. */
  note(text: string): void;
}

interface TreeMenuState {
  current: WireEntry | null;
  /** The root of the tree the menu was opened in. */
  root: WirePath | null;
  ops: TreeFileOps | null;
  setCurrent(entry: WireEntry | null, root?: WirePath | null): void;
  setOps(ops: TreeFileOps | null): void;
}

export const useTreeMenu = create<TreeMenuState>()((set) => ({
  current: null,
  root: null,
  ops: null,
  setCurrent: (current, root) => set(root === undefined ? { current } : { current, root }),
  setOps: (ops) => set({ ops }),
}));

/**
 * The folder the menu's actions create, paste and open a terminal in: the folder it was opened
 * on, the folder of the file it was opened on, or the root when it was opened on the empty part.
 */
export function treeMenuFolder(): WirePath | null {
  const { current, root } = useTreeMenu.getState();
  if (!current) return root;
  return isFolder(current) ? current.path : parent(current.path);
}
