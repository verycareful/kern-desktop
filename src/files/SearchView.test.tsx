// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OpDoneEvent, WireScanDone, WirePath } from "../ipc";
import { dir, entry } from "./test-entries";
import { stubLayout } from "./test-layout";

const ipc = vi.hoisted(() => ({ on: vi.fn(), search: vi.fn(), cancelOp: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { SearchView } from "./SearchView";
import { useViewSettings } from "./view-settings";

const p = (v: string): WirePath => ({ k: "Utf8", v });
/** Every handler subscribed, by event; runs share the events and tell themselves apart. */
let handlers: Record<string, ((payload: unknown) => void)[]>;
const emit = (name: string, payload: unknown) =>
  act(() => (handlers[name] ?? []).forEach((h) => h(payload)));
const onClose = vi.fn();
const onOpen = vi.fn();
let nextOp: number;
let restoreLayout: () => void;

const scanDone = (op: number, scan: Partial<WireScanDone> = {}): OpDoneEvent => ({
  op,
  report: null,
  properties: null,
  error: null,
  scan: { found: 0, unreadable: [], cancelled: false, ...scan },
});

beforeEach(() => {
  restoreLayout = stubLayout();
  handlers = {};
  nextOp = 1;
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    (handlers[name] ??= []).push(h);
    return Promise.resolve(() => {
      handlers[name] = (handlers[name] ?? []).filter((x) => x !== h);
    });
  });
  ipc.search.mockImplementation(() => Promise.resolve(nextOp++));
  ipc.cancelOp.mockResolvedValue(undefined);
  useViewSettings.setState({ showHidden: false, density: "cozy" });
});
afterEach(() => {
  cleanup();
  restoreLayout();
  vi.clearAllMocks();
});

async function typed(q: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });
  await waitFor(() =>
    expect(ipc.search).toHaveBeenLastCalledWith(expect.any(String), [p("/d")], q, false)
  );
  const key = ipc.search.mock.lastCall![0] as string;
  await waitFor(() => expect(handlers["kernkraft://op-done"]?.length).toBeGreaterThan(0));
  return key;
}

test("hits_stream_in_and_the_end_is_counted", async () => {
  render(<SearchView root={p("/d")} onClose={onClose} onOpen={onOpen} />);
  const key = await typed("not");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("notes.md"), dir("notebooks")] });
  expect(await screen.findAllByTestId("scan-hit")).toHaveLength(2);
  expect(screen.getByRole("status")).toHaveTextContent("Searching d… 2 found");
  // Another run's hits are not this one's.
  emit("kernkraft://search-hit", { key: "other", op: 5, entries: [entry("x")] });
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("nothing.txt")] });
  emit("kernkraft://op-done", scanDone(1, { found: 3, unreadable: [p("/d/locked")] }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("3 items found"));
  expect(screen.getAllByTestId("scan-hit")).toHaveLength(3);
  expect(screen.getByText("1 folder could not be searched")).toBeTruthy();
});

test("search_cancels_on_close", async () => {
  const { unmount } = render(<SearchView root={p("/d")} onClose={onClose} onOpen={onOpen} />);
  await typed("a");
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
  unmount();
  await waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledExactlyOnceWith(1));
});

test("a_new_query_cancels_the_walk_before_it_and_drops_its_hits", async () => {
  render(<SearchView root={p("/d")} onClose={onClose} onOpen={onOpen} />);
  const first = await typed("a");
  emit("kernkraft://search-hit", { key: first, op: 1, entries: [entry("a1")] });
  await screen.findAllByTestId("scan-hit");
  const second = await typed("ab");
  await waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledWith(1));
  expect(screen.queryAllByTestId("scan-hit")).toHaveLength(0);
  // A late batch of the first run is not shown.
  emit("kernkraft://search-hit", { key: first, op: 1, entries: [entry("late")] });
  emit("kernkraft://search-hit", { key: second, op: 2, entries: [entry("ab1")] });
  expect(await screen.findAllByTestId("scan-hit")).toHaveLength(1);
  expect(screen.queryByText("late")).toBeNull();
});

test("enter_opens_the_active_hit", async () => {
  render(<SearchView root={p("/d")} onClose={onClose} onOpen={onOpen} />);
  const key = await typed("n");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("n1"), entry("n2")] });
  await screen.findAllByTestId("scan-hit");
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
  const list = screen.getByTestId("scan-results");
  expect(list).toHaveFocus();
  fireEvent.keyDown(list, { key: "ArrowDown" });
  fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "n2" }), true);
});

test("a_search_that_cannot_start_says_why", async () => {
  ipc.search.mockRejectedValue({
    kind: "NotFound",
    message: "no such folder",
    path: null,
    details: null,
  });
  render(<SearchView root={p("/d")} onClose={onClose} onOpen={onOpen} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "q" } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The search could not run: NotFound: no such folder"
  );
});
