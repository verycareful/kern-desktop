// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WirePath } from "../ipc";

// A window's tabs are kept in session.json once it is ready, one report at a time, the latest
// state last; a failed report is said and the next change sends the state again.

const ipc = vi.hoisted(() => ({ sessionPut: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import { sessionSnapshot, useSessionSync } from "./use-session-sync";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, views: {}, selectRequests: {} });
  useLayout.getState().reset();
  ipc.sessionPut.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

test("a_snapshot_names_each_tab_by_kind_and_the_one_in_front_by_index", () => {
  const tabs = [
    { id: "a", kind: "folder" as const, path: p("/d"), history: [p("/"), p("/d")], cursor: 1 },
    { id: "b", kind: "doc" as const, path: p("/d/n.md"), dirty: true },
    { id: "c", kind: "trash" as const },
    { id: "e", kind: "documents" as const },
  ];
  expect(sessionSnapshot(tabs, "b", null)).toEqual({
    root: null,
    tabs: [
      { kind: "folder", path: p("/d") },
      { kind: "doc", path: p("/d/n.md") },
      { kind: "trash" },
      { kind: "documents" },
    ],
    active: 1,
  });
  expect(sessionSnapshot([], null, p("/r"))).toEqual({ root: p("/r"), tabs: [], active: null });
});

test("nothing_is_reported_before_the_window_is_ready_or_from_settings", async () => {
  useTabs.getState().openFolder(p("/d"), true);
  const { rerender } = renderHook(({ ready }) => useSessionSync("main", ready), {
    initialProps: { ready: false },
  });
  renderHook(() => useSessionSync(null, true));
  await act(async () => {});
  expect(ipc.sessionPut).not.toHaveBeenCalled();
  rerender({ ready: true });
  await waitFor(() =>
    expect(ipc.sessionPut).toHaveBeenCalledWith(null, [{ kind: "folder", path: p("/d") }], 0)
  );
  expect(ipc.sessionPut).toHaveBeenCalledTimes(1);
});

test("one_report_is_sent_at_a_time_and_the_latest_state_is_sent_last", async () => {
  let release: () => void = () => undefined;
  ipc.sessionPut.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
  renderHook(() => useSessionSync("main", true));
  await waitFor(() => expect(ipc.sessionPut).toHaveBeenCalledTimes(1));
  act(() => {
    useTabs.getState().openFolder(p("/one"), true);
    useTabs.getState().openFolder(p("/two"), true);
  });
  // The first report has not answered: nothing more is sent yet.
  expect(ipc.sessionPut).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await waitFor(() => expect(ipc.sessionPut).toHaveBeenCalledTimes(2));
  expect(ipc.sessionPut).toHaveBeenLastCalledWith(
    null,
    [
      { kind: "folder", path: p("/one") },
      { kind: "folder", path: p("/two") },
    ],
    1
  );
});

test("a_change_that_does_not_change_what_is_kept_sends_nothing", async () => {
  useTabs.getState().openDoc(p("/d/n.md"));
  renderHook(() => useSessionSync("main", true));
  await waitFor(() => expect(ipc.sessionPut).toHaveBeenCalledTimes(1));
  const id = useTabs.getState().tabs[0]!.id;
  act(() => useTabs.getState().setDirty(id, true));
  await act(async () => {});
  expect(ipc.sessionPut).toHaveBeenCalledTimes(1);
});

test("an_editor_window_reports_its_folder_and_again_when_it_changes", async () => {
  useLayout.getState().setTreeRoot(p("/proj"));
  renderHook(() => useSessionSync("editor", true));
  await waitFor(() => expect(ipc.sessionPut).toHaveBeenCalledWith(p("/proj"), [], null));
  act(() => useLayout.getState().setTreeRoot(p("/other")));
  await waitFor(() => expect(ipc.sessionPut).toHaveBeenLastCalledWith(p("/other"), [], null));
});

test("a_failed_report_is_said_and_the_next_change_sends_the_state_again", async () => {
  ipc.sessionPut.mockRejectedValueOnce({
    kind: "Io",
    message: "disk full",
    path: null,
    details: null,
  });
  const { result } = renderHook(() => useSessionSync("main", true));
  await waitFor(() => expect(result.current.error).toMatchObject({ kind: "Io" }));
  act(() => useTabs.getState().openTrash());
  await waitFor(() => expect(result.current.error).toBeNull());
  expect(ipc.sessionPut).toHaveBeenLastCalledWith(null, [{ kind: "trash" }], 0);
});
