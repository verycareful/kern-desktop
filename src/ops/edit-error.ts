// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireError } from "../ipc";
import { useOps } from "./useOps";

// What a failed rename, new folder or new file says. The backend refuses these with Busy while a
// file operation, an undo or a redo runs, and its message cannot say which: the operations list
// above the status bar can, for the operations this window started. One running in another
// window is not in this list, nor is the measurement of a folder's size a Properties dialog makes,
// which also holds these back; the words say both.

/** The words for `e`, naming the operations running in this window when it is Busy. */
export function editErrorText(e: WireError, running?: readonly string[]): string {
  if (e.kind !== "Busy") return `${e.kind}: ${e.message}`;
  const ops = running ?? useOps.getState().ops.map((o) => o.running);
  if (ops.length > 0) {
    return `This cannot be done while a file operation, such as a Properties measurement, is running (listed here: ${ops.join("; ")}). Wait for it to end; operations in progress are listed above the status bar.`;
  }
  return "This cannot be done while a file operation, such as a Properties measurement, an undo or a redo is running. None is listed in this window, so it is a Properties measurement here, an operation running in another window (its list above the status bar shows it), or one just ending; try again in a moment.";
}
