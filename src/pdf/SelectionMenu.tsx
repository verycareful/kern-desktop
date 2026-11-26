// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

import { percent } from "./percent";

// The small menu at the end of a selection: what can be done with the text. The entries are
// buttons, so a later session adds its own (the markup entries) beside these.
export function SelectionMenu(props: {
  /** Where the selection ends, as fractions of the page. */
  at: { left: number; top: number };
  onCopy(): void;
  onSearch(): void;
}) {
  return (
    <div
      className="kern-pdf-selection-menu"
      role="toolbar"
      aria-label="Selected text"
      style={{ left: percent(props.at.left), top: percent(props.at.top) }}
      // A press on the menu is the menu's, not the start of a new selection under it.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="kern-button" onClick={props.onCopy}>
        Copy
      </button>
      <button type="button" className="kern-button" onClick={props.onSearch}>
        Search for it
      </button>
    </div>
  );
}
