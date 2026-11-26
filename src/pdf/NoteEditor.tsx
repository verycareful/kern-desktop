// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { percent } from "./percent";

// Where the editor may stand, as fractions of the page, so it stays on the page.
const EDITOR_MAX_LEFT = 0.55;
const EDITOR_MAX_TOP = 0.7;

// The small box in which a note's text is written: for a new note where it was put, and for the
// text of a note that is there. Ctrl+Enter keeps the text, Escape lets it go.
export function NoteEditor(props: {
  /** Where the note is, as fractions of the page. */
  at: { left: number; top: number };
  /** The text the box opens with. */
  initial: string;
  /** The button that keeps the text. */
  commitLabel: string;
  onCommit(text: string): void;
  onCancel(): void;
}) {
  const { at, initial, commitLabel, onCommit, onCancel } = props;
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim() === "";

  useEffect(() => field.current?.focus(), []);

  const keep = () => {
    if (!empty) onCommit(text);
  };

  return (
    <div
      className="kern-pdf-note-editor"
      role="dialog"
      aria-label="Note"
      style={{
        left: percent(Math.min(at.left, EDITOR_MAX_LEFT)),
        top: percent(Math.min(at.top, EDITOR_MAX_TOP)),
      }}
      // A press in the box is the box's, not a note placed or a text selected under it.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          keep();
        }
      }}
    >
      <textarea
        ref={field}
        className="kern-modal-input kern-pdf-note-input"
        aria-label="Text of the note"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="kern-pdf-note-buttons">
        <button type="button" className="kern-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="kern-button" disabled={empty} onClick={keep}>
          {commitLabel}
        </button>
      </div>
    </div>
  );
}
