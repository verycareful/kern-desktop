// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { OpConflictEvent, OpDoneEvent, WireError, WirePath } from "../ipc";

const ipc = vi.hoisted(() => ({
  dropStartOp: vi.fn(),
  answerConflict: vi.fn(),
  cancelOp: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { EVENT_OP_CONFLICT, EVENT_OP_DONE } from "../ipc";
import { copyBeside } from "./pdf-copy";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");
const COPY = p("/home/a/book (2).pdf");
const OP = 7;
const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});
const done = (over: Partial<OpDoneEvent> = {}): OpDoneEvent => ({
  op: OP,
  report: {
    done: [{ source: FILE, dest: COPY }],
    skipped: [],
    failed: [],
    warnings: [],
    cancelled: false,
    not_reached: [],
  },
  properties: null,
  scan: null,
  error: null,
  ...over,
});
const conflict: OpConflictEvent = {
  op: OP,
  conflict: 1,
  source: FILE,
  existing: FILE,
  source_entry: null,
  existing_entry: null,
};

let handlers: Record<string, (payload: unknown) => void>;

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  ipc.on.mockImplementation(async (name: string, handler: (payload: unknown) => void) => {
    handlers[name] = handler;
    return () => undefined;
  });
  ipc.answerConflict.mockResolvedValue(undefined);
  ipc.cancelOp.mockResolvedValue(undefined);
});

/** The operation answers the way the backend does: the name is taken, and the copy ends. */
const runs = (end: OpDoneEvent) =>
  ipc.dropStartOp.mockImplementation(async () => {
    queueMicrotask(() => {
      handlers[EVENT_OP_CONFLICT]?.(conflict);
      handlers[EVENT_OP_DONE]?.(end);
    });
    return OP;
  });

test("copies_the_file_into_its_own_folder_and_answers_where_the_copy_is", async () => {
  runs(done());
  await expect(copyBeside(FILE)).resolves.toEqual(COPY);
  expect(ipc.dropStartOp).toHaveBeenCalledExactlyOnceWith("copy", [FILE], p("/home/a"));
});

test("the_name_being_taken_is_answered_by_keeping_both_never_by_replacing", async () => {
  runs(done());
  await copyBeside(FILE);
  expect(ipc.answerConflict).toHaveBeenCalledExactlyOnceWith(OP, 1, "keep_both", false);
});

test("a_copy_that_ends_with_an_error_is_that_error", async () => {
  runs(done({ report: null, error: wireError("Io", "disk full") }));
  await expect(copyBeside(FILE)).rejects.toMatchObject({ kind: "Io", message: "disk full" });
});

test("an_item_that_failed_is_its_error", async () => {
  const report = done().report!;
  runs(
    done({
      report: { ...report, done: [], failed: [{ path: FILE, error: wireError("Io", "denied") }] },
    })
  );
  await expect(copyBeside(FILE)).rejects.toMatchObject({ kind: "Io", message: "denied" });
});

test("a_cancelled_copy_is_not_taken_for_a_copy", async () => {
  const report = done().report!;
  runs(done({ report: { ...report, done: [], cancelled: true } }));
  await expect(copyBeside(FILE)).rejects.toMatchObject({ message: "the copy was cancelled" });
});

test("a_copy_that_made_nothing_is_an_error", async () => {
  const report = done().report!;
  runs(done({ report: { ...report, done: [] } }));
  await expect(copyBeside(FILE)).rejects.toMatchObject({ message: "the copy was not made" });
});

test("a_failure_to_start_is_the_error_of_the_start", async () => {
  ipc.dropStartOp.mockRejectedValue(wireError("NotFound"));
  await expect(copyBeside(FILE)).rejects.toMatchObject({ kind: "NotFound" });
});

test("an_answer_that_does_not_arrive_stops_the_copy", async () => {
  ipc.answerConflict.mockRejectedValue(wireError("UnknownConflict"));
  ipc.dropStartOp.mockImplementation(async () => {
    queueMicrotask(() => {
      handlers[EVENT_OP_CONFLICT]?.(conflict);
      // The worker is told to stop and ends as cancelled.
      setTimeout(() => {
        const report = done().report!;
        handlers[EVENT_OP_DONE]?.(done({ report: { ...report, done: [], cancelled: true } }));
      }, 5);
    });
    return OP;
  });
  await expect(copyBeside(FILE)).rejects.toMatchObject({ message: "the copy was cancelled" });
  expect(ipc.cancelOp).toHaveBeenCalledWith(OP);
});

test("a_file_with_no_folder_is_refused_before_anything_starts", async () => {
  await expect(copyBeside(p("book.pdf"))).rejects.toMatchObject({
    message: "the file has no folder to copy it into",
  });
  expect(ipc.dropStartOp).not.toHaveBeenCalled();
});
