// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { openPaths, toWireError, type WireEntry, type WireError } from "../ipc";
import { useTabs } from "../store/tabs";
import { isFolder } from "./file-type";

/**
 * Opening more items than this asks first. Each one becomes a tab, a window or
 * an application; ten is as many as a person picks out by hand (a handful of
 * documents), so a larger selection is far more often Select all than a wish
 * to open them all, and a mistake costs dozens of windows to close.
 */
export const OPEN_CONFIRM_ABOVE = 10;

/**
 * Opens entries from the folder view (design 4.3). A single folder navigates
 * the current tab; with several entries, or with the new-window gesture
 * (Ctrl), each folder opens in a tab of its own, since folders live only in
 * the main window. Files go to the open command with origin "inside": it
 * decides (text becomes a document tab here or, with the gesture, a window;
 * anything else goes to its default application). The tab, window or focus
 * it asks for is applied by the directive the backend sends to the main
 * window, once, so what comes back here is only checked for failures.
 * Resolves to the errors to show, one per failure.
 */
export async function openEntries(
  list: readonly WireEntry[],
  newWindow: boolean,
  /** The folder tab the view belongs to: a single folder navigates it. */
  tabId: string
): Promise<WireError[]> {
  const tabs = useTabs.getState();
  const folders = list.filter(isFolder);
  const files = list.filter((e) => !isFolder(e));
  const separate = newWindow || list.length > 1;
  for (const f of folders) {
    if (separate) tabs.openFolder(f.path, true);
    else tabs.navigateTab(tabId, f.path);
  }
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
      }
    }
  } catch (e) {
    errors.push(toWireError(e));
  }
  return errors;
}
