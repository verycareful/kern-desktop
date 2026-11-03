// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { LayoutKind, WindowLayout, WirePath } from "../ipc";

// How this window is laid out (Task 28a). Two layouts: the file manager (design D4.1 to D4.3) and
// the editor, whose left column (a places strip over a folder tree) stays docked whatever tab is
// shown. The main window keeps its layout, column width, column visibility and tree root across
// restarts (shell/use-layout-sync.ts writes them to layout.json); an editor window (`editor-<n>`)
// is always the editor layout and is told its root by the backend.

/**
 * The column's width limits in pixels: the places strip is 180 px in the file manager layout, the
 * least that shows "Documents" in full; 640 px is a third of a 1920 px window. store.rs
 * LEFT_WIDTH_MIN and LEFT_WIDTH_MAX are the same, and refuse anything outside.
 */
export const LEFT_WIDTH_MIN = 180;
export const LEFT_WIDTH_MAX = 640;
export const LEFT_WIDTH_DEFAULT = 280;

export const clampWidth = (w: number): number =>
  Math.min(LEFT_WIDTH_MAX, Math.max(LEFT_WIDTH_MIN, Math.round(w)));

interface LayoutState {
  layout: LayoutKind;
  /** The user chose `layout` (it is stored); until then the default layout setting decides. */
  chosen: boolean;
  /** Width of the editor layout's left column. */
  leftWidth: number;
  /** Whether the editor layout's left column is shown (Ctrl+B). */
  leftOpen: boolean;
  /** The folder the tree is rooted at; null until it is known. */
  treeRoot: WirePath | null;
  /** The stored layout has been read and applied. */
  loaded: boolean;
  setLayout(layout: LayoutKind): void;
  setLeftWidth(width: number): void;
  toggleLeft(): void;
  setTreeRoot(root: WirePath | null): void;
  /** Takes the stored layout; `fallback` is the layout when none was chosen. */
  apply(stored: WindowLayout, fallback: LayoutKind): void;
  /** This window is an editor window: the editor layout, with the column width the main window ended with. */
  applyToEditorWindow(stored: WindowLayout | null): void;
  /** Nothing could be read: the defaults stand and the window is usable. */
  applyDefaults(fallback: LayoutKind): void;
  reset(): void;
}

const initial = {
  layout: "file_manager" as LayoutKind,
  chosen: false,
  leftWidth: LEFT_WIDTH_DEFAULT,
  leftOpen: true,
  treeRoot: null as WirePath | null,
  loaded: false,
};

export const useLayout = create<LayoutState>()((set) => ({
  ...initial,
  setLayout: (layout) => set({ layout, chosen: true }),
  setLeftWidth: (width) => set({ leftWidth: clampWidth(width) }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  setTreeRoot: (treeRoot) => set({ treeRoot }),
  apply: (stored, fallback) =>
    set({
      layout: stored.layout ?? fallback,
      chosen: stored.layout !== null,
      leftWidth: clampWidth(stored.left_width),
      leftOpen: stored.left_open,
      treeRoot: stored.tree_root,
      loaded: true,
    }),
  applyToEditorWindow: (stored) =>
    set((s) => ({
      layout: "editor",
      leftWidth: stored ? clampWidth(stored.left_width) : s.leftWidth,
      loaded: true,
    })),
  applyDefaults: (fallback) => set({ layout: fallback, loaded: true }),
  reset: () => set(initial),
}));

/** True while this window shows the editor layout. */
export const isEditorLayout = (): boolean => useLayout.getState().layout === "editor";
