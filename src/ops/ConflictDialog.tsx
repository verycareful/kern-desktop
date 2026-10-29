// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useId, useRef, useState } from "react";
import { displayPath, type ConflictChoice, type OpConflictEvent, type WireEntry } from "../ipc";
import { fileType, isFolder } from "../files/file-type";
import { formatDate, formatSize } from "../files/format";
import { Modal } from "./Modal";

// A name is taken at the destination (design 5.1): skip the item, replace
// what is there, or keep both. What Replace does depends on what the two are:
// a file or link replaces a file or link, which is lost; two folders are merged,
// each clash inside asked about in turn; a folder against a file (either way)
// is refused for that item and nothing changes. "Apply to all" gives every later conflict of
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

type Sides = "files" | "folders" | "mixed" | "unknown";

/**
 * What the two sides are, as kernkraft's Replace sees them: by what each entry is itself, so a
 * link to a folder counts as the link it is.
 */
function sidesOf(source: WireEntry | null, existing: WireEntry | null): Sides {
  if (source === null || existing === null) return "unknown";
  const [a, b] = [source.kind === "dir", existing.kind === "dir"];
  return a && b ? "folders" : a || b ? "mixed" : "files";
}

const REPLACE_NOTE: Record<Sides, string> = {
  files: "Replace: the item already there is lost and cannot be undone.",
  folders:
    "Replace: the two folders are merged, and the items inside that clash are asked about one by one. A merge cannot be undone.",
  mixed:
    "Replace does not put a folder over a file or a file over a folder: this item would fail, and nothing already there is changed.",
  unknown:
    "Replace: what is already there is lost, or merged when both are folders, and this cannot be undone.",
};

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
  const sides = sidesOf(conflict.source_entry, conflict.existing_entry);
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
        {REPLACE_NOTE[sides]}
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
