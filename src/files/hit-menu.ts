// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { isMainWindow, pathKey, type WireEntry } from "../ipc";
import type { MenuSection } from "../keys/ActionMenu";
import { actions, type Action } from "../keys/actions";
import { usePinnedRecent } from "../shell/pinned-recent-store";
import { isEditorLayout } from "../store/layout";
import { isFolder } from "./file-type";

// The right-click menu of a hit of a search or of the Library. The hits are not a folder, so no file
// operation is offered over them: the menu opens the hit, shows where it is, pins it and tells
// about it.

function pick(ids: readonly string[]): Action[] {
  return ids.map((id) => {
    const a = actions.find((x) => x.id === id && x.when === "hit");
    if (!a) throw new Error(`the hit menu names an action that does not exist: ${id}`);
    return a;
  });
}

const EVERY = [
  "hit.open",
  "hit.openNewWindow",
  "hit.openWith",
  "hit.openInFileManager",
  "hit.openAsEditor",
  "hit.location",
  "hit.copyPath",
  "hit.properties",
  "hit.pin",
  "hit.unpin",
];

/**
 * The menu for the hit it is opened on; only what applies to it is listed. A file has Open in new
 * window and Open with, a folder Open in file manager and Open as editor. Open in file manager and
 * Open file location are left out of the main window in the editor layout, which holds no folder
 * tabs to show a folder in, and Properties is left out of an editor window, which has no
 * Properties dialog.
 */
export function hitMenu(entry: WireEntry): MenuSection[] {
  const main = isMainWindow();
  const folderTabs = !(main && isEditorLayout());
  const opens = isFolder(entry)
    ? [...(folderTabs ? ["hit.openInFileManager"] : []), "hit.openAsEditor"]
    : ["hit.openNewWindow", "hit.openWith"];
  const pins = usePinnedRecent.getState().pins ?? [];
  const pinned = pins.some((p) => pathKey(p) === pathKey(entry.path));
  return [
    { actions: pick(["hit.open", ...opens, ...(folderTabs ? ["hit.location"] : [])]) },
    { actions: pick(["hit.copyPath", ...(main ? ["hit.properties"] : [])]), rule: true },
    { actions: pick([pinned ? "hit.unpin" : "hit.pin"]), rule: true },
  ];
}

/** Every action any form of the hit menu lists. */
export function everyHitAction(): Action[] {
  return pick(EVERY);
}
