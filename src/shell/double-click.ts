// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MouseEvent } from "react";

// The entries of the side strips (places, volumes, Trash, the Library, pins
// and recents) open on a double-click, as a file does in the list, so a
// stray click does not leave the folder or open a file. A button pressed
// from the keyboard (Enter, Space) fires `click` with `detail` 0, and that
// opens too: the keyboard has no double press.

/** The handlers that open an entry on a double-click, or on Enter and Space. */
export function openOnDoubleClick(open: () => void) {
  return {
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) open();
    },
    onDoubleClick: () => open(),
  };
}
