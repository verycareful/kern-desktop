// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { openEditor, toWireError, type LayoutKind, type WirePath } from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { activeTab, useTabs } from "../store/tabs";
import { useUserDirs } from "./user-dirs-store";

// Changing the layout of the main window (when its setting changes) and opening a folder as an
// editor window. The editor layout holds no folder tabs: the tree shows the folders, and the
// centre a document, the Trash, the Library or the welcome pane.

const say = (text: string) => useOps.getState().notify(text);

/**
 * Makes sure the editor layout's tree has a folder: the one the active folder tab shows, else
 * Home. True when it has one; otherwise why not is said.
 */
export async function ensureTreeRoot(): Promise<boolean> {
  if (useLayout.getState().treeRoot !== null) return true;
  const tab = activeTab(useTabs.getState());
  let root: WirePath | null = tab?.kind === "folder" ? tab.path : null;
  if (root === null) {
    try {
      root = (await useUserDirs.getState().load()).home;
    } catch (e) {
      say(
        `The folder tree has no folder to show: Home could not be found (${errorText(toWireError(e))}).`
      );
      return false;
    }
  }
  // A folder chosen meanwhile wins.
  if (useLayout.getState().treeRoot === null) useLayout.getState().setTreeRoot(root);
  return true;
}

/**
 * Switches this window to `kind`. The editor layout needs a folder for its tree, found first (the
 * folder tab in front gives it); then the folder tabs close, which hold nothing unsaved.
 */
export async function switchLayout(kind: LayoutKind): Promise<void> {
  if (kind === "editor") {
    if (!(await ensureTreeRoot())) {
      say("The layout was not changed.");
      return;
    }
    closeFolderTabs();
  }
  useLayout.getState().setLayout(kind);
}

/** Closes every folder tab, which the editor layout does not hold (they keep nothing unsaved). */
export function closeFolderTabs(): void {
  const tabs = useTabs.getState();
  for (const t of tabs.tabs) if (t.kind === "folder") tabs.close(t.id);
}

/** Opens `folder` in a new editor window; a failure is said in the status bar. */
export async function openAsEditor(folder: WirePath): Promise<void> {
  try {
    await openEditor(folder);
  } catch (e) {
    say(`${baseName(folder)} could not be opened as an editor: ${errorText(toWireError(e))}`);
  }
}
