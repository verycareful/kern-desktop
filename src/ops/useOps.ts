// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  answerConflict,
  redo,
  startOp,
  toWireError,
  undo,
  undoState,
  type ConflictChoice,
  type OpConflictEvent,
  type OpKind,
  type OpProgressEvent,
  type WireError,
  type WirePath,
  type WireReport,
} from "../ipc";
import { opLabels } from "./labels";
import { needsAttention, type Outcome } from "./outcome";
import { runOp, type RunningOp } from "./run-op";

// The file operations in flight, their name conflicts, the reports waiting to
// be read, the status bar's message, and undo (design 5.1, 5.7; Review Focus 5).
// Several operations may run at once: each holds at most one open question,
// because its worker waits for the answer. An operation that ends cleanly
// leaves a message in the status bar; one with anything skipped, failed,
// warned about, cancelled or not reached leaves a report that stays until it
// is read. Whatever fails to start, to be answered or to be cancelled is
// reported the same way.

/** How long a status bar message stays: two short sentences read at about 240 words a minute take 6 s, and it is gone before the next thing the user does. */
export const NOTICE_MS = 6000;

export interface OpView {
  /** Identifies the operation in this store, from the moment it starts. */
  key: number;
  kind: OpKind;
  /** What the progress panel says. */
  running: string;
  progress: OpProgressEvent | null;
  /** The name conflict the worker waits on, if any. */
  conflict: OpConflictEvent | null;
  /** Counts the questions asked in this store, so the one asked first is answered first. */
  askedAt: number;
  /** Cancel was pressed; the operation still ends with a report of what was done. */
  cancelling: boolean;
}

export interface QueuedReport {
  id: number;
  outcome: Outcome;
}

export interface OpEnd {
  report: WireReport | null;
  error: WireError | null;
}

export interface OpSpec {
  kind: OpKind;
  sources: WirePath[];
  dest?: WirePath;
  /** Called once the operation has ended and been reported. */
  onEnd?(end: OpEnd): void;
}

interface OpsState {
  ops: OpView[];
  reports: QueuedReport[];
  notice: { id: number; text: string } | null;
  /** What undo and redo would do now (kernkraft's undo_state), for the Edit menu. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** Counts the undos and redos that ran, so views of what they change can list again. */
  changes: number;
  /** Runs an operation; settles once it has ended and been reported. */
  start(spec: OpSpec): Promise<void>;
  answer(key: number, choice: ConflictChoice, applyToAll: boolean): void;
  cancel(key: number): void;
  report(outcome: Outcome): void;
  dismissReport(id: number): void;
  notify(text: string): void;
  clearNotice(id: number): void;
  runUndo(which: "undo" | "redo"): Promise<void>;
  refreshUndo(): Promise<void>;
  /** Forgets everything (tests). */
  reset(): void;
}

const handles = new Map<number, RunningOp>();
let nextKey = 1;
let nextReport = 1;
let nextNotice = 1;
let nextAsked = 1;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const BUSY_TEXT = (which: "Undo" | "Redo") =>
  `${which} is not possible while a file operation or another undo or redo is running. Try again when it has finished.`;

/** `Undo trash of notes.md` -> `Undone: trash of notes.md`. */
function undoneText(which: "undo" | "redo", label: string | null): string {
  const word = which === "undo" ? "Undone" : "Redone";
  const rest = label?.slice(label.indexOf(" ") + 1);
  return rest ? `${word}: ${rest}` : `${word}.`;
}

export const useOps = create<OpsState>()((set, get) => ({
  ops: [],
  reports: [],
  notice: null,
  undoLabel: null,
  redoLabel: null,
  changes: 0,

  async start(spec) {
    const key = nextKey++;
    const labels = opLabels(spec.kind, spec.sources, spec.dest);
    set((s) => ({
      ops: [
        ...s.ops,
        {
          key,
          kind: spec.kind,
          running: labels.running,
          progress: null,
          conflict: null,
          askedAt: 0,
          cancelling: false,
        },
      ],
    }));
    const patch = (fn: (o: OpView) => OpView) =>
      set((s) => ({ ops: s.ops.map((o) => (o.key === key ? fn(o) : o)) }));
    let outcome: Outcome;
    try {
      const op = runOp(
        () => startOp(spec.kind, spec.sources, spec.dest),
        (progress) => patch((o) => ({ ...o, progress })),
        // A cancelled operation asks nothing more; a late question is not shown.
        (conflict) => patch((o) => (o.cancelling ? o : { ...o, conflict, askedAt: nextAsked++ }))
      );
      handles.set(key, op);
      const end = await op.done;
      outcome = { title: labels.title, report: end.report, error: end.error };
    } catch (e) {
      outcome = { title: labels.title, report: null, error: toWireError(e) };
    }
    handles.delete(key);
    set((s) => ({ ops: s.ops.filter((o) => o.key !== key) }));
    if (needsAttention(outcome)) get().report(outcome);
    else get().notify(labels.done(outcome.report));
    void get().refreshUndo();
    spec.onEnd?.({ report: outcome.report, error: outcome.error });
  },

  answer(key, choice, applyToAll) {
    const asked = get().ops.find((o) => o.key === key)?.conflict;
    if (!asked) return;
    const patch = (fn: (o: OpView) => OpView) =>
      set((s) => ({ ops: s.ops.map((o) => (o.key === key ? fn(o) : o)) }));
    patch((o) => ({ ...o, conflict: null }));
    answerConflict(asked.op, asked.conflict, choice, applyToAll).catch((e: unknown) => {
      const error = toWireError(e);
      const now = get().ops.find((o) => o.key === key);
      if (error.kind === "UnknownConflict") {
        // The question is not open any more: the operation moved on or was told to stop, and it
        // says how it ended in its own report. Only a question that was not on its way out is news.
        if (!now || now.cancelling) return;
      } else if (now && !now.cancelling && now.conflict === null) {
        // The answer did not arrive, so the worker still waits for it: ask again.
        patch((o) => ({ ...o, conflict: asked }));
      }
      get().report({ title: "Answering a name conflict", report: null, error });
    });
  },

  cancel(key) {
    const op = handles.get(key);
    const asked = get().ops.find((o) => o.key === key)?.conflict ?? null;
    if (!op) return;
    // The question closes with the cancel: the backend releases the worker waiting on it.
    set((s) => ({
      ops: s.ops.map((o) => (o.key === key ? { ...o, cancelling: true, conflict: null } : o)),
    }));
    op.cancel().catch((e: unknown) => {
      // The worker was not told to stop: Cancel works again, and the question it waits on is asked again.
      set((s) => ({
        ops: s.ops.map((o) =>
          o.key === key ? { ...o, cancelling: false, conflict: o.conflict ?? asked } : o
        ),
      }));
      get().report({ title: "Cancelling an operation", report: null, error: toWireError(e) });
    });
  },

  report(outcome) {
    set((s) => ({ reports: [...s.reports, { id: nextReport++, outcome }] }));
  },

  dismissReport(id) {
    set((s) => ({ reports: s.reports.filter((r) => r.id !== id) }));
  },

  notify(text) {
    clearTimeout(noticeTimer);
    const id = nextNotice++;
    set({ notice: { id, text } });
    noticeTimer = setTimeout(() => get().clearNotice(id), NOTICE_MS);
  },

  clearNotice(id) {
    set((s) => (s.notice?.id === id ? { notice: null } : {}));
  },

  async runUndo(which) {
    const label = which === "undo" ? get().undoLabel : get().redoLabel;
    const title = label ?? (which === "undo" ? "Undo" : "Redo");
    try {
      const out = await (which === "undo" ? undo() : redo());
      if (out.warnings.length > 0) {
        get().report({
          title,
          report: {
            done: out.done.map((source) => ({ source, dest: null })),
            skipped: [],
            failed: [],
            warnings: out.warnings,
            cancelled: false,
            not_reached: [],
          },
          error: null,
        });
      }
      get().notify(undoneText(which, label));
    } catch (e) {
      const err = toWireError(e);
      if (err.kind === "Busy") get().notify(BUSY_TEXT(which === "undo" ? "Undo" : "Redo"));
      else if (err.kind === "NothingToUndo") get().notify("Nothing to undo.");
      else if (err.kind === "NothingToRedo") get().notify("Nothing to redo.");
      else get().report({ title, report: null, error: err });
    }
    // Even a refused undo can change what is next on the stack, and part of one may have been done.
    set((s) => ({ changes: s.changes + 1 }));
    await get().refreshUndo();
  },

  async refreshUndo() {
    try {
      const state = await undoState();
      set({ undoLabel: state.undo, redoLabel: state.redo });
    } catch (e) {
      // A failure is kept until it is read: it means Undo and Redo may be wrong or missing, and it
      // repeats with every operation, so one report stands for the same failure.
      const error = toWireError(e);
      const title = "The undo history could not be read";
      const known = get().reports.some(
        (r) => r.outcome.title === title && r.outcome.error?.message === error.message
      );
      if (!known) get().report({ title, report: null, error });
    }
  },

  reset() {
    clearTimeout(noticeTimer);
    handles.clear();
    set({
      ops: [],
      reports: [],
      notice: null,
      undoLabel: null,
      redoLabel: null,
      changes: 0,
    });
  },
}));
