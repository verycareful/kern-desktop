// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  openPaths,
  showInFolder,
  toWireError,
  type WireEntry,
  type WireError,
  type WirePath,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
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
 * Opens entries from the folder view. A single folder navigates
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
  return openFiles(
    files.map((f) => f.path),
    newWindow
  );
}

/**
 * Sends files to the open command with origin "inside": text
 * becomes a document tab or, with the new-window gesture, a window; anything
 * else goes to its default application. Resolves to the errors to show, one
 * per failure.
 */
export async function openFiles(
  paths: readonly WirePath[],
  newWindow: boolean
): Promise<WireError[]> {
  const errors: WireError[] = [];
  try {
    const outcomes = await openPaths([...paths], "inside", newWindow ? "new_window" : "default");
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

/**
 * Opens `folder` in a folder tab of the main window, from any window: the open command with
 * origin "inside" hands a folder to the main window. Each failure is said through `note`.
 */
export async function openFolderTab(folder: WirePath, note: (text: string) => void): Promise<void> {
  for (const err of await openFiles([folder], false)) {
    note(`${baseName(folder)} was not opened in a folder tab: ${errorText(err)}`);
  }
}

/**
 * Opens the folder a file is in as a folder tab of the main window, with the file selected
 * (`show_in_folder`, as Open file location does). Each problem is said through `note`.
 */
export async function showFileInFolder(
  file: WirePath,
  note: (text: string) => void
): Promise<void> {
  let errors: WireError[];
  try {
    errors = await showInFolder([file]);
  } catch (e) {
    errors = [toWireError(e)];
  }
  for (const err of errors)
    note(`${baseName(file)} was not shown in its folder: ${errorText(err)}`);
}
