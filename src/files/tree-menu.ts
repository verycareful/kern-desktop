// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { isMainWindow, type WireEntry } from "../ipc";
import type { MenuSection } from "../keys/ActionMenu";
import { actions, type Action } from "../keys/actions";
import { isEditorLayout } from "../store/layout";
import { isFolder } from "./file-type";

function pick(ids: readonly string[]): Action[] {
  return ids.map((id) => {
    const a = actions.find((x) => x.id === id && x.when === "tree");
    if (!a) throw new Error(`the tree menu names an action that does not exist: ${id}`);
    return a;
  });
}

const EDIT = ["tree.cut", "tree.copy", "tree.rename", "tree.copyPath"];
const REMOVE = ["tree.trash", "tree.delete"];
const CREATE = ["tree.new.file", "tree.new.folder"];

/**
 * The right-click menu of the folder tree, for what it was opened on: a folder, a file, or the
 * empty part below the rows (null, the tree's root). Only what applies to it is listed.
 * Open in file manager opens a folder, the folder of a file with the file selected, or the root for
 * the empty part. It is left out of the main window in the editor layout: that window holds no
 * folder tabs, so the folder would only become the tree's root.
 */
export function treeMenu(entry: WireEntry | null): MenuSection[] {
  const folderTab = isMainWindow() && isEditorLayout() ? [] : ["tree.openInFileManager"];
  if (!entry) {
    return [
      { actions: pick([...folderTab, ...CREATE, "tree.paste", "tree.terminal", "tree.copyPath"]) },
    ];
  }
  if (!isFolder(entry)) {
    return [
      { actions: pick(["tree.open", ...folderTab, "tree.terminal"]) },
      { actions: pick(EDIT) },
      { actions: pick(REMOVE) },
    ];
  }
  return [
    { actions: pick([...folderTab, "tree.openAsEditor", "tree.pinAsEditor", "tree.terminal"]) },
    { actions: pick(CREATE) },
    { actions: pick([...EDIT.slice(0, 2), "tree.paste", ...EDIT.slice(2)]) },
    { actions: pick(REMOVE) },
  ];
}

/** Every action any form of the tree's menu lists. */
export function everyTreeAction(): Action[] {
  const all = [...CREATE, ...EDIT, ...REMOVE, "tree.paste", "tree.terminal", "tree.open"];
  return pick([...all, "tree.openInFileManager", "tree.openAsEditor", "tree.pinAsEditor"]);
}
