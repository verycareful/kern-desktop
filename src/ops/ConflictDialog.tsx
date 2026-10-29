// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId, useRef, useState } from "react";
import { displayPath, type ConflictChoice, type OpConflictEvent, type WireEntry } from "../ipc";
import { fileType, isFolder } from "../files/file-type";
import { formatDate, formatSize } from "../files/format";
import { Modal } from "./Modal";

// A name is taken at the destination (design 5.1): skip the item, replace
// what is there, or keep both. "Apply to all" gives every later conflict of
// the same operation the same answer without asking. Cancel stops the
// operation, which is also what Escape does: the worker waits for an answer,
// and the only way out that destroys nothing is to stop. Skip has the focus
// because it changes nothing.

function Side(props: {
  heading: string;
  path: OpConflictEvent["source"];
  entry: WireEntry | null;
}) {
  const { entry } = props;
  return (
    <div className="kern-conflict-side">
      <p className="kern-label">{props.heading}</p>
      <p className="kern-conflict-path" title={displayPath(props.path)}>
        {displayPath(props.path)}
      </p>
      {entry ? (
        <p className="kern-conflict-meta">
          {fileType(entry).label}
          {!isFolder(entry) && ` · ${formatSize(entry.len)}`}
          {entry.modified_ms !== null && ` · ${formatDate(entry.modified_ms)}`}
        </p>
      ) : (
        <p className="kern-conflict-meta">It could not be read just now.</p>
      )}
    </div>
  );
}

export function ConflictDialog(props: {
  conflict: OpConflictEvent;
  /** What the operation is doing, for the heading. */
  operation: string;
  /** How many other operations wait for an answer after this one. */
  waiting: number;
  /** How many other operations are in flight, asking or not. */
  others: number;
  onAnswer(choice: ConflictChoice, applyToAll: boolean): void;
  onCancel(): void;
}) {
  const { conflict } = props;
  const [all, setAll] = useState(false);
  const skip = useRef<HTMLButtonElement>(null);
  const id = useId();
  const bothFolders =
    conflict.source_entry !== null &&
    conflict.existing_entry !== null &&
    isFolder(conflict.source_entry) &&
    isFolder(conflict.existing_entry);
  const answer = (choice: ConflictChoice) => props.onAnswer(choice, all);
  return (
    <Modal
      role="alertdialog"
      label="Name already taken"
      initialFocus={skip}
      onEscape={props.onCancel}
      testId="conflict-dialog"
    >
      <h2 className="kern-modal-title">A name is already taken</h2>
      <p className="kern-modal-text">{props.operation}</p>
      <div className="kern-conflict-sides">
        <Side heading="Already there" path={conflict.existing} entry={conflict.existing_entry} />
        <Side heading="Coming in" path={conflict.source} entry={conflict.source_entry} />
      </div>
      {bothFolders && (
        <p className="kern-modal-text">
          Replacing a folder merges the two: what is inside with the same name is asked about too.
        </p>
      )}
      <label className="kern-modal-check" htmlFor={`${id}-all`}>
        <input
          id={`${id}-all`}
          type="checkbox"
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        {props.others > 0 ? "Apply to all in this operation" : "Apply to all"}
      </label>
      <p id={`${id}-replace`} className="kern-modal-text">
        Replace: the item already there is lost and cannot be undone.
      </p>
      {props.waiting > 0 && (
        <p className="kern-modal-text" role="status">
          {props.waiting === 1
            ? "Another operation is also waiting for an answer."
            : `${props.waiting} other operations are also waiting for an answer.`}
        </p>
      )}
      <div className="kern-modal-actions">
        <button ref={skip} type="button" className="kern-button" onClick={() => answer("skip")}>
          Skip
        </button>
        <button
          type="button"
          className="kern-button"
          aria-describedby={`${id}-replace`}
          onClick={() => answer("replace")}
        >
          Replace
        </button>
        <button type="button" className="kern-button" onClick={() => answer("keep_both")}>
          Keep both
        </button>
        <button type="button" className="kern-button" onClick={props.onCancel}>
          Cancel operation
        </button>
      </div>
    </Modal>
  );
}
