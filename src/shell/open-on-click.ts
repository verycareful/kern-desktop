// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MouseEvent } from "react";

// The entries of the side strips (places, volumes, Trash, the Library, pins
// and recents) open on a double-click, as a file does in the list, so a
// stray click does not leave the folder or open a file. With the single-click
// setting on, one click opens. A button pressed from the keyboard (Enter,
// Space) fires `click` with `detail` 0, and that opens in both modes: the
// keyboard has no double press.

/**
 * The handlers that open an entry: on a double-click, or on a single click when `single` is
 * set, and on Enter and Space either way. The second click of a double-click (`detail` 2 or
 * more) does not open again in single mode.
 */
export function openOnClick(open: () => void, single: boolean) {
  if (single) {
    return {
      onClick: (e: MouseEvent) => {
        if (e.detail <= 1) open();
      },
    };
  }
  return {
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) open();
    },
    onDoubleClick: () => open(),
  };
}
