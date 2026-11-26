// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

import type { MarkupKind } from "../ipc/pdf";
import { percent } from "./percent";

const MARKS: readonly (readonly [MarkupKind, string])[] = [
  ["highlight", "Highlight"],
  ["underline", "Underline"],
  ["strikeOut", "Strikeout"],
];

// The small menu at the end of a selection: what can be done with the text.
export function SelectionMenu(props: {
  /** Where the selection ends, as fractions of the page. */
  at: { left: number; top: number };
  onCopy(): void;
  onSearch(): void;
  /** The document can be changed, so the text can be marked and a note can be put by it. */
  canMark: boolean;
  onMark(kind: MarkupKind): void;
  onNote(): void;
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
      {MARKS.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          className="kern-button"
          disabled={!props.canMark}
          onClick={() => props.onMark(kind)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className="kern-button"
        disabled={!props.canMark}
        onClick={props.onNote}
      >
        Note
      </button>
    </div>
  );
}
