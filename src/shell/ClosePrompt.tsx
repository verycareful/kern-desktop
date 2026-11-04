// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef } from "react";
import { Modal } from "../ops/Modal";
import { useCloseGuard, type AtRisk } from "./useCloseGuard";

// The question useCloseGuard.ts asks before a document is closed: Save, Close
// without saving, or Cancel. Escape is Cancel. Save is offered while some document listed can be
// saved where it is, and saves those; a read-only one needs Save As, which the user reaches by
// cancelling, and is asked about again once the others are saved.

function why(item: AtRisk): string {
  if (item.deleted && item.dirty) return "has unsaved changes, and its file was deleted on disk";
  if (item.deleted) return "was deleted on disk; this is the only copy of its text";
  return "has unsaved changes";
}

export function ClosePrompt() {
  const question = useCloseGuard((s) => s.question);
  const answer = useCloseGuard((s) => s.answer);
  const saveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  if (!question) return null;
  const { items, what, saving } = question;
  const readOnly = items.filter((i) => i.readOnly);
  const canSave = readOnly.length < items.length;
  const only = items.length === 1 ? items[0]! : null;
  const title = only
    ? only.deleted && !only.dirty
      ? `Save ${only.name} again before closing?`
      : `Save the changes to ${only.name} before closing?`
    : `Save ${items.length} documents before closing the window?`;

  return (
    <Modal
      role="alertdialog"
      label={title}
      onEscape={() => !saving && answer("cancel")}
      initialFocus={canSave ? saveButton : cancelButton}
      testId="close-prompt"
    >
      <h2 className="kern-modal-title">{title}</h2>
      {only ? (
        <p className="kern-modal-text">
          {only.name} {why(only)}. Closing {what === "window" ? "the window" : "it"} without saving
          loses {only.deleted ? "the text" : "the changes"}.
        </p>
      ) : (
        <>
          <p className="kern-modal-text">
            Closing the window without saving loses what these documents hold that is not on disk:
          </p>
          <ul className="kern-modal-text" data-testid="close-prompt-list">
            {items.map((i) => (
              <li key={i.id}>
                {i.name} {why(i)}
              </li>
            ))}
          </ul>
        </>
      )}
      {readOnly.length > 0 && (
        <p className="kern-modal-text">
          {readOnly.map((i) => i.name).join(", ")} {readOnly.length === 1 ? "is" : "are"} read-only
          here. Cancel, then use Save As (Ctrl+Shift+S) to keep{" "}
          {readOnly.length === 1 ? "it" : "them"} in another file.
          {canSave ? " Save writes the others." : ""}
        </p>
      )}
      {saving && (
        <p role="status" className="kern-modal-text">
          Saving…
        </p>
      )}
      <div className="kern-modal-actions">
        {canSave && (
          <button
            ref={saveButton}
            type="button"
            className="kern-button"
            disabled={saving}
            onClick={() => answer("save")}
          >
            {only ? "Save" : readOnly.length > 0 ? "Save the others" : "Save all"}
          </button>
        )}
        <button
          type="button"
          className="kern-button"
          disabled={saving}
          onClick={() => answer("discard")}
        >
          Close without saving
        </button>
        <button
          ref={cancelButton}
          type="button"
          className="kern-button"
          disabled={saving}
          onClick={() => answer("cancel")}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
