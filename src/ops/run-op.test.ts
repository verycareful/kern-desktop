// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { OpConflictEvent, OpDoneEvent, OpProgressEvent } from "../ipc";

const ipc = vi.hoisted(() => ({ on: vi.fn(), cancelOp: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { runOp } from "./run-op";

let handlers: Record<string, (payload: never) => void>;
let unlistened: string[];
beforeEach(() => {
  handlers = {};
  unlistened = [];
  ipc.cancelOp.mockReset();
  ipc.on.mockImplementation((name: string, h: (payload: never) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => unlistened.push(name));
  });
});

const progress = (op: number, done: number): OpProgressEvent => ({
  op,
  done,
  total: 4,
  unit: "items",
  stage: "",
});
const finished = (op: number): OpDoneEvent => ({
  op,
  report: null,
  properties: null,
  scan: null,
  error: null,
});

test("events_of_other_operations_are_ignored_and_the_done_event_ends_the_run", async () => {
  const seen: number[] = [];
  const run = runOp(
    async () => 7,
    (p) => seen.push(p.done)
  );
  await vi.waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  await new Promise((r) => setTimeout(r, 0));
  handlers["kernkraft://op-progress"]!(progress(8, 1) as never);
  handlers["kernkraft://op-progress"]!(progress(7, 2) as never);
  handlers["kernkraft://op-done"]!(finished(8) as never);
  handlers["kernkraft://op-done"]!(finished(7) as never);
  expect((await run.done).op).toBe(7);
  expect(seen).toEqual([2]);
  expect(unlistened.sort()).toEqual(["kernkraft://op-done", "kernkraft://op-progress"]);
});

test("events_that_arrive_before_the_id_do_not_get_lost", async () => {
  const run = runOp(
    async () => {
      // The operation reports and ends before the start command has answered.
      handlers["kernkraft://op-progress"]!(progress(3, 1) as never);
      handlers["kernkraft://op-done"]!(finished(5) as never);
      handlers["kernkraft://op-done"]!(finished(3) as never);
      return 3;
    },
    () => undefined
  );
  expect((await run.done).op).toBe(3);
});

test("a_failed_start_rejects_with_the_error_and_unsubscribes", async () => {
  const error = { kind: "Busy", message: "an operation is running", path: null, details: null };
  const run = runOp(
    () => Promise.reject(error),
    () => undefined
  );
  await expect(run.done).rejects.toEqual(error);
  expect(unlistened).toHaveLength(2);
});

test("cancel_asks_for_the_operation_by_its_id", async () => {
  ipc.cancelOp.mockResolvedValue(undefined);
  const run = runOp(
    async () => 9,
    () => undefined
  );
  await run.cancel();
  expect(ipc.cancelOp).toHaveBeenCalledWith(9);
  await vi.waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  handlers["kernkraft://op-done"]!(finished(9) as never);
  await run.done;
});

const asked = (op: number, conflict: number): OpConflictEvent => ({
  op,
  conflict,
  source: { k: "Utf8", v: "/a/x" },
  existing: { k: "Utf8", v: "/b/x" },
  source_entry: null,
  existing_entry: null,
});

test("conflicts_of_this_operation_are_passed_on_and_those_of_others_are_not", async () => {
  const seen: number[] = [];
  const run = runOp(
    async () => 7,
    () => undefined,
    (c) => seen.push(c.conflict)
  );
  await vi.waitFor(() => expect(handlers["kernkraft://op-conflict"]).toBeDefined());
  await new Promise((r) => setTimeout(r, 0));
  handlers["kernkraft://op-conflict"]!(asked(8, 1) as never);
  handlers["kernkraft://op-conflict"]!(asked(7, 2) as never);
  handlers["kernkraft://op-done"]!(finished(7) as never);
  await run.done;
  expect(seen).toEqual([2]);
  expect(unlistened).toContain("kernkraft://op-conflict");
});

test("a_conflict_that_arrives_before_the_id_is_known_is_kept", async () => {
  const seen: number[] = [];
  const run = runOp(
    async () => {
      // The worker asks before the start command has answered.
      handlers["kernkraft://op-conflict"]!(asked(3, 1) as never);
      handlers["kernkraft://op-conflict"]!(asked(4, 9) as never);
      return 3;
    },
    () => undefined,
    (c) => seen.push(c.conflict)
  );
  await vi.waitFor(() => expect(seen).toEqual([1]));
  handlers["kernkraft://op-done"]!(finished(3) as never);
  await run.done;
});

test("an_operation_without_a_conflict_handler_subscribes_to_no_conflicts", async () => {
  const run = runOp(
    async () => 2,
    () => undefined
  );
  await vi.waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  handlers["kernkraft://op-done"]!(finished(2) as never);
  await run.done;
  expect(handlers["kernkraft://op-conflict"]).toBeUndefined();
});
