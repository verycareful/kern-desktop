// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DirEvent, WireEntry, WireError, WirePath } from "../ipc";
import { click, ctrlClick } from "./selection";
import { dir, entry } from "./test-entries";

type Handler = (payload: DirEvent) => void;

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async () => {
  const real = await vi.importActual<typeof import("../ipc/wire-path")>("../ipc/wire-path");
  return {
    ...real,
    listDir: ipc.listDir,
    watchDir: ipc.watchDir,
    unwatchDir: ipc.unwatchDir,
    on: ipc.on,
    toWireError: (e: unknown) => e,
    EVENT_DIR_CHANGED: "kernkraft://dir-changed",
    EVENT_DIR_GONE: "kernkraft://dir-gone",
  };
});

import { useFolder } from "./useFolder";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const notFound = (path: string): WireError => ({
  kind: "NotFound",
  message: "not found: " + path,
  path: p(path),
  details: null,
});
const denied: WireError = { kind: "Io", message: "permission denied", path: null, details: null };

let handlers: Record<string, Handler>;
const unlisten = vi.fn();

beforeEach(() => {
  handlers = {};
  ipc.on.mockImplementation((name: string, h: Handler) => {
    handlers[name] = h;
    return Promise.resolve(unlisten);
  });
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.clearAllMocks();
  ipc.listDir.mockReset();
});

const OPTS = { hidden: false, sortBy: "name", sortDir: "asc" } as const;
const names = (l: WireEntry[]) => l.map((e) => e.name);

test("lists_and_watches_under_the_tab_id", async () => {
  ipc.listDir.mockResolvedValue([entry("b"), dir("a")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  expect(result.current.phase).toBe("loading");
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(names(result.current.entries)).toEqual(["a", "b"]);
  expect(ipc.listDir).toHaveBeenCalledWith(p("/d"), false);
  expect(ipc.watchDir).toHaveBeenCalledWith("tab-1", p("/d"));
});

test("unwatches_on_unmount_and_on_folder_change", async () => {
  ipc.listDir.mockResolvedValue([]);
  const { result, rerender, unmount } = renderHook(
    ({ path }) => useFolder("tab-1", p(path), OPTS),
    { initialProps: { path: "/d" } }
  );
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  rerender({ path: "/e" });
  // The old folder's list is never shown under the new path.
  expect(result.current.phase).toBe("loading");
  expect(result.current.entries).toEqual([]);
  await waitFor(() => expect(ipc.watchDir).toHaveBeenLastCalledWith("tab-1", p("/e")));
  expect(ipc.unwatchDir).toHaveBeenCalledWith("tab-1");
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  ipc.unwatchDir.mockClear();
  unmount();
  expect(ipc.unwatchDir).toHaveBeenCalledWith("tab-1");
  expect(unlisten).toHaveBeenCalled();
});

test("refresh_keeps_selection", async () => {
  ipc.listDir.mockResolvedValue([entry("a"), entry("b"), entry("c")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  act(() => result.current.dispatch((s) => ctrlClick(click(s, 1), 2)));
  expect([...result.current.sel.selected].sort()).toEqual([1, 2]);

  // A folder appears first and "a" is removed: b and c move to new positions.
  ipc.listDir.mockResolvedValue([dir("0dir"), entry("b"), entry("c"), entry("d")]);
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(names(result.current.entries)).toContain("0dir"));
  const picked = [...result.current.sel.selected].map((i) => result.current.entries[i]!.name);
  expect(picked.sort()).toEqual(["b", "c"]);
  expect(result.current.entries[result.current.sel.cursor!]!.name).toBe("c");
});

test("a_selected_entry_that_vanished_leaves_the_selection", async () => {
  ipc.listDir.mockResolvedValue([entry("a"), entry("b")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  act(() => result.current.dispatch((s) => ctrlClick(click(s, 0), 1)));
  ipc.listDir.mockResolvedValue([entry("b")]);
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  expect([...result.current.sel.selected]).toEqual([0]);
});

test("events_of_other_tabs_are_ignored", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  ipc.listDir.mockClear();
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-2" });
  });
  await Promise.resolve();
  expect(ipc.listDir).not.toHaveBeenCalled();
});

test("sort_change_resorts_and_keeps_selection", async () => {
  ipc.listDir.mockResolvedValue([entry("a", { len: 3 }), entry("b", { len: 1 })]);
  const { result, rerender } = renderHook(
    ({ sortBy }) => useFolder("tab-1", p("/d"), { ...OPTS, sortBy }),
    { initialProps: { sortBy: "name" as "name" | "size" } }
  );
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  act(() => result.current.dispatch((s) => click(s, 0)));
  rerender({ sortBy: "size" });
  expect(names(result.current.entries)).toEqual(["b", "a"]);
  expect([...result.current.sel.selected]).toEqual([1]);
  expect(ipc.listDir).toHaveBeenCalledTimes(1);
});

test("hidden_toggle_relists_without_rewatching", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  const { result, rerender } = renderHook(
    ({ hidden }) => useFolder("tab-1", p("/d"), { ...OPTS, hidden }),
    { initialProps: { hidden: false } }
  );
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  ipc.listDir.mockResolvedValue([entry("a"), entry(".h")]);
  rerender({ hidden: true });
  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  expect(ipc.listDir).toHaveBeenLastCalledWith(p("/d"), true);
  expect(ipc.watchDir).toHaveBeenCalledTimes(1);
});

test("vanished_folder_offers_parent", async () => {
  let removed = false;
  ipc.listDir.mockImplementation((path: WirePath) => {
    if (path.v === "/a/b/c" && !removed) return Promise.resolve([entry("x")]);
    if (path.v === "/a") return Promise.resolve([entry("y")]);
    return Promise.reject(notFound(path.v));
  });
  const { result } = renderHook(() => useFolder("tab-1", p("/a/b/c"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  removed = true;
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  // /a/b/c, then /a/b fail; /a is the nearest ancestor that lists.
  expect(result.current.gone).toEqual({ ancestor: p("/a") });
  // The stale list is not shown.
  expect(result.current.entries).toEqual([]);
  expect(ipc.listDir.mock.calls.map((c) => (c[0] as WirePath).v)).toEqual([
    "/a/b/c",
    "/a/b/c",
    "/a/b",
    "/a",
  ]);
  expect(ipc.unwatchDir).toHaveBeenCalledWith("tab-1");
});

test("a_folder_that_is_back_after_dir_gone_is_watched_again", async () => {
  ipc.listDir.mockResolvedValue([entry("x")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(ipc.watchDir).toHaveBeenCalledTimes(2));
  expect(result.current.phase).toBe("ready");
});

test("a_folder_missing_on_first_listing_is_gone", async () => {
  ipc.listDir.mockImplementation((path: WirePath) =>
    path.v === "/" ? Promise.resolve([]) : Promise.reject(notFound(path.v))
  );
  const { result } = renderHook(() => useFolder("tab-1", p("/a/b"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  expect(result.current.gone).toEqual({ ancestor: p("/") });
});

test("no_ancestor_lists", async () => {
  ipc.listDir.mockRejectedValue(notFound("/a"));
  const { result } = renderHook(() => useFolder("tab-1", p("/a"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  expect(result.current.gone).toEqual({ ancestor: null });
});

test("other_listing_errors_are_shown_with_no_list", async () => {
  ipc.listDir.mockRejectedValue(denied);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("error"));
  expect(result.current.error).toEqual(denied);
  expect(result.current.entries).toEqual([]);
  // Refresh tries again.
  ipc.listDir.mockResolvedValue([entry("a")]);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(result.current.error).toBeNull();
});

test("a_failed_relist_hides_the_stale_list", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  ipc.listDir.mockRejectedValue(denied);
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(result.current.phase).toBe("error"));
  expect(result.current.entries).toEqual([]);
});

test("a_watch_failure_is_reported_and_the_list_still_shows", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  ipc.watchDir.mockRejectedValue(denied);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await waitFor(() => expect(result.current.watchError).toEqual(denied));
  expect(names(result.current.entries)).toEqual(["a"]);
});

test("a_dir_gone_with_an_error_relists_and_reports_it", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: "tab-1", error: denied });
  });
  await waitFor(() => expect(result.current.watchError).toEqual(denied));
  expect(result.current.phase).toBe("ready");
});

test("a_slow_old_listing_never_overwrites_a_newer_one", async () => {
  let release!: (v: WireEntry[]) => void;
  ipc.listDir.mockImplementationOnce(() => new Promise((r) => (release = r)));
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(ipc.listDir).toHaveBeenCalledTimes(1));
  ipc.listDir.mockResolvedValue([entry("new")]);
  act(() => result.current.refresh());
  await waitFor(() => expect(names(result.current.entries)).toEqual(["new"]));
  await act(async () => release([entry("old")]));
  expect(names(result.current.entries)).toEqual(["new"]);
});
