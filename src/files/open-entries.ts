// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { openPaths, toWireError, type WireEntry, type WireError } from "../ipc";
import { useTabs } from "../store/tabs";
import { isFolder } from "./file-type";

/**
 * Opens entries from the folder view (design 4.3). A single folder navigates
 * the current tab; with several entries, or with the new-window gesture
 * (Ctrl), each folder opens in a tab of its own, since folders live only in
 * the main window. Files go to the open command with origin "inside": it
 * decides (text becomes a document tab here or, with the gesture, a window;
 * anything else goes to its default application) and the tab is made here
 * from what it returns. Resolves to the errors to show, one per failure.
 */
export async function openEntries(
  list: readonly WireEntry[],
  newWindow: boolean
): Promise<WireError[]> {
  const tabs = useTabs.getState();
  const folders = list.filter(isFolder);
  const files = list.filter((e) => !isFolder(e));
  const separate = newWindow || list.length > 1;
  folders.forEach((f) => tabs.openFolder(f.path, separate));
  if (files.length === 0) return [];

  const errors: WireError[] = [];
  try {
    const outcomes = await openPaths(
      files.map((f) => f.path),
      "inside",
      newWindow ? "new_window" : "default"
    );
    for (const o of outcomes) {
      if (o.error) errors.push(o.error);
      else if (o.action === "failed") {
        errors.push({
          kind: "Open",
          message: "the file could not be opened",
          path: o.path,
          details: null,
        });
      } else if (o.action === "doc_tab") useTabs.getState().openDoc(o.path);
      else if (o.action === "focus" && o.location?.kind === "tab") {
        useTabs.getState().activate(o.location.tab_id);
      }
    }
  } catch (e) {
    errors.push(toWireError(e));
  }
  return errors;
}
