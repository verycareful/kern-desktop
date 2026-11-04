// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireError } from "../ipc";
import { baseName } from "./labels";

// What an error says to the user. The kinds named here are those kernkraft's
// same_filesystem and the file operations answer with that the backend's message does not explain in
// terms of what the user was doing; any other error is its kind and the
// backend's own message, which names the path.

/**
 * `afterPath`: the words stand after the item's path in a list, which already names it, so they
 * do not name it again.
 */
export function errorText(e: WireError, afterPath = false): string {
  switch (e.kind) {
    case "MountIdUnavailable":
      return "this system cannot say which mount a file is on (it needs Linux 5.8 or newer), so Kern cannot tell whether dropping it is a move or a copy and did nothing with it. Hold Ctrl to copy it or Shift to move it.";
    case "MountPoint":
      return `${afterPath ? "is" : `${e.path ? baseName(e.path) : "This item"} is`} a mount point and cannot be moved, copy it instead.`;
    case "InvalidName":
      return "this path has no name of its own (it is the root folder, or ends in ..), so it cannot be moved or copied into a folder.";
  }
  return `${e.kind}: ${e.message}`;
}
