// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings } from "../ipc";

const ipc = vi.hoisted(() => ({ settingsGet: vi.fn(), settingsSet: vi.fn(), on: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { toggleHidden, setViewMode, useViewSettings, useViewSettingsSync } from "./view-settings";

const S = {
  show_hidden: false,
  view_mode: "list",
  density: "compact",
  interface_size: 110,
} as Settings;
let changed: ((s: Settings) => void) | undefined;
const unlisten = vi.fn();

beforeEach(() => {
  changed = undefined;
  useViewSettings.setState({ loaded: false, error: null });
  ipc.settingsGet.mockResolvedValue(S);
  ipc.settingsSet.mockImplementation((patch: Partial<Settings>) =>
    Promise.resolve({ ...S, ...patch })
  );
  ipc.on.mockImplementation((_n: string, h: (s: Settings) => void) => {
    changed = h;
    return Promise.resolve(unlisten);
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("loads_the_stored_settings_and_follows_changes", async () => {
  renderHook(() => useViewSettingsSync());
  await waitFor(() => expect(useViewSettings.getState().loaded).toBe(true));
  expect(useViewSettings.getState()).toMatchObject({
    showHidden: false,
    viewMode: "list",
    density: "compact",
  });
  act(() => changed!({ ...S, show_hidden: true, view_mode: "grid" }));
  expect(useViewSettings.getState()).toMatchObject({ showHidden: true, viewMode: "grid" });
});

test("toggle_and_view_mode_write_through_settings_set", async () => {
  renderHook(() => useViewSettingsSync());
  await waitFor(() => expect(useViewSettings.getState().loaded).toBe(true));
  await toggleHidden();
  expect(ipc.settingsSet).toHaveBeenLastCalledWith({ show_hidden: true });
  expect(useViewSettings.getState().showHidden).toBe(true);
  await setViewMode("grid");
  expect(ipc.settingsSet).toHaveBeenLastCalledWith({ view_mode: "grid" });
  expect(useViewSettings.getState().viewMode).toBe("grid");
});

test("a_failed_write_is_kept_as_the_error_and_changes_nothing", async () => {
  renderHook(() => useViewSettingsSync());
  await waitFor(() => expect(useViewSettings.getState().loaded).toBe(true));
  const err = { kind: "Io", message: "disk full", path: null, details: null };
  ipc.settingsSet.mockRejectedValue(err);
  await toggleHidden();
  expect(useViewSettings.getState().error).toEqual(err);
  expect(useViewSettings.getState().showHidden).toBe(false);
});

test("a_failed_read_is_kept_as_the_error", async () => {
  const err = { kind: "Io", message: "unreadable", path: null, details: null };
  ipc.settingsGet.mockRejectedValue(err);
  renderHook(() => useViewSettingsSync());
  await waitFor(() => expect(useViewSettings.getState().error).toEqual(err));
  expect(useViewSettings.getState().loaded).toBe(false);
});

test("unmount_unsubscribes", async () => {
  const { unmount } = renderHook(() => useViewSettingsSync());
  await waitFor(() => expect(changed).toBeDefined());
  unmount();
  await waitFor(() => expect(unlisten).toHaveBeenCalled());
});

test("the_interface_size_is_read_and_follows_changes", async () => {
  // Before any read it is the default, 90 percent.
  vi.resetModules();
  const fresh = await import("./view-settings");
  expect(fresh.useViewSettings.getState().interfaceSize).toBe(90);
  renderHook(() => useViewSettingsSync());
  await waitFor(() => expect(useViewSettings.getState().loaded).toBe(true));
  expect(useViewSettings.getState().interfaceSize).toBe(110);
  act(() => changed!({ ...S, interface_size: 80 }));
  expect(useViewSettings.getState().interfaceSize).toBe(80);
});
