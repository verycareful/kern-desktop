// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { WirePath } from "../ipc";

// What the window remembers about how it is laid out: the folder its tree is rooted at.
// The editor window (editor-<n>) is told its root by the backend when it is opened.
interface LayoutState {
  /** The folder the tree is rooted at; null until the window has been told. */
  treeRoot: WirePath | null;
  setTreeRoot(root: WirePath | null): void;
}

export const useLayout = create<LayoutState>()((set) => ({
  treeRoot: null,
  setTreeRoot: (treeRoot) => set({ treeRoot }),
}));
