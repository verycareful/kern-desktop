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
  useViewSettings.setState({
    showHidden: false,
    singleClickCentre: false,
    singleClickEditor: false,
  });
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
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
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
  const { unmount } = render(
    <SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />
  );
  await typed("a");
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
  unmount();
  await waitFor(() => expect(ipc.cancelOp).toHaveBeenCalledExactlyOnceWith(1));
});

test("a_new_query_cancels_the_walk_before_it_and_drops_its_hits", async () => {
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
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

test("a_hit_opens_on_a_double_click_and_a_single_click_only_marks_it", async () => {
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
  const key = await typed("n");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("n1"), entry("n2")] });
  const hits = await screen.findAllByTestId("scan-hit");
  fireEvent.click(hits[1]!, { detail: 1 });
  expect(hits[1]).toHaveAttribute("aria-selected", "true");
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.doubleClick(hits[1]!, { ctrlKey: true });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "n2" }), true);
});

test("with_single_click_on_a_hit_opens_on_one_click_and_a_double_click_does_not_open_again", async () => {
  useViewSettings.setState({ singleClickCentre: true });
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
  const key = await typed("n");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("n1"), entry("n2")] });
  const hits = await screen.findAllByTestId("scan-hit");
  fireEvent.click(hits[0]!, { detail: 1 });
  fireEvent.click(hits[0]!, { detail: 2 });
  fireEvent.doubleClick(hits[0]!);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "n1" }), false);
});

async function clickFirstEditorHit() {
  render(<SearchView root={p("/d")} area="editor" onClose={onClose} onOpen={onOpen} />);
  const key = await typed("n");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("n1")] });
  fireEvent.click((await screen.findAllByTestId("scan-hit"))[0]!, { detail: 1 });
}

test("a_hit_in_the_editor_is_not_opened_by_a_single_click_when_only_the_centre_setting_is_on", async () => {
  useViewSettings.setState({ singleClickCentre: true, singleClickEditor: false });
  await clickFirstEditorHit();
  expect(onOpen).not.toHaveBeenCalled();
});

test("a_hit_in_the_editor_is_opened_by_a_single_click_when_the_editor_setting_is_on", async () => {
  useViewSettings.setState({ singleClickCentre: false, singleClickEditor: true });
  await clickFirstEditorHit();
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "n1" }), false);
});

test("enter_opens_the_active_hit", async () => {
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
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
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "q" } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The search could not run: NotFound: no such folder"
  );
});

test("the_hits_of_the_text_before_go_as_soon_as_it_changes", async () => {
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
  const key = await typed("a");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("a1")] });
  await screen.findAllByTestId("scan-hit");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ab" } });
  // Before the pause is over and the new walk starts.
  expect(screen.queryAllByTestId("scan-hit")).toHaveLength(0);
  expect(ipc.search).toHaveBeenCalledTimes(1);
});

test("the_column_headers_of_a_centre_search_wait_for_the_search_to_end", async () => {
  render(<SearchView root={p("/d")} area="centre" onClose={onClose} onOpen={onOpen} />);
  const key = await typed("a");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("b.txt"), entry("a.txt")] });
  await screen.findAllByTestId("scan-hit");
  expect(screen.getByRole("button", { name: "Name" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Location" })).toBeDisabled();
  emit("kernkraft://op-done", scanDone(1, { found: 2 }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Name" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Name" }));
  await waitFor(() =>
    expect(
      screen.getAllByTestId("scan-hit").map((r) => r.querySelector(".kern-name")?.textContent)
    ).toEqual(["a.txt", "b.txt"])
  );
});

test("a_search_in_the_editors_narrow_column_has_no_header", async () => {
  render(<SearchView root={p("/d")} area="editor" onClose={onClose} onOpen={onOpen} />);
  const key = await typed("a");
  emit("kernkraft://search-hit", { key, op: 1, entries: [entry("a.txt")] });
  await screen.findAllByTestId("scan-hit");
  expect(screen.queryByRole("button", { name: "Name" })).toBeNull();
});
