// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OpConflictEvent, OpDoneEvent, OpProgressEvent, WirePath } from "../ipc";

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

import { useTabs } from "../store/tabs";
import { OpsHost } from "./OpsHost";
import { useOps } from "./useOps";

const p = (v: string): WirePath => ({ k: "Utf8", v });
let handlers: Record<string, Array<(payload: never) => void>>;
const emit = (name: string, payload: unknown) =>
  act(() => handlers[name]!.forEach((h) => h(payload as never)));

const progress = (op: number, done: number, total: number, unit = "bytes"): OpProgressEvent => ({
  op,
  done,
  total,
  unit,
  stage: "",
});
const conflict = (op: number, n: number, name = "x"): OpConflictEvent => ({
  op,
  conflict: n,
  source: p(`/a/${name}`),
  existing: p(`/b/${name}`),
  source_entry: null,
  existing_entry: null,
});
const finish = (op: number): OpDoneEvent => ({
  op,
  report: { done: [], skipped: [], failed: [], warnings: [], cancelled: false, not_reached: [] },
  properties: null,
  scan: null,
  error: null,
});

async function startOpOn(id: number, kind: "copy" | "trash" = "copy") {
  const before = ipc.startOp.mock.calls.length;
  ipc.startOp.mockResolvedValueOnce(id);
  let done!: Promise<void>;
  act(() => {
    done = useOps
      .getState()
      .start({ kind, sources: [p("/a/x")], dest: kind === "copy" ? p("/b") : undefined });
  });
  await vi.waitFor(() => expect(ipc.startOp.mock.calls.length).toBeGreaterThan(before));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
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
afterEach(cleanup);

test("nothing_is_shown_while_nothing_runs", () => {
  render(<OpsHost />);
  expect(screen.queryByTestId("progress-panel")).toBeNull();
});

test("a_running_operation_shows_its_label_and_a_measured_bar", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5);
  const row = screen.getByTestId("op-row");
  expect(row).toHaveTextContent("Copying x to b");
  // Before the first progress event there is nothing to measure against.
  expect(within(row).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  emit("kernkraft://op-progress", progress(5, 512, 2048));
  const bar = within(row).getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "512");
  expect(bar).toHaveAttribute("aria-valuemax", "2048");
  expect(row).toHaveTextContent("512 B of 2 KB");
  emit("kernkraft://op-done", finish(5));
  await act(async () => {
    await done;
  });
  expect(screen.queryByTestId("progress-panel")).toBeNull();
});

test("items_are_counted_for_a_trash_operation", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5, "trash");
  emit("kernkraft://op-progress", progress(5, 1, 4, "items"));
  expect(screen.getByTestId("op-row")).toHaveTextContent("1 of 4 items");
  emit("kernkraft://op-done", finish(5));
  await act(async () => {
    await done;
  });
});

test("cancel_works_at_any_time_and_says_so", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5);
  fireEvent.click(screen.getByRole("button", { name: /^Cancel: Copying x to b/ }));
  await vi.waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledWith(5));
  expect(screen.getByTestId("op-row")).toHaveTextContent("Cancelling");
  expect(screen.getByRole("button", { name: /^Cancel: / })).toBeDisabled();
  emit("kernkraft://op-done", finish(5));
  await act(async () => {
    await done;
  });
});

test("a_conflict_opens_one_dialog_and_the_answer_goes_to_its_operation", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5);
  emit("kernkraft://op-conflict", conflict(5, 3));
  expect(screen.getByTestId("op-row")).toHaveTextContent("waiting for an answer");
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
  expect(ipc.answerConflict).toHaveBeenCalledWith(5, 3, "keep_both", true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  emit("kernkraft://op-done", finish(5));
  await act(async () => {
    await done;
  });
});

test("with_two_operations_asking_one_dialog_shows_at_a_time_and_the_next_follows", async () => {
  render(<OpsHost />);
  const first = await startOpOn(1);
  const second = await startOpOn(2);
  emit("kernkraft://op-conflict", conflict(2, 1, "second"));
  emit("kernkraft://op-conflict", conflict(1, 1, "first"));
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  // The operation that asked first is asked first.
  expect(screen.getByTestId("conflict-dialog")).toHaveTextContent("/a/second");
  expect(screen.getByRole("status")).toHaveTextContent("Another operation is also waiting");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(ipc.answerConflict).toHaveBeenLastCalledWith(2, 1, "skip", false);
  expect(screen.getByTestId("conflict-dialog")).toHaveTextContent("/a/first");
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  expect(ipc.answerConflict).toHaveBeenLastCalledWith(1, 1, "replace", false);
  emit("kernkraft://op-done", finish(1));
  emit("kernkraft://op-done", finish(2));
  await act(async () => {
    await Promise.all([first.done, second.done]);
  });
});

test("each_question_starts_with_apply_to_all_unticked", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5);
  emit("kernkraft://op-conflict", conflict(5, 1));
  fireEvent.click(screen.getByRole("checkbox", { name: "Apply to all" }));
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  emit("kernkraft://op-conflict", conflict(5, 2));
  expect(screen.getByRole("checkbox", { name: "Apply to all" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Cancel operation" }));
  emit("kernkraft://op-done", finish(5));
  await act(async () => {
    await done;
  });
});

test("cancel_in_the_dialog_closes_it_and_stops_the_operation", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5);
  emit("kernkraft://op-conflict", conflict(5, 1));
  fireEvent.click(screen.getByRole("button", { name: "Cancel operation" }));
  await vi.waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledWith(5));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  emit("kernkraft://op-done", finish(5));
  await act(async () => {
    await done;
  });
});

test("a_report_appears_over_the_window_when_an_operation_ends_with_a_failure", async () => {
  render(<OpsHost />);
  const { done } = await startOpOn(5);
  emit("kernkraft://op-done", {
    ...finish(5),
    report: {
      ...finish(5).report!,
      failed: [
        { path: p("/a/x"), error: { kind: "Io", message: "disk full", path: null, details: null } },
      ],
    },
  });
  await act(async () => {
    await done;
  });
  expect(screen.getByTestId("report-dialog")).toHaveTextContent("disk full");
});

test("the_undo_history_is_read_once_at_the_start", async () => {
  render(<OpsHost />);
  await vi.waitFor(() => expect(ipc.undoState).toHaveBeenCalledTimes(1));
});

test("a_drop_on_a_tab_that_is_not_a_folder_says_there_is_nowhere_to_put_it", async () => {
  render(<OpsHost />);
  await vi.waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openTrash();
  emit("kern://drop", { paths: [p("/x/f")], position: { x: 1, y: 1 } });
  expect(useOps.getState().notice?.text).toMatch(/only be dropped on a folder tab/);
});

test("a_drop_on_a_folder_tab_is_left_to_its_view", async () => {
  render(<OpsHost />);
  await vi.waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(p("/d"), false);
  emit("kern://drop", { paths: [p("/x/f")], position: { x: 1, y: 1 } });
  expect(useOps.getState().notice).toBeNull();
});
