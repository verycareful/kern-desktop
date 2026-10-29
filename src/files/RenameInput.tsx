// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef } from "react";
import { focusGoesToADialog } from "../ops/modal-stack";
import { selectedRange, type RenameState } from "./use-file-ops";

// The name of an item edited where it is listed (F2, design 5.1). The text is
// the hook's, so scrolling the row out of view and back does not lose it.
// Enter and leaving the field apply it, Escape drops it. Focus leaving Kern's
// window leaves the edit open, as the location bar does (the document has no
// focus then), and so does focus going to a dialog.
export interface RenameProps {
  state: RenameState;
  onChange(text: string): void;
  onCommit(): void;
  onCancel(): void;
}

export function RenameInput(props: RenameProps) {
  const { state } = props;
  const input = useRef<HTMLInputElement>(null);
  // Enter and Escape settle the edit once; the blur that follows the field going away is not a second answer.
  const settled = useRef(false);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const [from, to] = selectedRange(state.original, state.stem);
    el.setSelectionRange(from, to);
    // Only when the editor opens: later renders keep the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <input
      ref={input}
      type="text"
      className="kern-rename-input"
      aria-label={`Rename ${state.original}`}
      aria-invalid={state.error !== null}
      spellCheck={false}
      value={state.text}
      readOnly={state.busy}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={(e) => {
        // A dialog that takes the focus (a question from another operation) is not the user
        // leaving the edit: it stays open, and the dialog gives the focus back when it closes.
        if (settled.current || !document.hasFocus() || focusGoesToADialog(e.relatedTarget)) return;
        props.onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          settled.current = false;
          props.onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          settled.current = true;
          props.onCancel();
        }
      }}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    />
  );
}
