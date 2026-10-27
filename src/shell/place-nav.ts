// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pathKey, type WirePath } from "../ipc";
import { activeTab, recentFolderTab, useTabs, type Tab, type TabsState } from "../store/tabs";

// Design 4.1: a place of the strip (Home, a user folder, a volume) is shown in
// the current folder tab. In a document tab, where the strip is slid in over
// the document, that is the folder tab used last (4.3); from the Trash that
// tab is brought forward, since the Trash has no folder to navigate. With no
// folder tab at all one is opened.
export function showFolder(path: WirePath): void {
  const s = useTabs.getState();
  const active = activeTab(s);
  if (active?.kind === "folder") {
    s.navigateTab(active.id, path);
    return;
  }
  const recent = recentFolderTab(s);
  if (!recent) {
    s.openFolder(path, true);
    return;
  }
  s.navigateTab(recent.id, path);
  if (active?.kind === "trash") s.activate(recent.id);
}

/** The folder the places strip marks as current: the active folder tab's, else the one a slid-in panel shows. */
export function shownFolder(
  s: Pick<TabsState, "tabs" | "activeId" | "lastFolderId">
): WirePath | null {
  const active: Tab | null = activeTab(s);
  if (active?.kind === "trash") return null;
  if (active?.kind === "folder") return active.path;
  return recentFolderTab(s)?.path ?? null;
}

/** True when the Trash is the tab on show. */
export function trashShown(s: Pick<TabsState, "tabs" | "activeId">): boolean {
  return activeTab(s)?.kind === "trash";
}

/**
 * True when `path` is `place` or lies inside it. Paths are compared by key; a
 * Bytes path is compared whole, since its text is base64 of the bytes.
 */
export function within(place: WirePath, path: WirePath, inside: boolean): boolean {
  if (pathKey(place) === pathKey(path)) return true;
  if (!inside || place.k !== "Utf8" || path.k !== "Utf8") return false;
  const base = place.v.endsWith("/") ? place.v : `${place.v}/`;
  return path.v.startsWith(base);
}
