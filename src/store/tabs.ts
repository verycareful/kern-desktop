// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { displayPath, parent, pathKey, type WirePath } from "../ipc";

// Design 4.1 (tabs above the panels), 4.3 (a file opens as a document tab),
// 4.5 (a file already open is focused, never opened twice).
export type FolderTab = {
  id: string;
  kind: "folder";
  /** Always history[cursor]. */
  path: WirePath;
  history: WirePath[];
  cursor: number;
};
export type DocTab = { id: string; kind: "doc"; path: WirePath; dirty: boolean };
/**
 * The Trash (design 5.2). A place of its own rather than a folder: it lists the
 * home trash and the trashes of the mounted volumes, so it has no path and no
 * history to step through. There is at most one (4.5: nothing opens twice).
 */
export type TrashTab = { id: string; kind: "trash" };
export type Tab = FolderTab | DocTab | TrashTab;

/**
 * What a folder tab's view keeps while another tab is shown: the scroll
 * offset, the selection and the cursor. Items are named by pathKey, so
 * they are found again whatever order the listing comes back in. `pathKey` is
 * the folder it was taken in; it is applied to that folder only.
 */
export interface FolderViewState {
  pathKey: string;
  scrollTop: number;
  selected: string[];
  anchor: string | null;
  cursor: string | null;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** The folder tab that was active last; see recentFolderTab. */
  lastFolderId: string | null;
  /** The saved view of each folder tab that is not shown, by tab id. */
  views: Record<string, FolderViewState>;
  /** Items to select in a folder tab once it has listed (kern://select); taken by its view. */
  selectRequests: Record<string, WirePath[]>;
  requestSelect(id: string, paths: WirePath[]): void;
  clearSelectRequest(id: string): void;
  /** Focus the folder tab that shows `path`, or open one (a folder opened from outside, design 4.5). */
  focusOrOpenFolder(path: WirePath): void;
  /** Keep a folder tab's view; ignored for a tab that is gone (a view torn down by its tab's close). */
  saveView(id: string, view: FolderViewState): void;
  /** Navigate the active folder tab, or open a folder tab when asked to or when the active tab is not a folder. */
  openFolder(path: WirePath, inNewTab: boolean): void;
  /** Navigate the folder tab `id` (not necessarily the active one) to `path`. */
  navigateTab(id: string, path: WirePath): void;
  /** Focus the Trash tab, or open it. */
  openTrash(): void;
  /** Open a document tab, or focus the one already open on this path. */
  openDoc(path: WirePath): void;
  /** Close a tab; the active tab becomes its right neighbour, else its left. */
  close(id: string): void;
  activate(id: string): void;
  /** Wraps around. */
  next(): void;
  prev(): void;
  back(): void;
  forward(): void;
  up(): void;
}

/** The tab's label: the last path component, or "/" for the root. */
export function tabTitle(tab: Tab): string {
  if (tab.kind === "trash") return "Trash";
  // A Bytes path shows with U+FFFD for the bytes that are not UTF-8.
  const trimmed = displayPath(tab.path).replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || "/";
}

export function activeTab(s: Pick<TabsState, "tabs" | "activeId">): Tab | null {
  return s.tabs.find((t) => t.id === s.activeId) ?? null;
}

type SetTabs = (fn: (s: TabsState) => Partial<TabsState>) => void;

/** The state without the saved view of tab `id`. */
function withoutView(views: Record<string, FolderViewState>, id: string) {
  const rest = { ...views };
  delete rest[id];
  return rest;
}

function withoutRequest(requests: Record<string, WirePath[]>, id: string) {
  const rest = { ...requests };
  delete rest[id];
  return rest;
}

/** A folder tab moved to another folder: it starts fresh there, so its saved view and pending selection go. */
function moveTab(s: TabsState, moved: FolderTab): Partial<TabsState> {
  return {
    tabs: s.tabs.map((t) => (t.id === moved.id ? moved : t)),
    views: withoutView(s.views, moved.id),
    selectRequests: withoutRequest(s.selectRequests, moved.id),
  };
}

function updateActiveFolder(set: SetTabs, step: (t: FolderTab) => FolderTab | null) {
  set((s) => {
    const cur = activeTab(s);
    if (!cur || cur.kind !== "folder") return {};
    const nextTab = step(cur);
    return nextTab ? moveTab(s, nextTab) : {};
  });
}

function visit(t: FolderTab, path: WirePath): FolderTab | null {
  if (pathKey(path) === pathKey(t.path)) return null;
  const history = [...t.history.slice(0, t.cursor + 1), path];
  return { ...t, history, cursor: history.length - 1, path };
}

function step(t: FolderTab, cursor: number): FolderTab | null {
  const path = t.history[cursor];
  if (path === undefined || cursor === t.cursor) return null;
  return { ...t, cursor, path };
}

function cycle(set: SetTabs, delta: 1 | -1) {
  set((s) => {
    if (s.tabs.length === 0) return {};
    const i = s.tabs.findIndex((t) => t.id === s.activeId);
    const target = s.tabs[(i + delta + s.tabs.length) % s.tabs.length];
    return target ? { activeId: target.id } : {};
  });
}

export const useTabs = create<TabsState>()((set) => ({
  tabs: [],
  activeId: null,
  lastFolderId: null,
  views: {},
  selectRequests: {},
  requestSelect(id, paths) {
    set((s) =>
      s.tabs.some((t) => t.id === id)
        ? { selectRequests: { ...s.selectRequests, [id]: paths } }
        : {}
    );
  },
  clearSelectRequest(id) {
    set((s) => ({ selectRequests: withoutRequest(s.selectRequests, id) }));
  },
  focusOrOpenFolder(path) {
    set((s) => {
      const key = pathKey(path);
      const open = s.tabs.find((t) => t.kind === "folder" && pathKey(t.path) === key);
      if (open) return { activeId: open.id };
      const tab: FolderTab = {
        id: crypto.randomUUID(),
        kind: "folder",
        path,
        history: [path],
        cursor: 0,
      };
      return { tabs: [...s.tabs, tab], activeId: tab.id };
    });
  },
  saveView(id, view) {
    set((s) => (s.tabs.some((t) => t.id === id) ? { views: { ...s.views, [id]: view } } : {}));
  },
  openFolder(path, inNewTab) {
    set((s) => {
      const cur = activeTab(s);
      if (inNewTab || !cur || cur.kind !== "folder") {
        const tab: FolderTab = {
          id: crypto.randomUUID(),
          kind: "folder",
          path,
          history: [path],
          cursor: 0,
        };
        return { tabs: [...s.tabs, tab], activeId: tab.id };
      }
      const moved = visit(cur, path);
      return moved ? moveTab(s, moved) : {};
    });
  },
  navigateTab(id, path) {
    set((s) => {
      const t = s.tabs.find((x) => x.id === id);
      if (!t || t.kind !== "folder") return {};
      const moved = visit(t, path);
      return moved ? moveTab(s, moved) : {};
    });
  },
  openTrash() {
    set((s) => {
      const open = s.tabs.find((t) => t.kind === "trash");
      if (open) return { activeId: open.id };
      const tab: TrashTab = { id: crypto.randomUUID(), kind: "trash" };
      return { tabs: [...s.tabs, tab], activeId: tab.id };
    });
  },
  openDoc(path) {
    set((s) => {
      const key = pathKey(path);
      const open = s.tabs.find((t) => t.kind === "doc" && pathKey(t.path) === key);
      if (open) return { activeId: open.id };
      const tab: DocTab = { id: crypto.randomUUID(), kind: "doc", path, dirty: false };
      return { tabs: [...s.tabs, tab], activeId: tab.id };
    });
  },
  close(id) {
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0) return {};
      const tabs = s.tabs.filter((t) => t.id !== id);
      const views = withoutView(s.views, id);
      const selectRequests = withoutRequest(s.selectRequests, id);
      if (id !== s.activeId) return { tabs, views, selectRequests };
      return { tabs, views, selectRequests, activeId: (tabs[i] ?? tabs[i - 1])?.id ?? null };
    });
  },
  activate(id) {
    set((s) => (s.tabs.some((t) => t.id === id) ? { activeId: id } : {}));
  },
  next: () => cycle(set, 1),
  prev: () => cycle(set, -1),
  back: () => updateActiveFolder(set, (t) => step(t, t.cursor - 1)),
  forward: () => updateActiveFolder(set, (t) => step(t, t.cursor + 1)),
  up: () =>
    updateActiveFolder(set, (t) => {
      const up = parent(t.path);
      return up ? visit(t, up) : null;
    }),
}));

// The folder tab that was active most recently (TabsState.lastFolderId). A
// document tab folds the file manager panel away; slid back in over the
// document, the panel shows this tab's folder (design 4.3).
useTabs.subscribe((s) => {
  const a = activeTab(s);
  if (a?.kind === "folder" && a.id !== s.lastFolderId) useTabs.setState({ lastFolderId: a.id });
});

export function recentFolderTab(
  s: Pick<TabsState, "tabs" | "activeId" | "lastFolderId">
): FolderTab | null {
  const folders = s.tabs.filter((t): t is FolderTab => t.kind === "folder");
  return folders.find((t) => t.id === s.lastFolderId) ?? folders[folders.length - 1] ?? null;
}
