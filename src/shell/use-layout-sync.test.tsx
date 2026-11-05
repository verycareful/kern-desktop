// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings, WindowLayout, WirePath } from "../ipc";
import { SETTINGS } from "../settings/test-settings";

const ipc = vi.hoisted(() => ({
  layoutGet: vi.fn(),
  layoutSet: vi.fn(),
  settingsGet: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import { WRITE_DELAY_MS, flushLayout, useLayoutSync } from "./use-layout-sync";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const NONE: WindowLayout = {
  left_width: 280,
  left_open: true,
  right_width: 280,
  tree_root: null,
};
const wireError = (message: string) => ({ kind: "Io", message, path: null, details: null });

/** What layout.json holds, as the two commands see it. */
let disk: WindowLayout;
/** kern://settings-changed, as the hook listens to it. */
let settingsChanged: ((s: Settings) => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  disk = { ...NONE };
  useLayout.getState().reset();
  useOps.setState({ notice: null });
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  settingsChanged = undefined;
  useTabs.setState({ tabs: [], activeId: null });
  ipc.on.mockImplementation((name: string, handler: (s: Settings) => void) => {
    if (name === "kern://settings-changed") settingsChanged = handler;
    return Promise.resolve(() => undefined);
  });
  ipc.layoutGet.mockImplementation(() => Promise.resolve({ ...disk }));
  ipc.layoutSet.mockImplementation((patch: Partial<WindowLayout>) => {
    disk = { ...disk, ...patch };
    return Promise.resolve({ ...disk });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const wait = () => act(async () => void (await vi.advanceTimersByTimeAsync(WRITE_DELAY_MS + 10)));

test("the_setting_is_the_layout_and_the_columns_and_tree_are_remembered", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, default_layout: "editor" });
  const first = renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "editor", loaded: true });
  await wait();
  expect(ipc.layoutSet).not.toHaveBeenCalled();

  // The column and the tree change: one write after the last change, and no layout in it.
  act(() => {
    useLayout.getState().setLeftWidth(333);
    useLayout.getState().setLeftWidth(340);
    useLayout.getState().toggleLeft();
    useLayout.getState().setTreeRoot(p("/home/a/work"));
  });
  expect(ipc.layoutSet).not.toHaveBeenCalled();
  await wait();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({
    left_width: 340,
    left_open: false,
    tree_root: p("/home/a/work"),
  });
  first.unmount();

  // A restart: the columns and tree are read back, the layout is the setting's.
  useLayout.getState().reset();
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({
    layout: "file_manager",
    leftWidth: 340,
    leftOpen: false,
    treeRoot: p("/home/a/work"),
    loaded: true,
  });
  await wait();
  expect(ipc.layoutSet).toHaveBeenCalledTimes(1);
});

test("a_changed_layout_setting_applies_at_once_and_closes_the_folder_tabs", async () => {
  useTabs.getState().openFolder(p("/home/a/work"), false);
  useTabs.getState().openDoc(p("/home/a/work/n.md"));
  useTabs.getState().openTrash();
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState().layout).toBe("file_manager");
  // The folder tab in front gives the tree its folder.
  useTabs.getState().activate(useTabs.getState().tabs[0]!.id);
  await act(async () => settingsChanged!({ ...SETTINGS, default_layout: "editor" }));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "editor", treeRoot: p("/home/a/work") });
  expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["doc", "trash"]);
  // Back to the file manager: the documents and the Trash stay.
  await act(async () => settingsChanged!(SETTINGS));
  await settle();
  expect(useLayout.getState().layout).toBe("file_manager");
  expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["doc", "trash"]);
});

test("an_editor_window_does_not_follow_the_layout_setting", async () => {
  renderHook(() => useLayoutSync(false));
  await settle();
  expect(settingsChanged).toBeUndefined();
});

test("what_changed_last_is_written_when_the_window_goes", async () => {
  const hook = renderHook(() => useLayoutSync(true));
  await settle();
  act(() => useLayout.getState().setLeftWidth(400));
  hook.unmount();
  await settle();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({ left_width: 400 });
});

test("a_dragged_pinned_and_recent_width_is_written", async () => {
  const hook = renderHook(() => useLayoutSync(true));
  await settle();
  act(() => useLayout.getState().setRightWidth(360));
  hook.unmount();
  await settle();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({ right_width: 360 });
});

test("an_editor_window_reads_the_width_and_never_writes", async () => {
  disk = { ...NONE, left_width: 420 };
  renderHook(() => useLayoutSync(false));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "editor", leftWidth: 420, loaded: true });
  act(() => useLayout.getState().setLeftWidth(500));
  await wait();
  expect(ipc.layoutSet).not.toHaveBeenCalled();
});

test("a_layout_that_cannot_be_read_is_said_and_the_default_stands", async () => {
  ipc.layoutGet.mockRejectedValue(wireError("disk gone"));
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "file_manager", loaded: true });
  expect(useOps.getState().notice?.text).toMatch(/stored layout could not be read: .*disk gone/);
});

test("a_layout_setting_that_cannot_be_read_is_said_and_the_file_manager_is_used", async () => {
  ipc.settingsGet.mockRejectedValue(wireError("no settings"));
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "file_manager", loaded: true });
  expect(useOps.getState().notice?.text).toMatch(/layout setting could not be read.*no settings/);
});

test("a_layout_that_cannot_be_saved_is_said_and_tried_again_with_the_next_change", async () => {
  renderHook(() => useLayoutSync(true));
  await settle();
  ipc.layoutSet.mockRejectedValueOnce(wireError("read-only disk"));
  act(() => useLayout.getState().setLeftWidth(350));
  await wait();
  expect(useOps.getState().notice?.text).toMatch(/could not be saved: .*read-only disk/);
  // Nothing was stored, so the next write still carries the width.
  act(() => useLayout.getState().toggleLeft());
  await wait();
  expect(ipc.layoutSet).toHaveBeenLastCalledWith({ left_width: 350, left_open: false });
});

test("a_layout_that_could_not_be_read_is_still_written_when_it_changes", async () => {
  ipc.layoutGet.mockRejectedValue(wireError("disk gone"));
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useOps.getState().notice?.text).toMatch(/stored layout could not be read/);
  act(() => useLayout.getState().setLeftWidth(410));
  await wait();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({ left_width: 410 });
});

test("a_closing_window_waits_for_its_last_layout_change_to_be_written", async () => {
  let finish!: () => void;
  ipc.layoutSet.mockImplementation(
    (patch: Partial<WindowLayout>) =>
      new Promise((resolve) => {
        finish = () => resolve({ ...disk, ...patch });
      })
  );
  renderHook(() => useLayoutSync(true));
  await settle();
  act(() => useLayout.getState().setLeftWidth(450));
  // Not written yet (the delay has not passed): the flush writes it now and waits for the answer.
  let done = false;
  const flushed = flushLayout().then(() => (done = true));
  await settle();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({ left_width: 450 });
  expect(done).toBe(false);
  finish();
  await act(async () => void (await flushed));
  expect(done).toBe(true);
});

test("a_flush_that_fails_is_said_and_does_not_hold_the_window", async () => {
  renderHook(() => useLayoutSync(true));
  await settle();
  ipc.layoutSet.mockRejectedValue(wireError("read-only disk"));
  act(() => useLayout.getState().toggleLeft());
  await act(async () => void (await flushLayout()));
  expect(useOps.getState().notice?.text).toMatch(/could not be saved: .*read-only disk/);
});
