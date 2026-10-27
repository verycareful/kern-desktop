// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DirEvent, WireEntry, WireError, WirePath } from "../ipc";
import { click, ctrlClick } from "./selection";
import { sortEntries, type SortBy, type SortDir } from "./sort";
import { sortPermutation } from "./sort-core";
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

const sortSpy = vi.hoisted(() => vi.fn());
vi.mock("./sort", async (orig) => {
  const real = await orig<typeof import("./sort")>();
  return {
    ...real,
    sortEntries: (...args: Parameters<typeof real.sortEntries>) => {
      sortSpy();
      return real.sortEntries(...args);
    },
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
  await waitFor(() => expect(ipc.unwatchDir).toHaveBeenCalledWith("tab-1"));
  expect(unlisten).toHaveBeenCalled();
});

test("refresh_keeps_selection", async () => {
  ipc.listDir.mockResolvedValue([entry("a"), entry("b"), entry("c")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  act(() => result.current.dispatch((s) => ctrlClick(click(s, 1), 2)));
  expect([...result.current.sel.selected].sort()).toEqual([1, 2]);

  // Two folders appear first and "a" is removed: b and c move from indices 1 and 2 to 2 and 3.
  ipc.listDir.mockResolvedValue([dir("0dir"), dir("1dir"), entry("b"), entry("c"), entry("d")]);
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(names(result.current.entries)).toContain("0dir"));
  expect([...result.current.sel.selected].sort()).toEqual([2, 3]);
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
  let release!: () => void;
  const walking = new Promise<void>((r) => (release = r));
  ipc.listDir.mockImplementation(async (path: WirePath) => {
    if (path.v === "/a/b/c" && !removed) return [entry("x")];
    if (path.v === "/a") {
      await walking;
      return [entry("y")];
    }
    throw notFound(path.v);
  });
  const { result } = renderHook(() => useFolder("tab-1", p("/a/b/c"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(names(result.current.entries)).toEqual(["x"]);
  removed = true;
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: "tab-1" });
  });
  // At once the stale list is gone, before anything has been listed again.
  expect(result.current.entries).toEqual([]);
  expect(result.current.phase).toBe("loading");
  // The folder is known to be missing while the ancestor is still being looked for.
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  expect(result.current.entries).toEqual([]);
  expect(result.current.gone).toEqual({ ancestor: null, searching: true });
  await act(async () => release());
  await waitFor(() => expect(result.current.gone?.searching).toBe(false));
  // /a/b/c, then /a/b fail; /a is the nearest ancestor that lists.
  expect(result.current.gone).toEqual({ ancestor: p("/a"), searching: false });
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
  expect(result.current.gone).toEqual({ ancestor: p("/"), searching: false });
});

test("no_ancestor_lists", async () => {
  ipc.listDir.mockRejectedValue(notFound("/a"));
  const { result } = renderHook(() => useFolder("tab-1", p("/a"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  expect(result.current.gone).toEqual({ ancestor: null, searching: false });
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
  // The error is set before the relist answers, so wait for the listing.
  await waitFor(() => expect(result.current.phase).toBe("ready"));
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

test("sorting_runs_once_per_listing_even_under_strict_mode", async () => {
  // StrictMode runs a state updater twice, so a sort inside one would run twice.
  sortSpy.mockClear();
  ipc.listDir.mockResolvedValue([entry("b"), entry("a")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(sortSpy).toHaveBeenCalledTimes(1);
});

test("a_vanished_folder_does_not_unwatch_a_watch_that_never_started", async () => {
  ipc.watchDir.mockRejectedValue(denied);
  let removed = false;
  ipc.listDir.mockImplementation((path: WirePath) =>
    removed ? Promise.reject(notFound(path.v)) : Promise.resolve([entry("x")])
  );
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.watchError).toEqual(denied));
  ipc.unwatchDir.mockClear();
  removed = true;
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  expect(ipc.unwatchDir).not.toHaveBeenCalled();
});

test("refresh_retries_a_failed_watch", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  ipc.watchDir.mockRejectedValueOnce(denied);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.watchError).toEqual(denied));
  act(() => result.current.refresh());
  await waitFor(() => expect(ipc.watchDir).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.watchError).toBeNull());
});

test("the_unwatch_of_a_vanished_folder_comes_before_any_later_watch", async () => {
  // Both use the tab's key, so they must reach the backend in this order.
  const order: string[] = [];
  ipc.unwatchDir.mockImplementation(async () => {
    await Promise.resolve();
    order.push("unwatch");
  });
  ipc.watchDir.mockImplementation(async () => {
    order.push("watch");
  });
  let removed = false;
  ipc.listDir.mockImplementation((path: WirePath) =>
    removed && path.v === "/d" ? Promise.reject(notFound(path.v)) : Promise.resolve([])
  );
  const { result, rerender } = renderHook(({ path }) => useFolder("tab-1", p(path), OPTS), {
    initialProps: { path: "/d" },
  });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  removed = true;
  act(() => {
    void handlers["kernkraft://dir-changed"]!({ key: "tab-1" });
  });
  await waitFor(() => expect(result.current.phase).toBe("gone"));
  rerender({ path: "/" });
  await waitFor(() => expect(order.filter((o) => o === "watch")).toHaveLength(2));
  expect(order).toEqual(["watch", "unwatch", "watch"]);
});

test("the_previous_folders_entries_are_never_returned_for_the_new_path", async () => {
  ipc.listDir.mockImplementation((path: WirePath) =>
    Promise.resolve(path.v === "/d" ? [entry("old")] : [entry("new", {}, "/e")])
  );
  const seen: { path: string; names: string[] }[] = [];
  const { result, rerender } = renderHook(
    ({ path }) => {
      const api = useFolder("tab-1", p(path), OPTS);
      seen.push({ path, names: names(api.entries) });
      return api;
    },
    { initialProps: { path: "/d" } }
  );
  await waitFor(() => expect(names(result.current.entries)).toEqual(["old"]));
  rerender({ path: "/e" });
  await waitFor(() => expect(names(result.current.entries)).toEqual(["new"]));
  // Not even in the render that first has the new path.
  expect(seen.filter((s) => s.path === "/e").every((s) => !s.names.includes("old"))).toBe(true);
});

// ---- sorting of large folders in a worker, and the watch rules of round 2 ----

class WorkerStub {
  static made: WorkerStub[] = [];
  static crash = false;
  static gate: Promise<void> | null = null;
  listeners: Record<string, ((e: never) => void)[]> = {};
  terminated = false;
  constructor() {
    WorkerStub.made.push(this);
  }
  addEventListener(name: string, fn: (e: never) => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  postMessage(msg: {
    id: number;
    input: import("./sort-core").SortInput;
    by: SortBy;
    dir: SortDir;
  }) {
    const send = () => {
      if (WorkerStub.crash) {
        this.listeners.error?.forEach((f) => f({ message: "worker died" } as never));
        return;
      }
      const perm = sortPermutation(msg.input, msg.by, msg.dir);
      this.listeners.message?.forEach((f) => f({ data: { id: msg.id, perm } } as never));
    };
    if (WorkerStub.gate) void WorkerStub.gate.then(send);
    else queueMicrotask(send);
  }
  terminate() {
    this.terminated = true;
  }
}

const bigList = (n: number, parent = "/d") =>
  Array.from({ length: n }, (_, i) => entry(`f${(i * 7919) % n}.txt`, { len: i }, parent));

describe("large folders", () => {
  beforeEach(() => {
    WorkerStub.made = [];
    WorkerStub.crash = false;
    WorkerStub.gate = null;
    vi.stubGlobal("Worker", WorkerStub);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("above_5000_entries_the_worker_sorts_and_the_list_shows_when_it_is_done", async () => {
    let release!: () => void;
    WorkerStub.gate = new Promise<void>((r) => (release = r));
    ipc.listDir.mockResolvedValue(bigList(5001));
    const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
    await waitFor(() => expect(result.current.sorting).toBe(true));
    // Nothing is shown unsorted in the meantime.
    expect(result.current.phase).toBe("loading");
    expect(result.current.entries).toEqual([]);
    await act(async () => release());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.sorting).toBe(false);
    expect(result.current.entries.map((e) => e.name)).toEqual(
      sortEntries(bigList(5001), "name", "asc").map((e) => e.name)
    );
    expect(WorkerStub.made).toHaveLength(1);
  });

  test("at_5000_entries_no_worker_is_used", async () => {
    ipc.listDir.mockResolvedValue(bigList(5000));
    const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(WorkerStub.made).toHaveLength(0);
  });

  test("a_sort_change_of_a_large_folder_is_sorted_by_the_worker_and_keeps_the_selection", async () => {
    ipc.listDir.mockResolvedValue(bigList(5001));
    const { result, rerender } = renderHook(
      ({ sortBy }) => useFolder("tab-1", p("/d"), { ...OPTS, sortBy }),
      { initialProps: { sortBy: "name" as SortBy } }
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const pick = result.current.entries[10]!.name;
    act(() => result.current.dispatch((s) => click(s, 10)));
    rerender({ sortBy: "size" });
    await waitFor(() => expect(result.current.entries[0]!.len).toBe(0));
    const at = [...result.current.sel.selected][0]!;
    expect(result.current.entries[at]!.name).toBe(pick);
  });

  test("a_result_for_an_older_listing_is_dropped", async () => {
    let release!: () => void;
    WorkerStub.gate = new Promise<void>((r) => (release = r));
    ipc.listDir.mockResolvedValueOnce(bigList(5001, "/old"));
    const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
    await waitFor(() => expect(WorkerStub.made).toHaveLength(1));
    ipc.listDir.mockResolvedValue(bigList(5002, "/new"));
    act(() => result.current.refresh());
    await act(async () => release());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.entries).toHaveLength(5002);
  });

  test("a_worker_failure_is_reported_and_the_list_shows_in_the_folders_order", async () => {
    WorkerStub.crash = true;
    const raw = bigList(5001);
    ipc.listDir.mockResolvedValue(raw);
    const { result, rerender } = renderHook(
      ({ sortBy }) => useFolder("tab-1", p("/d"), { ...OPTS, sortBy }),
      { initialProps: { sortBy: "name" as SortBy } }
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.sortError).toMatchObject({ kind: "Sort" });
    expect(result.current.sortError?.message).toMatch(/worker died/);
    // No silent substitute: the entries are the folder's own order, not a main-thread sort.
    expect(result.current.entries.map((e) => e.name)).toEqual(raw.map((e) => e.name));
    // Choosing a sort again tries again, on a new worker, and a good sort clears the error.
    WorkerStub.crash = false;
    rerender({ sortBy: "size" });
    await waitFor(() => expect(result.current.sortError).toBeNull());
    expect(result.current.entries.map((e) => e.len)).toEqual(
      sortEntries(raw, "size", "asc").map((e) => e.len)
    );
    expect(WorkerStub.made).toHaveLength(2);
  });

  test("a_folder_change_ends_the_old_folders_worker_sort", async () => {
    let release!: () => void;
    WorkerStub.gate = new Promise<void>((r) => (release = r));
    ipc.listDir.mockResolvedValueOnce(bigList(5001, "/old"));
    const { result, rerender } = renderHook(({ path }) => useFolder("tab-1", p(path), OPTS), {
      initialProps: { path: "/old" },
    });
    await waitFor(() => expect(WorkerStub.made).toHaveLength(1));
    ipc.listDir.mockResolvedValue([entry("n.txt", {}, "/new")]);
    rerender({ path: "/new" });
    // The sort of the folder that is no longer shown is not left running.
    expect(WorkerStub.made[0]!.terminated).toBe(true);
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => release());
    expect(result.current.entries.map((e) => e.name)).toEqual(["n.txt"]);
  });

  test("unmount_ends_the_worker", async () => {
    ipc.listDir.mockResolvedValue(bigList(5001));
    const { result, unmount } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    unmount();
    expect(WorkerStub.made[0]!.terminated).toBe(true);
  });
});

test("a_successful_watch_does_not_show_the_previous_folders_unwatch_error", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    ipc.listDir.mockResolvedValue([]);
    ipc.unwatchDir.mockRejectedValue(denied);
    const { result, rerender } = renderHook(({ path }) => useFolder("tab-1", p(path), OPTS), {
      initialProps: { path: "/d" },
    });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    rerender({ path: "/e" });
    await waitFor(() => expect(ipc.watchDir).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.watchError).toBeNull();
    // It is logged, with what it was about.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("tab-1"), denied);
  } finally {
    spy.mockRestore();
  }
});

test("refresh_places_again_a_watch_that_died_while_running", async () => {
  ipc.listDir.mockResolvedValue([entry("a")]);
  const { result } = renderHook(() => useFolder("tab-1", p("/d"), OPTS));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(ipc.watchDir).toHaveBeenCalledTimes(1);
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: "tab-1", error: denied });
  });
  await waitFor(() => expect(result.current.watchError).toEqual(denied));
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(ipc.watchDir).toHaveBeenCalledTimes(1);
  act(() => result.current.refresh());
  await waitFor(() => expect(ipc.watchDir).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.watchError).toBeNull());
});
