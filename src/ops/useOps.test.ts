// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  OpConflictEvent,
  OpDoneEvent,
  OpProgressEvent,
  WireError,
  WirePath,
  WireReport,
} from "../ipc";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  startOp: vi.fn(),
  answerConflict: vi.fn(),
  cancelOp: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  undoState: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { NOTICE_MS, useOps } from "./useOps";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const err = (kind: string, message = kind, details: WireError["details"] = null): WireError => ({
  kind,
  message,
  path: null,
  details,
});
const report = (over: Partial<WireReport> = {}): WireReport => ({
  done: [],
  skipped: [],
  failed: [],
  warnings: [],
  cancelled: false,
  not_reached: [],
  ...over,
});
const doneItem = (v: string) => ({ source: p(v), dest: p(`${v}.copy`) });

// Every operation subscribes on its own; an event reaches all of them, as the real one does.
let handlers: Record<string, Array<(payload: never) => void>>;
const emit = (name: string, payload: unknown) =>
  handlers[name]!.forEach((h) => h(payload as never));
const end = (op: number, r: WireReport | null, error: WireError | null = null): OpDoneEvent => ({
  op,
  report: r,
  properties: null,
  scan: null,
  error,
});
const conflict = (op: number, n: number): OpConflictEvent => ({
  op,
  conflict: n,
  source: p("/a/x"),
  existing: p("/b/x"),
  source_entry: null,
  existing_entry: null,
});
const progress = (op: number, done: number, total: number): OpProgressEvent => ({
  op,
  done,
  total,
  unit: "bytes",
  stage: "",
});

/** Starts a copy and waits until its events are subscribed and its id is known. */
async function startCopy(id: number, sources = [p("/a/x"), p("/a/y")]) {
  const before = ipc.startOp.mock.calls.length;
  ipc.startOp.mockResolvedValueOnce(id);
  const done = useOps.getState().start({ kind: "copy", sources, dest: p("/b") });
  await vi.waitFor(() => expect(ipc.startOp.mock.calls.length).toBeGreaterThan(before));
  await new Promise((r) => setTimeout(r, 0));
  // Wrapped: a bare promise returned from an async function would be awaited by the caller.
  return { done };
}

beforeEach(() => {
  handlers = {};
  for (const m of Object.values(ipc)) m.mockReset();
  ipc.on.mockImplementation((name: string, h: (payload: never) => void) => {
    (handlers[name] ??= []).push(h);
    return Promise.resolve(() => undefined);
  });
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  ipc.answerConflict.mockResolvedValue(undefined);
  ipc.cancelOp.mockResolvedValue(undefined);
  useOps.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a_running_operation_is_listed_with_its_progress_until_it_ends", async () => {
  const { done } = await startCopy(5);
  const [op] = useOps.getState().ops;
  expect(op).toMatchObject({ kind: "copy", progress: null, conflict: null, cancelling: false });
  expect(op!.running).toMatch(/Copying 2 items to b/);
  emit("kernkraft://op-progress", progress(5, 10, 40));
  expect(useOps.getState().ops[0]!.progress).toMatchObject({ done: 10, total: 40 });
  emit("kernkraft://op-done", end(5, report({ done: [doneItem("/a/x"), doneItem("/a/y")] })));
  await done;
  expect(useOps.getState().ops).toEqual([]);
});

test("report_shown_when_any_failure", async () => {
  const { done } = await startCopy(1);
  const failed = [{ path: p("/a/y"), error: err("PermissionDenied", "no") }];
  emit("kernkraft://op-done", end(1, report({ done: [doneItem("/a/x")], failed })));
  await done;
  const { reports, notice } = useOps.getState();
  expect(reports).toHaveLength(1);
  expect(reports[0]!.outcome.report?.failed).toEqual(failed);
  expect(reports[0]!.outcome.title).toMatch(/Copy of 2 items to \/b/);
  expect(notice).toBeNull();
});

test.each([
  ["skipped", report({ skipped: [p("/a/x")] })],
  ["warnings", report({ warnings: [{ path: p("/a/x"), error: err("XattrsNotKept") }] })],
  ["cancelled", report({ cancelled: true, not_reached: [p("/a/y")] })],
])("a_report_with_%s_is_shown", async (_name, r) => {
  const { done } = await startCopy(1);
  emit("kernkraft://op-done", end(1, r));
  await done;
  expect(useOps.getState().reports).toHaveLength(1);
});

test("clean_report_toast_only", async () => {
  const { done } = await startCopy(1);
  emit("kernkraft://op-done", end(1, report({ done: [doneItem("/a/x"), doneItem("/a/y")] })));
  await done;
  const { reports, notice } = useOps.getState();
  expect(reports).toEqual([]);
  expect(notice?.text).toMatch(/Copied 2 items to b/);
});

test("a_notice_goes_away_by_itself", async () => {
  vi.useFakeTimers();
  useOps.getState().notify("Done");
  expect(useOps.getState().notice?.text).toBe("Done");
  vi.advanceTimersByTime(NOTICE_MS - 1);
  expect(useOps.getState().notice).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(useOps.getState().notice).toBeNull();
});

test("a_newer_notice_replaces_the_older_and_keeps_its_own_time", async () => {
  vi.useFakeTimers();
  useOps.getState().notify("first");
  vi.advanceTimersByTime(NOTICE_MS - 10);
  useOps.getState().notify("second");
  vi.advanceTimersByTime(20);
  expect(useOps.getState().notice?.text).toBe("second");
});

test("an_operation_that_cannot_start_is_reported_with_the_reason", async () => {
  ipc.startOp.mockRejectedValueOnce(err("Busy", "busy: an undo or redo is running"));
  await useOps.getState().start({ kind: "trash", sources: [p("/a/x")] });
  const { reports, ops } = useOps.getState();
  expect(ops).toEqual([]);
  expect(reports[0]!.outcome.error).toMatchObject({ kind: "Busy" });
  expect(reports[0]!.outcome.title).toMatch(/Move x to the Trash/);
});

test("an_operation_whose_worker_failed_is_reported_with_the_error", async () => {
  const { done } = await startCopy(1);
  emit("kernkraft://op-done", end(1, null, err("Internal", "worker panicked")));
  await done;
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "Internal" });
});

test("a_conflict_is_held_for_its_operation_and_the_answer_names_it", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  expect(useOps.getState().ops[0]!.conflict).toMatchObject({ op: 5, conflict: 3 });
  const key = useOps.getState().ops[0]!.key;
  useOps.getState().answer(key, "keep_both", true);
  expect(ipc.answerConflict).toHaveBeenCalledWith(5, 3, "keep_both", true);
  expect(useOps.getState().ops[0]!.conflict).toBeNull();
  emit("kernkraft://op-done", end(5, report({ done: [doneItem("/a/x")] })));
  await done;
});

test("two_operations_in_flight_each_hold_their_own_conflict", async () => {
  const first = await startCopy(1);
  const second = await startCopy(2);
  emit("kernkraft://op-conflict", conflict(2, 1));
  emit("kernkraft://op-conflict", conflict(1, 7));
  const [a, b] = useOps.getState().ops;
  expect(a!.conflict).toMatchObject({ op: 1, conflict: 7 });
  expect(b!.conflict).toMatchObject({ op: 2, conflict: 1 });
  useOps.getState().answer(b!.key, "skip", false);
  expect(ipc.answerConflict).toHaveBeenCalledWith(2, 1, "skip", false);
  expect(useOps.getState().ops[0]!.conflict).not.toBeNull();
  emit("kernkraft://op-done", end(1, report({ done: [doneItem("/a/x")] })));
  emit("kernkraft://op-done", end(2, report({ done: [doneItem("/a/x")] })));
  await Promise.all([first.done, second.done]);
});

test("a_refused_answer_is_shown", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  ipc.answerConflict.mockRejectedValueOnce(err("UnknownConflict", "no open conflict"));
  useOps.getState().answer(useOps.getState().ops[0]!.key, "replace", false);
  await vi.waitFor(() => expect(useOps.getState().reports).toHaveLength(1));
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "UnknownConflict" });
  emit("kernkraft://op-done", end(5, report()));
  await done;
});

test("cancel_closes_the_question_and_asks_the_backend_to_stop", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  const key = useOps.getState().ops[0]!.key;
  useOps.getState().cancel(key);
  expect(useOps.getState().ops[0]).toMatchObject({ cancelling: true, conflict: null });
  await vi.waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledWith(5));
  // The operation still ends with its report: what was done, what was not reached.
  emit("kernkraft://op-done", end(5, report({ cancelled: true, not_reached: [p("/a/y")] })));
  await done;
  expect(useOps.getState().reports[0]!.outcome.report?.cancelled).toBe(true);
});

test("a_cancel_that_fails_is_shown", async () => {
  const { done } = await startCopy(5);
  ipc.cancelOp.mockRejectedValueOnce(err("UnknownOp", "no running operation 5"));
  useOps.getState().cancel(useOps.getState().ops[0]!.key);
  await vi.waitFor(() => expect(useOps.getState().reports).toHaveLength(1));
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "UnknownOp" });
  emit("kernkraft://op-done", end(5, report()));
  await done;
});

test("what_the_caller_asked_to_know_is_told_when_the_operation_ends", async () => {
  const seen: Array<WireReport | null> = [];
  ipc.startOp.mockResolvedValueOnce(4);
  const done = useOps.getState().start({
    kind: "copy",
    sources: [p("/a/x")],
    dest: p("/b"),
    onEnd: (e) => seen.push(e.report),
  });
  await vi.waitFor(() => expect(ipc.startOp).toHaveBeenCalled());
  await Promise.resolve();
  const r = report({ done: [doneItem("/a/x")] });
  emit("kernkraft://op-done", end(4, r));
  await done;
  expect(seen).toEqual([r]);
});

test("the_undo_labels_are_read_when_an_operation_ends", async () => {
  ipc.undoState.mockResolvedValue({ undo: "Undo copy of 2 items", redo: null });
  const { done } = await startCopy(1);
  emit("kernkraft://op-done", end(1, report({ done: [doneItem("/a/x")] })));
  await done;
  await vi.waitFor(() => expect(useOps.getState().undoLabel).toBe("Undo copy of 2 items"));
  expect(useOps.getState().redoLabel).toBeNull();
});

test("undo_busy_message", async () => {
  ipc.undo.mockRejectedValueOnce(
    err("Busy", "busy: a file operation is running; undo and redo wait until it ends")
  );
  await useOps.getState().runUndo("undo");
  const { notice, reports } = useOps.getState();
  expect(notice?.text).toMatch(/while a file operation/);
  expect(reports).toEqual([]);
});

test("an_undo_that_cannot_be_done_shows_its_reason", async () => {
  ipc.undoState.mockResolvedValue({ undo: "Undo copy of x", redo: null });
  await useOps.getState().refreshUndo();
  ipc.undo.mockRejectedValueOnce(
    err("Irreversible", "copy of x cannot be undone: it replaced an existing item", {
      k: "Irreversible",
      reason: "ReplacedExisting",
    })
  );
  await useOps.getState().runUndo("undo");
  const { reports } = useOps.getState();
  expect(reports).toHaveLength(1);
  expect(reports[0]!.outcome.title).toBe("Undo copy of x");
  expect(reports[0]!.outcome.error).toMatchObject({
    kind: "Irreversible",
    details: { reason: "ReplacedExisting" },
  });
});

test("an_undo_that_finds_a_change_shows_what_changed", async () => {
  ipc.undo.mockRejectedValueOnce(
    err("Changed", "/b/x changed after the operation", { k: "Changed", what: "Modified" })
  );
  await useOps.getState().runUndo("undo");
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({
    kind: "Changed",
    details: { what: "Modified" },
  });
});

test("nothing_to_undo_is_said_in_a_notice", async () => {
  ipc.redo.mockRejectedValueOnce(err("NothingToRedo", "nothing to redo"));
  await useOps.getState().runUndo("redo");
  expect(useOps.getState().notice?.text).toMatch(/Nothing to redo/);
});

test("a_successful_undo_says_what_it_undid_and_refreshes_the_labels", async () => {
  ipc.undoState.mockResolvedValueOnce({ undo: "Undo trash of notes.md", redo: null });
  await useOps.getState().refreshUndo();
  ipc.undo.mockResolvedValueOnce({ done: [p("/d/notes.md")], warnings: [] });
  ipc.undoState.mockResolvedValueOnce({ undo: null, redo: "Redo trash of notes.md" });
  const before = useOps.getState().changes;
  await useOps.getState().runUndo("undo");
  const s = useOps.getState();
  expect(s.notice?.text).toBe("Undone: trash of notes.md");
  expect(s.undoLabel).toBeNull();
  expect(s.redoLabel).toBe("Redo trash of notes.md");
  expect(s.changes).toBe(before + 1);
  expect(s.reports).toEqual([]);
});

test("an_undo_with_warnings_lists_them_in_a_report", async () => {
  const warnings = [{ path: p("/d/a"), error: err("XattrsNotKept", "xattrs") }];
  ipc.redo.mockResolvedValueOnce({ done: [p("/d/a")], warnings });
  await useOps.getState().runUndo("redo");
  expect(useOps.getState().reports[0]!.outcome.report?.warnings).toEqual(warnings);
});

test("an_undo_that_stopped_partway_lists_what_was_and_was_not_done", async () => {
  const cause = err("Changed", "/d/b is gone");
  ipc.undo.mockRejectedValueOnce(
    err("Partial", "stopped after 1 of 2 items", {
      k: "Partial",
      done: [p("/d/a")],
      not_done: [p("/d/b")],
      cause,
      warnings: [],
    })
  );
  await useOps.getState().runUndo("undo");
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "Partial" });
});

test("a_failure_to_read_the_undo_history_stays_until_it_is_dismissed", async () => {
  vi.useFakeTimers();
  ipc.undoState.mockRejectedValue(err("Internal", "journal poisoned"));
  await useOps.getState().refreshUndo();
  expect(useOps.getState().notice).toBeNull();
  const [shown] = useOps.getState().reports;
  expect(shown!.outcome.title).toBe("The undo history could not be read");
  expect(shown!.outcome.error).toMatchObject({ kind: "Internal", message: "journal poisoned" });
  // It is still there long after a notice would have gone.
  vi.advanceTimersByTime(10 * NOTICE_MS);
  expect(useOps.getState().reports).toHaveLength(1);
  useOps.getState().dismissReport(shown!.id);
  expect(useOps.getState().reports).toEqual([]);
});

test("the_same_undo_history_failure_is_not_queued_twice", async () => {
  ipc.undoState.mockRejectedValue(err("Internal", "journal poisoned"));
  await useOps.getState().refreshUndo();
  await useOps.getState().refreshUndo();
  expect(useOps.getState().reports).toHaveLength(1);
  ipc.undoState.mockRejectedValue(err("Internal", "something else"));
  await useOps.getState().refreshUndo();
  expect(useOps.getState().reports).toHaveLength(2);
});

test("a_failed_answer_asks_the_question_again_and_shows_the_error", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  ipc.answerConflict.mockRejectedValueOnce(err("Io", "the answer could not be delivered"));
  useOps.getState().answer(useOps.getState().ops[0]!.key, "replace", true);
  expect(useOps.getState().ops[0]!.conflict).toBeNull();
  await vi.waitFor(() => expect(useOps.getState().reports).toHaveLength(1));
  // The worker still waits, so the same question is open again, as it was asked.
  expect(useOps.getState().ops[0]!.conflict).toMatchObject({ op: 5, conflict: 3 });
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "Io" });
  emit("kernkraft://op-done", end(5, report()));
  await done;
});

test("an_answer_to_a_question_that_is_no_longer_open_does_not_open_it_again", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  ipc.answerConflict.mockRejectedValueOnce(err("UnknownConflict", "no open conflict 3"));
  useOps.getState().answer(useOps.getState().ops[0]!.key, "skip", false);
  await vi.waitFor(() => expect(useOps.getState().reports).toHaveLength(1));
  expect(useOps.getState().ops[0]!.conflict).toBeNull();
  emit("kernkraft://op-done", end(5, report()));
  await done;
});

test("an_unknown_conflict_after_the_operation_began_to_cancel_gives_no_extra_report", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  const key = useOps.getState().ops[0]!.key;
  let refuse!: (e: unknown) => void;
  ipc.answerConflict.mockReturnValueOnce(new Promise((_, rej) => (refuse = rej)));
  useOps.getState().answer(key, "skip", false);
  // Cancel is pressed while the answer is on its way; the worker is released by the cancel,
  // so the answer finds no open question.
  useOps.getState().cancel(key);
  refuse(err("UnknownConflict", "no open conflict 3"));
  await new Promise((r) => setTimeout(r, 0));
  expect(useOps.getState().reports).toEqual([]);
  expect(useOps.getState().ops[0]!.conflict).toBeNull();
  emit("kernkraft://op-done", end(5, report({ cancelled: true, not_reached: [p("/a/y")] })));
  await done;
  // Only the cancelled operation's own report.
  expect(useOps.getState().reports).toHaveLength(1);
});

test("a_failed_cancel_can_be_pressed_again_and_the_open_question_is_asked_again", async () => {
  const { done } = await startCopy(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  const key = useOps.getState().ops[0]!.key;
  ipc.cancelOp.mockRejectedValueOnce(err("Ipc", "the call failed"));
  useOps.getState().cancel(key);
  expect(useOps.getState().ops[0]).toMatchObject({ cancelling: true, conflict: null });
  await vi.waitFor(() => expect(useOps.getState().reports).toHaveLength(1));
  // The operation was not told to stop: Cancel works again and its question is back.
  expect(useOps.getState().ops[0]).toMatchObject({ cancelling: false });
  expect(useOps.getState().ops[0]!.conflict).toMatchObject({ op: 5, conflict: 3 });
  expect(useOps.getState().reports[0]!.outcome.error).toMatchObject({ kind: "Ipc" });
  useOps.getState().cancel(key);
  await vi.waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledTimes(2));
  expect(useOps.getState().ops[0]!.cancelling).toBe(true);
  emit("kernkraft://op-done", end(5, report({ cancelled: true })));
  await done;
});

test("a_report_is_dismissed_by_its_id", async () => {
  useOps.getState().report({ title: "A", report: null, error: err("Io") });
  useOps.getState().report({ title: "B", report: null, error: err("Io") });
  const [a, b] = useOps.getState().reports;
  useOps.getState().dismissReport(a!.id);
  expect(useOps.getState().reports.map((r) => r.id)).toEqual([b!.id]);
});
