// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useRef, useState } from "react";
import { toWireError } from "../ipc";
import { Modal } from "./Modal";
import { nameProblem } from "./names";

// A name typed for something new: a folder or an empty file (design 5.1). A
// name that cannot be one is refused here; whatever the backend refuses (the
// name exists, the folder is read-only) is shown in the dialog, which stays
// open for another try. The name is text, sent as a string.
export function NameDialog(props: {
  title: string;
  initial: string;
  confirmLabel: string;
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

  useEffect(() => {
    alive.current = true;
    input.current?.select();
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = async () => {
    if (busy) return;
    const problem = nameProblem(text);
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
      if (alive.current) setError(`${err.kind}: ${err.message}`);
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
