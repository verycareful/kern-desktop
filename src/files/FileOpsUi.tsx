// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { X } from "lucide-react";
import { NameDialog } from "../ops/NameDialog";
import { NAMED_UP_TO, namesText, plural } from "../ops/labels";
import { Paged } from "../ops/ReportPanel";
import { useState } from "react";
import { ConfirmBanner } from "./ConfirmBanner";
import type { FileOps } from "./use-file-ops";

/** Every item a question was asked about, once opened, a page at a time. */
function EveryItem(props: { names: readonly string[] }) {
  // The rows are only drawn once opened: a question can be about a hundred thousand items.
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Show all {plural(props.names.length, "item", "items")}</summary>
      {open && (
        <Paged items={props.names} row={(name, i) => <li key={`${i}\n${name}`}>{name}</li>} />
      )}
    </details>
  );
}

// What a folder view shows for its file operations: the failures it has to
// tell about, the question being asked, and the dialog that names something new.
export function FileOpsUi(props: {
  ops: FileOps;
  /** The element the view's keyboard belongs to while a question is open. */
  scope: React.RefObject<HTMLElement | null>;
  /** True while the view is the tab on show. */
  active: boolean;
}) {
  const { ops, scope, active } = props;
  const q = ops.asking;
  return (
    <>
      {ops.problems.length > 0 && (
        <div role="alert" className="kern-banner">
          <ul>
            {ops.problems.map((p) => (
              <li key={p.id}>
                {p.error.kind}: {p.error.message}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="kern-icon-button"
            aria-label="Dismiss"
            onClick={() => ops.problems.forEach((p) => ops.dismissProblem(p.id))}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
      {ops.renaming?.error && (
        <div role="alert" className="kern-banner">
          <span>Rename: {ops.renaming.error}</span>
        </div>
      )}
      {q?.kind === "delete" && (
        <ConfirmBanner
          label="Delete permanently"
          message={
            <>
              <p>Delete {namesText(q.items.map((i) => i.name))} for good? It cannot be undone.</p>
              {q.items.length > NAMED_UP_TO && <EveryItem names={q.items.map((i) => i.name)} />}
            </>
          }
          confirmLabel={`Delete ${plural(q.items.length, "item", "items")}`}
          scope={scope}
          active={active}
          onConfirm={() => ops.answer(false)}
          onCancel={ops.cancelAsk}
        />
      )}
      {q?.kind === "drop" && (
        <ConfirmBanner
          label="Copy or move"
          message={`Move or copy ${q.names} into ${q.destName}?`}
          confirmLabel="Move here"
          alternateLabel="Copy here"
          scope={scope}
          active={active}
          onConfirm={() => ops.answer(false)}
          onAlternate={() => ops.answer(true)}
          onCancel={ops.cancelAsk}
        />
      )}
      {ops.naming && (
        <NameDialog
          title={ops.naming === "folder" ? "New folder" : "New file"}
          initial={ops.naming === "folder" ? "New folder" : "New file"}
          confirmLabel="Create"
          onSubmit={ops.submitName}
          onCancel={ops.closeNaming}
        />
      )}
    </>
  );
}
