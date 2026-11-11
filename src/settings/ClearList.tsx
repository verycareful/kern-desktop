// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef, useState } from "react";
import { toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { Modal } from "../ops/Modal";
import { Row } from "./settings-ui";

// A row whose button empties a list kept for the right panel, after the question is answered
// yes. The answer is said under the button; a failure is said there too, in the words the
// backend gave.
export function ClearList(props: {
  id: "clear_pins" | "clear_recents" | "reset_binds";
  note: string;
  button: string;
  title: string;
  text: string;
  done: string;
  failed: string;
  clear(): Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; message: string } | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  const run = async () => {
    setBusy(true);
    try {
      await props.clear();
      setResult({ ok: true });
    } catch (e) {
      setResult({ ok: false, message: `${props.failed}: ${errorText(toWireError(e))}` });
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <>
      <Row id={props.id} wide note={props.note}>
        <div className="kern-settings-inline">
          <button
            type="button"
            className="kern-button kern-settings-clear"
            disabled={busy}
            onClick={() => {
              setResult(null);
              setAsking(true);
            }}
          >
            {props.button}
          </button>
          <span className="kern-settings-hint">Happens at once, not at Save.</span>
        </div>
        {result?.ok && (
          <p role="status" className="kern-settings-hint">
            {props.done}
          </p>
        )}
        {result && !result.ok && (
          <p role="alert" className="kern-modal-error">
            {result.message}
          </p>
        )}
      </Row>
      {asking && (
        <Modal
          role="alertdialog"
          label={props.title}
          onEscape={() => !busy && setAsking(false)}
          initialFocus={cancel}
          testId={`${props.id}-dialog`}
        >
          <h2 className="kern-modal-title">{props.title}</h2>
          <p className="kern-modal-text">{props.text}</p>
          <div className="kern-modal-actions">
            <button
              type="button"
              className="kern-button"
              disabled={busy}
              onClick={() => void run()}
            >
              {props.button}
            </button>
            <button
              ref={cancel}
              type="button"
              className="kern-button"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
