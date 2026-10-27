// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { OpenOutcome, WirePath } from "../ipc";
import { useTabs } from "../store/tabs";
import { entry } from "./test-entries";

const ipc = vi.hoisted(() => ({ openPaths: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { openEntries } from "./open-entries";

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
});

// The backend sends the directive for these outcomes to the main window, which
// applies it; applying the outcome here as well would do it twice.
test("outcomes_that_the_directive_also_carries_are_not_applied_again", async () => {
  const before = useTabs.getState().tabs;
  const id = useTabs.getState().activeId!;
  for (const o of [
    outcome({ action: "doc_tab" }),
    outcome({ action: "folder_tab" }),
    outcome({ action: "focus", location: { kind: "tab", tab_id: id } }),
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
