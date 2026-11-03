// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { tabWindow, type Location } from "../ipc";

// Where a document is open, in words: the answer of Save As when the target is a file another
// place has open (design 4.5: a file is never open twice), which is never written over.

/**
 * "in another tab of this window", "in a tab of the main window", "in a tab of an editor window"
 * or "in a window of its own". `here` is the label of the window asking.
 */
export function whereOpen(location: Location, here: string = tabWindow()): string {
  if (location.kind === "window") return "in a window of its own";
  // A tab that has not finished opening is in that window all the same.
  if (location.window === here) return "in another tab of this window";
  return location.window === "main"
    ? "in a tab of the main window"
    : "in a tab of an editor window";
}
