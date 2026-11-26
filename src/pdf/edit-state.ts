// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PdfEditAnswer, PdfOp } from "../ipc";

// What the app knows of a PDF's edits. The engine is the one that knows: every edit, undo and
// redo answers with the document's state, and this keeps that answer and nothing the app
// counted itself.

export interface EditState {
  /** The engine's count of steps done, undone and redone; it only grows. */
  revision: number;
  pages: number;
  canUndo: boolean;
  canRedo: boolean;
  /** The document differs from the file as opened or as last saved. */
  modified: boolean;
  /** For each page, the revision at which it last changed: what a picture of it is keyed by. */
  pageRevisions: readonly number[];
}

/** The state of a document just opened at `revision`: nothing to undo, nothing changed. */
export function openedEdit(revision: number, pages: number): EditState {
  return {
    revision,
    pages,
    canUndo: false,
    canRedo: false,
    modified: false,
    pageRevisions: Array.from({ length: pages }, () => revision),
  };
}

/**
 * The state after the document was written to a file: it then equals its file, and the history
 * stays (an undo goes back past the save, and the document differs from the file again).
 */
export function afterSave(state: EditState): EditState {
  return state.modified ? { ...state, modified: false } : state;
}

/**
 * The state after the engine answered an edit, an undo or a redo. An answer that is not newer
 * than the state is an older one that arrived late, and changes nothing.
 */
export function afterEdit(state: EditState, answer: PdfEditAnswer): EditState {
  if (answer.revision <= state.revision) return state;
  const changed = new Set(answer.changed_pages);
  return {
    revision: answer.revision,
    pages: answer.pages,
    canUndo: answer.can_undo,
    canRedo: answer.can_redo,
    modified: answer.modified,
    // A page the answer does not name keeps its revision; one that did not exist before is new.
    pageRevisions: Array.from({ length: answer.pages }, (_, page) =>
      changed.has(page) ? answer.revision : (state.pageRevisions[page] ?? answer.revision)
    ),
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type DatedOp = Extract<PdfOp, { modified: string }>;

/** An op as a caller writes it: the ops that carry a date have none, `apply` writes it. */
export type PdfOpInput = Exclude<PdfOp, DatedOp> | DistributiveOmit<DatedOp, "modified">;

const DATED_OPS: ReadonlySet<PdfOp["op"]> = new Set([
  "addMarkup",
  "addInk",
  "addNote",
  "editAnnotation",
]);

/**
 * `op` with the date `modified` on the ops that take one. The engine refuses a field an op does
 * not have, so a rotation, a reorder and the like are passed on as they are.
 */
export function stampOp(op: PdfOpInput, modified: string): PdfOp {
  // The cast joins the two halves of `PdfOpInput`: a dated op gets its date, any other has none.
  return (DATED_OPS.has(op.op) ? { ...op, modified } : op) as PdfOp;
}
