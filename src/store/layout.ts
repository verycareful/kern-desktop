// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { LayoutKind, WindowLayout, WirePath } from "../ipc";

// How this window is laid out. Two layouts: the file manager and
// the editor, whose left column (a places strip over a folder tree) stays docked whatever tab is
// shown. The main window's layout is the setting (Settings, Files); it keeps its column width,
// column visibility and tree root across restarts (shell/use-layout-sync.ts writes them to
// layout.json). An editor window (`editor-<n>`) is always the editor layout and is told its root
// by the backend.

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

/**
 * The Pinned and Recent panel's width limits in pixels: the left column's, since a pin's row is a
 * name and its folder as a place's row is a name. Its default is the left column's too, which
 * leaves most of the window to the folder area. store.rs RIGHT_WIDTH_MIN and RIGHT_WIDTH_MAX are
 * the same.
 */
export const RIGHT_WIDTH_MIN = LEFT_WIDTH_MIN;
export const RIGHT_WIDTH_MAX = LEFT_WIDTH_MAX;
export const RIGHT_WIDTH_DEFAULT = LEFT_WIDTH_DEFAULT;

export const clampRightWidth = (w: number): number =>
  Math.min(RIGHT_WIDTH_MAX, Math.max(RIGHT_WIDTH_MIN, Math.round(w)));

interface LayoutState {
  layout: LayoutKind;
  /** Width of the editor layout's left column. */
  leftWidth: number;
  /** Whether the editor layout's left column is shown (Ctrl+B). */
  leftOpen: boolean;
  /** Width of the Pinned and Recent panel. */
  rightWidth: number;
  /** The folder the tree is rooted at; null until it is known. */
  treeRoot: WirePath | null;
  /** The stored layout has been read and applied. */
  loaded: boolean;
  setLayout(layout: LayoutKind): void;
  setLeftWidth(width: number): void;
  setRightWidth(width: number): void;
  toggleLeft(): void;
  setTreeRoot(root: WirePath | null): void;
  /** Takes the stored columns and tree, and `layout` from the settings. */
  apply(stored: WindowLayout, layout: LayoutKind): void;
  /** This window is an editor window: the editor layout, with the widths the main window ended with. */
  applyToEditorWindow(stored: WindowLayout | null): void;
  /** Nothing could be read: the defaults stand and the window is usable. */
  applyDefaults(layout: LayoutKind): void;
  reset(): void;
}

const initial = {
  layout: "file_manager" as LayoutKind,
  leftWidth: LEFT_WIDTH_DEFAULT,
  leftOpen: true,
  rightWidth: RIGHT_WIDTH_DEFAULT,
  treeRoot: null as WirePath | null,
  loaded: false,
};

export const useLayout = create<LayoutState>()((set) => ({
  ...initial,
  setLayout: (layout) => set({ layout }),
  setLeftWidth: (width) => set({ leftWidth: clampWidth(width) }),
  setRightWidth: (width) => set({ rightWidth: clampRightWidth(width) }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  setTreeRoot: (treeRoot) => set({ treeRoot }),
  apply: (stored, layout) =>
    set({
      layout,
      leftWidth: clampWidth(stored.left_width),
      leftOpen: stored.left_open,
      rightWidth: clampRightWidth(stored.right_width),
      treeRoot: stored.tree_root,
      loaded: true,
    }),
  applyToEditorWindow: (stored) =>
    set((s) => ({
      layout: "editor",
      leftWidth: stored ? clampWidth(stored.left_width) : s.leftWidth,
      rightWidth: stored ? clampRightWidth(stored.right_width) : s.rightWidth,
      loaded: true,
    })),
  applyDefaults: (layout) => set({ layout, loaded: true }),
  reset: () => set(initial),
}));

/** True while this window shows the editor layout. */
export const isEditorLayout = (): boolean => useLayout.getState().layout === "editor";
