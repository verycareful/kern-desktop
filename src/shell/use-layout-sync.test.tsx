// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WindowLayout, WirePath } from "../ipc";
import { SETTINGS } from "../settings/test-settings";

const ipc = vi.hoisted(() => ({ layoutGet: vi.fn(), layoutSet: vi.fn(), settingsGet: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { WRITE_DELAY_MS, flushLayout, useLayoutSync } from "./use-layout-sync";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const NONE: WindowLayout = { layout: null, left_width: 280, left_open: true, tree_root: null };
const wireError = (message: string) => ({ kind: "Io", message, path: null, details: null });

/** What layout.json holds, as the two commands see it. */
let disk: WindowLayout;

beforeEach(() => {
  vi.useFakeTimers();
  disk = { ...NONE };
  useLayout.getState().reset();
  useOps.setState({ notice: null });
  ipc.settingsGet.mockResolvedValue(SETTINGS);
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

test("layout_remembered", async () => {
  // First run: nothing chosen, so the default layout setting decides, and nothing is written.
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, default_layout: "editor" });
  const first = renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "editor", chosen: false, loaded: true });
  await wait();
  expect(ipc.layoutSet).not.toHaveBeenCalled();

  // The user changes the layout, the column and the tree: one write after the last change.
  act(() => {
    useLayout.getState().setLayout("file_manager");
    useLayout.getState().setLeftWidth(333);
    useLayout.getState().setLeftWidth(340);
    useLayout.getState().toggleLeft();
    useLayout.getState().setTreeRoot(p("/home/a/work"));
  });
  expect(ipc.layoutSet).not.toHaveBeenCalled();
  await wait();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({
    layout: "file_manager",
    left_width: 340,
    left_open: false,
    tree_root: p("/home/a/work"),
  });
  first.unmount();

  // A restart: a new window reads what was written, and the default no longer decides.
  useLayout.getState().reset();
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({
    layout: "file_manager",
    chosen: true,
    leftWidth: 340,
    leftOpen: false,
    treeRoot: p("/home/a/work"),
    loaded: true,
  });
  await wait();
  expect(ipc.layoutSet).toHaveBeenCalledTimes(1);
});

test("what_changed_last_is_written_when_the_window_goes", async () => {
  const hook = renderHook(() => useLayoutSync(true));
  await settle();
  act(() => useLayout.getState().setLeftWidth(400));
  hook.unmount();
  await settle();
  expect(ipc.layoutSet).toHaveBeenCalledExactlyOnceWith({ left_width: 400 });
});

test("an_editor_window_reads_the_width_and_never_writes", async () => {
  disk = { ...NONE, layout: "file_manager", left_width: 420 };
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

test("a_default_layout_that_cannot_be_read_is_said_and_the_file_manager_is_used", async () => {
  ipc.settingsGet.mockRejectedValue(wireError("no settings"));
  renderHook(() => useLayoutSync(true));
  await settle();
  expect(useLayout.getState()).toMatchObject({ layout: "file_manager", loaded: true });
  expect(useOps.getState().notice?.text).toMatch(/default layout could not be read.*no settings/);
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
