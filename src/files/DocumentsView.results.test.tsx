// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OpDoneEvent, Settings, WireEntry, WirePath } from "../ipc";
import { entry } from "./test-entries";
import { stubLayout } from "./test-layout";

const ipc = vi.hoisted(() => ({
  on: vi.fn(),
  documents: vi.fn(),
  cancelOp: vi.fn(),
  settingsSet: vi.fn(),
  userDirs: vi.fn(),
  thumbRequest: vi.fn(),
  thumbCancel: vi.fn(),
  openPaths: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { appliesTo, currentContext, getAction, runAction } from "../keys/actions";
import { useTabs } from "../store/tabs";
import { useUserDirs } from "../shell/user-dirs-store";
import { DocumentsView } from "./DocumentsView";
import { forgetScanSorts } from "./scan-sort";
import { useViewSettings } from "./view-settings";

// The Library: its toolbar row, the hits as a sortable list or as cards, the filter by name and
// the hidden items.

const p = (v: string): WirePath => ({ k: "Utf8", v });
const DOCS = p("/home/t/Documents");
let handlers: Record<string, ((payload: unknown) => void)[]>;
const emit = (name: string, payload: unknown) =>
  act(() => (handlers[name] ?? []).forEach((h) => h(payload)));
let restoreLayout: () => void;
let stored: Partial<Settings>;
let nextOp: number;

const inDir = (dir: string, name: string, over: Partial<WireEntry> = {}): WireEntry => ({
  ...entry(name, over),
  path: p(`${dir}/${name}`),
});
const HITS = [
  inDir("/home/t/Documents/zoo", "beta.md", { len: 300 }),
  inDir("/home/t/Documents/alpha", "gamma.txt", { len: 100 }),
  inDir("/home/t/Documents", "Alpha.txt", { len: 200 }),
];
const done = (op: number): OpDoneEvent => ({
  op,
  report: null,
  properties: null,
  error: null,
  scan: { found: HITS.length, unreadable: [], cancelled: false },
});

function mount() {
  return render(<DocumentsView tabId="t" />);
}

/** Starts the walk and streams the hits into it, leaving it running. */
async function streaming() {
  mount();
  await waitFor(() => expect(ipc.documents).toHaveBeenCalled());
  const key = ipc.documents.mock.lastCall![0] as string;
  await waitFor(() => expect(handlers["kernkraft://op-done"]?.length).toBeGreaterThan(0));
  emit("kernkraft://search-hit", { key, op: nextOp - 1, entries: HITS });
  await screen.findAllByTestId("scan-hit");
  return key;
}

const names = () =>
  screen
    .getAllByTestId("scan-hit")
    .map((r) => r.querySelector(".kern-name")?.textContent ?? r.textContent);
const header = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  restoreLayout = stubLayout();
  handlers = {};
  nextOp = 1;
  forgetScanSorts();
  // The Library is the tab in front, which the buttons of its toolbar are aimed at.
  useTabs.setState({ tabs: [{ id: "t", kind: "documents" }], activeId: "t" });
  stored = { scan_documents: true, scan_downloads: false, scan_roots: [] };
  useViewSettings.setState({
    loaded: true,
    error: null,
    scanDocuments: true,
    scanDownloads: false,
    scanRoots: [],
    showHidden: false,
    viewMode: "list",
    singleClickCentre: false,
    timeFormat: "24",
  });
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    (handlers[name] ??= []).push(h);
    return Promise.resolve(() => {
      handlers[name] = (handlers[name] ?? []).filter((x) => x !== h);
    });
  });
  ipc.documents.mockImplementation(() => Promise.resolve(nextOp++));
  ipc.cancelOp.mockResolvedValue(undefined);
  ipc.thumbRequest.mockResolvedValue(undefined);
  ipc.thumbCancel.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({ home: p("/home/t"), dirs: [{ name: "documents", path: DOCS }] });
  ipc.settingsSet.mockImplementation((patch: Partial<Settings>) => {
    stored = { ...stored, ...patch };
    useViewSettings.setState({
      showHidden: stored.show_hidden ?? false,
      viewMode: stored.view_mode ?? "list",
    });
    return Promise.resolve({ interface_size: 90, ...stored } as Settings);
  });
  useUserDirs.getState().reset();
});
afterEach(() => {
  cleanup();
  restoreLayout();
  vi.clearAllMocks();
});

test("the_library_has_a_toolbar_row_with_its_switches_and_the_file_managers_buttons", async () => {
  mount();
  const bar = screen.getByRole("toolbar", { name: "Library" });
  // Look again waits for the user's folders, which say where to look.
  await waitFor(() =>
    expect(within(bar).getByRole("button", { name: "Look again" })).toBeEnabled()
  );
  expect(within(bar).getByLabelText("Documents")).toBeChecked();
  expect(within(bar).getByLabelText("Downloads")).not.toBeChecked();
  for (const name of [
    "Look again",
    "Filter the Library by name",
    "List view",
    "Grid view",
    "Show or hide hidden files",
  ]) {
    expect(within(bar).getByRole("button", { name })).toBeEnabled();
  }
  expect(within(bar).getByRole("button", { name: "List view" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("a_hit_is_a_file_manager_row_with_the_folder_it_is_in", async () => {
  await streaming();
  const row = screen.getAllByTestId("scan-hit")[0]!;
  const cells = [...row.querySelectorAll(".kern-col")].map((c) => c.textContent);
  expect(cells[1]).toBe("MD");
  expect(screen.getAllByTestId("scan-hit")[0]!.querySelector(".kern-name")).toHaveTextContent(
    "beta.md"
  );
  expect(cells[2]).toBe("300 B");
  // The folder is shown from home down, as in the strip.
  expect(cells[4]).toBe("~/Documents/zoo");
});

test("the_column_headers_wait_for_the_walk_to_end", async () => {
  const key = await streaming();
  for (const name of ["Name", "Type", "Size", "Modified", "Location"]) {
    expect(header(name)).toBeDisabled();
  }
  expect(names()).toEqual(["beta.md", "gamma.txt", "Alpha.txt"]);
  emit("kernkraft://op-done", done(1));
  await waitFor(() => expect(header("Name")).toBeEnabled());
  expect(key).toBeTruthy();
});

test("a_header_sorts_the_hits_after_the_walk_and_a_second_click_flips_it", async () => {
  await streaming();
  emit("kernkraft://op-done", done(1));
  await waitFor(() => expect(header("Name")).toBeEnabled());
  fireEvent.click(header("Name"));
  await waitFor(() => expect(names()).toEqual(["Alpha.txt", "beta.md", "gamma.txt"]));
  fireEvent.click(header("Name"));
  await waitFor(() => expect(names()).toEqual(["gamma.txt", "beta.md", "Alpha.txt"]));
  fireEvent.click(header("Location"));
  await waitFor(() => expect(names()).toEqual(["Alpha.txt", "gamma.txt", "beta.md"]));
  fireEvent.click(header("Size"));
  // Largest first, as in a folder.
  await waitFor(() => expect(names()).toEqual(["beta.md", "Alpha.txt", "gamma.txt"]));
});

test("the_order_chosen_is_kept_for_the_next_walk", async () => {
  await streaming();
  emit("kernkraft://op-done", done(1));
  await waitFor(() => expect(header("Name")).toBeEnabled());
  fireEvent.click(header("Name"));
  await waitFor(() => expect(names()[0]).toBe("Alpha.txt"));
  fireEvent.click(screen.getByRole("button", { name: "Look again" }));
  await waitFor(() => expect(ipc.documents).toHaveBeenCalledTimes(2));
  const key = ipc.documents.mock.lastCall![0] as string;
  emit("kernkraft://search-hit", { key, op: 2, entries: HITS });
  await screen.findAllByTestId("scan-hit");
  // While it walks the hits are in the order found, and the header says it cannot sort yet.
  expect(names()).toEqual(["beta.md", "gamma.txt", "Alpha.txt"]);
  expect(header("Name")).toBeDisabled();
  emit("kernkraft://op-done", done(2));
  await waitFor(() => expect(names()[0]).toBe("Alpha.txt"));
});

test("hidden_items_walk_again_with_hidden_set", async () => {
  mount();
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenLastCalledWith(expect.any(String), [DOCS], false)
  );
  fireEvent.click(screen.getByRole("button", { name: "Show or hide hidden files" }));
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenCalledWith({ show_hidden: true }));
  await waitFor(() =>
    expect(ipc.documents).toHaveBeenLastCalledWith(expect.any(String), [DOCS], true)
  );
  expect(screen.getByRole("button", { name: "Show or hide hidden files" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("the_filter_narrows_the_hits_by_name_and_closing_it_brings_them_back", async () => {
  await streaming();
  expect(screen.queryByRole("searchbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filter the Library by name" }));
  const box = screen.getByRole("searchbox", { name: "Filter by name" });
  expect(box).toHaveFocus();
  fireEvent.change(box, { target: { value: "ALPHA" } });
  await waitFor(() => expect(names()).toEqual(["Alpha.txt"]));
  expect(screen.getByRole("status")).toHaveTextContent("1 match for the filter");
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.queryByRole("searchbox")).toBeNull();
  await waitFor(() => expect(names()).toHaveLength(3));
});

test("ctrl_f_in_the_library_opens_and_closes_the_filter", async () => {
  mount();
  const filter = getAction("documents.filter");
  expect(filter.keys).toContain("Ctrl+F");
  const ctx = { ...currentContext(), target: { id: "t", kind: "documents" as const } };
  await waitFor(() => expect(runAction(filter, ctx)).toBe(true));
  expect(screen.getByRole("searchbox")).toBeInTheDocument();
  runAction(filter, ctx);
  await waitFor(() => expect(screen.queryByRole("searchbox")).toBeNull());
});

test("the_view_and_hidden_actions_apply_in_the_library_and_the_filter_only_there", () => {
  const library = { id: "t", kind: "documents" as const };
  const folder = { id: "f", kind: "folder" as const, path: p("/d"), history: [p("/d")], cursor: 0 };
  for (const id of ["folder.hidden.toggle", "folder.view.list", "folder.view.grid"]) {
    expect(appliesTo(getAction(id), library), id).toBe(true);
    expect(appliesTo(getAction(id), folder), id).toBe(true);
  }
  expect(appliesTo(getAction("documents.filter"), library)).toBe(true);
  expect(appliesTo(getAction("documents.filter"), folder)).toBe(false);
  // The folder's own search is not the Library's.
  expect(appliesTo(getAction("folder.search"), library)).toBe(false);
});

test("the_grid_view_shows_the_hits_as_cards_and_a_double_click_opens_one", async () => {
  useViewSettings.setState({ viewMode: "grid" });
  mount();
  await waitFor(() => expect(ipc.documents).toHaveBeenCalled());
  const key = ipc.documents.mock.lastCall![0] as string;
  await waitFor(() => expect(handlers["kernkraft://op-done"]?.length).toBeGreaterThan(0));
  emit("kernkraft://search-hit", { key, op: 1, entries: HITS });
  const cards = await screen.findAllByTestId("file-card");
  expect(cards).toHaveLength(3);
  expect(screen.queryByTestId("scan-results")).toBeNull();
  expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute("aria-pressed", "true");
  // A click selects and a double click opens, as the centre of the window is set to.
  fireEvent.click(cards[1]!);
  expect(cards[1]).toHaveAttribute("aria-selected", "true");
});

test("a_card_opens_on_a_double_click_or_on_one_click_when_the_centre_is_set_to_it", async () => {
  useViewSettings.setState({ viewMode: "grid" });
  mount();
  await waitFor(() => expect(ipc.documents).toHaveBeenCalled());
  const key = ipc.documents.mock.lastCall![0] as string;
  await waitFor(() => expect(handlers["kernkraft://op-done"]?.length).toBeGreaterThan(0));
  emit("kernkraft://search-hit", { key, op: 1, entries: HITS });
  const card = (await screen.findAllByTestId("file-card"))[0]!;
  ipc.openPaths.mockResolvedValue([]);
  fireEvent.click(card, { detail: 1 });
  expect(ipc.openPaths).not.toHaveBeenCalled();
  fireEvent.doubleClick(card);
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalledTimes(1));
  expect(ipc.openPaths.mock.lastCall![0]).toEqual([HITS[0]!.path]);
  act(() => useViewSettings.setState({ singleClickCentre: true }));
  fireEvent.click((await screen.findAllByTestId("file-card"))[1]!, { detail: 1 });
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalledTimes(2));
});

test("the_cards_move_with_the_arrow_keys_and_enter_opens_the_one_under_the_cursor", async () => {
  useViewSettings.setState({ viewMode: "grid" });
  mount();
  await waitFor(() => expect(ipc.documents).toHaveBeenCalled());
  const key = ipc.documents.mock.lastCall![0] as string;
  await waitFor(() => expect(handlers["kernkraft://op-done"]?.length).toBeGreaterThan(0));
  emit("kernkraft://search-hit", { key, op: 1, entries: HITS });
  await screen.findAllByTestId("file-card");
  ipc.openPaths.mockResolvedValue([]);
  const grid = screen.getByTestId("scan-grid");
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  fireEvent.keyDown(grid, { key: "ArrowRight" });
  const cards = screen.getAllByTestId("file-card");
  expect(cards[1]).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(grid, { key: "Enter" });
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalledTimes(1));
  expect(ipc.openPaths.mock.lastCall![0]).toEqual([HITS[1]!.path]);
  fireEvent.keyDown(grid, { key: "a", ctrlKey: true });
  expect(
    screen.getAllByTestId("file-card").every((c) => c.getAttribute("aria-selected") === "true")
  ).toBe(true);
});
