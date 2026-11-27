// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { OpenOutcome, WirePath } from "../ipc";
import { useTabs } from "../store/tabs";
import { entry } from "./test-entries";

const ipc = vi.hoisted(() => ({ openPaths: vi.fn(), recentTouch: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { openEntries, openFiles } from "./open-entries";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const outcome = (over: Partial<OpenOutcome>): OpenOutcome => ({
  path: p("/d/a"),
  action: "doc_tab",
  location: null,
  error: null,
  ...over,
});

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
  useTabs.getState().openFolder(p("/d"), false);
  ipc.openPaths.mockReset();
  ipc.recentTouch.mockReset();
  ipc.recentTouch.mockResolvedValue({ entries: [] });
  useOps.setState({ notice: null });
});

// The backend sends the directive for these outcomes to the main window, which
// applies it; applying the outcome here as well would do it twice.
test("outcomes_that_the_directive_also_carries_are_not_applied_again", async () => {
  const before = useTabs.getState().tabs;
  const id = useTabs.getState().activeId!;
  for (const o of [
    outcome({ action: "doc_tab" }),
    outcome({ action: "folder_tab" }),
    outcome({ action: "focus", location: { kind: "tab", window: "main", tab_id: id } }),
    outcome({ action: "doc_window", location: { kind: "window", label: "doc-1" } }),
    outcome({ action: "default_app" }),
  ]) {
    ipc.openPaths.mockResolvedValue([o]);
    expect(await openEntries([entry("a")], false, id)).toEqual([]);
  }
  expect(useTabs.getState().tabs).toEqual(before);
  expect(useTabs.getState().activeId).toBe(id);
});

test("failed_items_and_errors_are_still_reported", async () => {
  const id = useTabs.getState().activeId!;
  ipc.openPaths.mockResolvedValue([
    outcome({ action: "failed" }),
    outcome({
      action: "failed",
      error: { kind: "Io", message: "denied", path: null, details: null },
    }),
  ]);
  const errors = await openEntries([entry("a"), entry("b")], false, id);
  expect(errors.map((e) => e.kind)).toEqual(["Open", "Io"]);
});

// A new document tab or window is put in Recent by its editor once the file is read.
test("a_file_open_once_the_command_answers_goes_into_Recent", async () => {
  ipc.openPaths.mockResolvedValue([
    outcome({ path: p("/d/photo.png"), action: "default_app" }),
    outcome({ path: p("/d/open.md"), action: "focus" }),
    outcome({ path: p("/d/moved.md"), action: "moving" }),
    outcome({ path: p("/d/new.md"), action: "doc_tab" }),
    outcome({ path: p("/d/own.pdf"), action: "doc_window" }),
    outcome({ path: p("/d/sub"), action: "folder_tab" }),
  ]);
  expect(await openFiles([p("/d/x")], false)).toEqual([]);
  expect(ipc.recentTouch.mock.calls.map((c) => c[0])).toEqual([
    p("/d/photo.png"),
    p("/d/open.md"),
    p("/d/moved.md"),
  ]);
});

test("a_file_that_failed_to_open_is_not_put_in_Recent", async () => {
  ipc.openPaths.mockResolvedValue([
    outcome({ action: "failed" }),
    outcome({
      action: "default_app",
      error: { kind: "Launch", message: "exec failed", path: null, details: null },
    }),
  ]);
  expect(await openFiles([p("/d/x")], false)).toHaveLength(2);
  expect(ipc.recentTouch).not.toHaveBeenCalled();
});

test("a_Recent_entry_that_cannot_be_written_is_said_and_is_not_an_open_error", async () => {
  ipc.recentTouch.mockRejectedValue({
    kind: "Io",
    message: "disk full",
    path: null,
    details: null,
  });
  ipc.openPaths.mockResolvedValue([outcome({ path: p("/d/photo.png"), action: "default_app" })]);
  expect(await openFiles([p("/d/photo.png")], false)).toEqual([]);
  expect(useOps.getState().notice?.text).toBe(
    "photo.png could not be added to Recent: Io: disk full"
  );
});
