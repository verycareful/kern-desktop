// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useRef, useState } from "react";
import { toWireError } from "../ipc";
import { editErrorText } from "./edit-error";
import { Modal } from "./Modal";
import { nameProblem } from "./names";

// A name typed for something new (a folder, an empty file) or for an item
// being renamed. A name that cannot be one is refused here; whatever the backend refuses (the
// name exists, the folder is read-only) is shown in the dialog, which stays
// open for another try. The name is text, sent as a string.
export function NameDialog(props: {
  title: string;
  initial: string;
  confirmLabel: string;
  /** The part of `initial` selected when the dialog opens; all of it when absent. */
  select?: readonly [number, number];
  /** A further reason to refuse a name, or null when it may be sent. */
  check?(name: string): string | null;
  /** Creates the item; a rejection is shown and keeps the dialog open. */
  onSubmit(name: string): Promise<void>;
  onCancel(): void;
}) {
  const [text, setText] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const id = useId();
  const selectRange = useRef(props.select);

  useEffect(() => {
    alive.current = true;
    const range = selectRange.current;
    if (range) input.current?.setSelectionRange(range[0], range[1]);
    else input.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async () => {
    if (busy) return;
    const problem = nameProblem(text) ?? props.check?.(text) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await props.onSubmit(text);
    } catch (e) {
      const err = toWireError(e);
      if (alive.current) setError(editErrorText(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Modal
      role="dialog"
      label={props.title}
      initialFocus={input}
      onEscape={props.onCancel}
      testId="name-dialog"
    >
      <h2 className="kern-modal-title">{props.title}</h2>
      <label className="kern-modal-text" htmlFor={`${id}-name`}>
        Name
      </label>
      <input
        id={`${id}-name`}
        ref={input}
        type="text"
        className="kern-modal-input"
        spellCheck={false}
        value={text}
        readOnly={busy}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="kern-modal-error">
          {error}
        </p>
      )}
      <div className="kern-modal-actions">
        <button type="button" className="kern-button" disabled={busy} onClick={() => void submit()}>
          {props.confirmLabel}
        </button>
        <button type="button" className="kern-button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
