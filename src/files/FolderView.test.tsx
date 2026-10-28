// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import type { OpenOutcome, Settings, WireEntry, WireError, WirePath } from "../ipc";
import { useShortcuts } from "../keys/useShortcuts";
import { activeTab, useTabs, type FolderTab } from "../store/tabs";
import { useFolderStatus } from "./folder-status";
import { useFolderUi } from "./folder-ui";
import { useViewSettings } from "./view-settings";
import { dir, entry } from "./test-entries";
import { stubLayout } from "./test-layout";

type Handlers = Record<string, (payload: unknown) => void>;

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  openPaths: vi.fn(),
  thumbRequest: vi.fn(),
  thumbCancel: vi.fn(),
  userDirs: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  ...ipc,
  assetUrl: (f: { v: string }) => `asset://${f.v}`,
}));

import { FolderView } from "./FolderView";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const SETTINGS = { show_hidden: false, view_mode: "list", density: "cozy" } as Settings;

let handlers: Handlers;
let restoreLayout: () => void;

function Host(props: { tab: FolderTab }) {
  useShortcuts();
  // The tab as the store has it, so navigation shows up as the shell would show it.
  const tab = useTabs((s) => activeTab(s)) as FolderTab | null;
  return <FolderView key={props.tab.id} tab={tab ?? props.tab} />;
}

function openTab(path = "/d"): FolderTab {
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(p(path), false);
  return activeTab(useTabs.getState()) as FolderTab;
}

async function mount(entries: WireEntry[], path = "/d") {
  ipc.listDir.mockResolvedValue(entries);
  const tab = openTab(path);
  const view = render(<Host tab={tab} />);
  await waitFor(() =>
    expect(
      screen.queryByTestId("folder-list") ?? screen.queryByTestId("folder-empty")
    ).not.toBeNull()
  );
  // The virtual list draws its rows once it has measured its scroller.
  if (entries.length > 0) {
    await waitFor(() => expect(screen.queryAllByTestId("file-row").length).toBeGreaterThan(0));
  }
  return { tab, ...view };
}

const rowNames = () => screen.queryAllByTestId("file-row").map((r) => r.getAttribute("data-name"));

let hasFocus: MockInstance<() => boolean>;
beforeEach(() => {
  restoreLayout = stubLayout();
  // Kern's window has focus (jsdom reports none while a blur handler runs).
  hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  handlers = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  ipc.settingsSet.mockImplementation((patch: Partial<Settings>) =>
    Promise.resolve({ ...SETTINGS, ...patch })
  );
  ipc.thumbRequest.mockResolvedValue(undefined);
  ipc.thumbCancel.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({ home: p("/home/u"), dirs: [] });
  useViewSettings.setState({ loaded: false, error: null });
  useFolderUi.setState({ sort: {} });
  useFolderStatus.setState({ byTab: {} });
});

afterEach(async () => {
  cleanup();
  // Only the spy on document.hasFocus: restoring every mock would also empty the ipc mocks that
  // an unmounting view still calls a microtask later.
  hasFocus.mockRestore();
  await Promise.resolve();
  restoreLayout();
  vi.clearAllMocks();
  ipc.listDir.mockReset();
  ipc.openPaths.mockReset();
});

test("lists_rows_with_name_size_and_type", async () => {
  await mount([entry("b.pdf", { len: 2048, mime: "application/pdf" }), dir("a")]);
  expect(rowNames()).toEqual(["a", "b.pdf"]);
  const row = screen.getAllByTestId("file-row")[1]!;
  expect(row).toHaveTextContent("2 KB");
  expect(row).toHaveTextContent("PDF");
  expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
});

test("an_empty_folder_says_so_and_mentions_hidden_files", async () => {
  await mount([]);
  expect(screen.getByTestId("folder-empty")).toHaveTextContent(/empty/i);
  expect(screen.getByTestId("folder-empty")).toHaveTextContent(/hidden/i);
});

test("status_counts_items_and_the_selection", async () => {
  const { tab } = await mount([entry("a", { len: 1024 }), entry("b", { len: 2048 }), dir("c")]);
  expect(useFolderStatus.getState().byTab[tab.id]).toMatchObject({ items: 3, selected: 0 });
  fireEvent.click(screen.getAllByTestId("file-row")[1]!);
  fireEvent.click(screen.getAllByTestId("file-row")[2]!, { ctrlKey: true });
  // Sorted: c (folder), a, b. Selected a and b: 3 KB; the folder's size is not counted.
  expect(useFolderStatus.getState().byTab[tab.id]).toEqual({
    items: 3,
    selected: 2,
    selectedBytes: 3072,
    selectedFolders: 0,
  });
  fireEvent.click(screen.getAllByTestId("file-row")[0]!, { ctrlKey: true });
  expect(useFolderStatus.getState().byTab[tab.id]).toMatchObject({
    selected: 3,
    selectedBytes: 3072,
    selectedFolders: 1,
  });
});

test("click_ctrl_and_shift_select_rows", async () => {
  await mount([entry("a"), entry("b"), entry("c"), entry("d")]);
  const rows = () => screen.getAllByTestId("file-row");
  fireEvent.click(rows()[1]!);
  fireEvent.click(rows()[3]!, { shiftKey: true });
  expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual([
    "false",
    "true",
    "true",
    "true",
  ]);
  fireEvent.click(rows()[2]!, { ctrlKey: true });
  expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual([
    "false",
    "true",
    "false",
    "true",
  ]);
});

test("header_buttons_sort_and_flip", async () => {
  const { tab } = await mount([
    entry("a", { len: 3 }),
    entry("b", { len: 1 }),
    entry("c", { len: 2 }),
  ]);
  const header = (name: string) => screen.getByRole("columnheader", { name });
  expect(header("Name")).toHaveAttribute("aria-sort", "ascending");
  // The first choice of Size is largest first (handoff README, Sort).
  fireEvent.click(within(header("Size")).getByRole("button"));
  expect(rowNames()).toEqual(["a", "c", "b"]);
  expect(header("Size")).toHaveAttribute("aria-sort", "descending");
  fireEvent.click(within(header("Size")).getByRole("button"));
  expect(rowNames()).toEqual(["b", "c", "a"]);
  expect(useFolderUi.getState().sort[tab.id]).toEqual({ by: "size", dir: "asc" });
});

test("double_click_on_a_folder_navigates_the_tab", async () => {
  const { tab } = await mount([dir("sub"), entry("f.txt")]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  const now = activeTab(useTabs.getState()) as FolderTab;
  expect(now.id).toBe(tab.id);
  expect(now.path).toEqual(p("/d/sub"));
  expect(now.cursor).toBe(1);
  expect(ipc.openPaths).not.toHaveBeenCalled();
});

test("double_click_on_a_text_file_asks_the_backend_and_leaves_the_tab_to_its_directive", async () => {
  await mount([entry("n.txt", { mime: "text/plain" })]);
  const outcome: OpenOutcome = {
    path: p("/d/n.txt"),
    action: "doc_tab",
    location: null,
    error: null,
  };
  ipc.openPaths.mockResolvedValue([outcome]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalled());
  expect(ipc.openPaths).toHaveBeenCalledWith([p("/d/n.txt")], "inside", "default");
  // The document tab comes from the directive the backend sends, once.
  await act(async () => {});
  expect(useTabs.getState().tabs.some((t) => t.kind === "doc")).toBe(false);
});

test("a_file_for_another_app_opens_no_tab", async () => {
  await mount([entry("x.bin")]);
  ipc.openPaths.mockResolvedValue([
    { path: p("/d/x.bin"), action: "default_app", location: null, error: null },
  ]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalled());
  expect(useTabs.getState().tabs).toHaveLength(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("ctrl_double_click_asks_for_a_new_window", async () => {
  await mount([entry("n.txt")]);
  ipc.openPaths.mockResolvedValue([
    { path: p("/d/n.txt"), action: "doc_window", location: null, error: null },
  ]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!, { ctrlKey: true });
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledWith([p("/d/n.txt")], "inside", "new_window")
  );
  expect(useTabs.getState().tabs.some((t) => t.kind === "doc")).toBe(false);
});

test("an_open_failure_is_shown", async () => {
  await mount([entry("x.bin")]);
  const error: WireError = { kind: "NotFound", message: "gone: x.bin", path: null, details: null };
  ipc.openPaths.mockResolvedValue([
    { path: p("/d/x.bin"), action: "failed", location: null, error },
  ]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  expect(await screen.findByRole("alert")).toHaveTextContent("gone: x.bin");
  // A call that itself fails is shown too.
  ipc.openPaths.mockRejectedValue({ kind: "Ipc", message: "denied", path: null, details: null });
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("denied"));
});

test("enter_opens_the_selection_and_ctrl_enter_asks_for_a_window", async () => {
  await mount([dir("sub"), entry("n.txt")]);
  ipc.openPaths.mockResolvedValue([
    { path: p("/d/n.txt"), action: "doc_window", location: null, error: null },
  ]);
  fireEvent.click(screen.getAllByTestId("file-row")[1]!);
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledWith([p("/d/n.txt")], "inside", "new_window")
  );
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  fireEvent.keyDown(window, { key: "Enter" });
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d/sub"));
});

test("arrow_keys_move_the_selection_and_shift_extends", async () => {
  await mount([entry("a"), entry("b"), entry("c")]);
  const sel = () =>
    screen.getAllByTestId("file-row").map((r) => r.getAttribute("aria-selected") === "true");
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(sel()).toEqual([true, false, false]);
  fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
  expect(sel()).toEqual([true, true, false]);
  fireEvent.keyDown(window, { key: "End" });
  expect(sel()).toEqual([false, false, true]);
  expect(screen.getByRole("grid")).toHaveAttribute("aria-activedescendant");
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  expect(sel()).toEqual([true, true, true]);
  fireEvent.keyDown(window, { key: "A", ctrlKey: true, shiftKey: true });
  expect(sel()).toEqual([false, false, false]);
});

test("ctrl_h_toggles_hidden_files_and_relists", async () => {
  await mount([entry("a")]);
  expect(ipc.listDir).toHaveBeenLastCalledWith(p("/d"), false);
  ipc.listDir.mockResolvedValue([entry("a"), entry(".secret")]);
  fireEvent.keyDown(window, { key: "h", ctrlKey: true });
  await waitFor(() => expect(rowNames()).toEqual([".secret", "a"]));
  expect(ipc.settingsSet).toHaveBeenCalledWith({ show_hidden: true });
  expect(ipc.listDir).toHaveBeenLastCalledWith(p("/d"), true);
});

test("f5_relists", async () => {
  await mount([entry("a")]);
  ipc.listDir.mockResolvedValue([entry("a"), entry("b")]);
  fireEvent.keyDown(window, { key: "F5" });
  await waitFor(() => expect(rowNames()).toEqual(["a", "b"]));
});

test("a_listing_error_replaces_the_list", async () => {
  ipc.listDir.mockRejectedValue({
    kind: "Io",
    message: "permission denied",
    path: null,
    details: null,
  });
  const tab = openTab();
  render(<Host tab={tab} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  expect(screen.queryByTestId("folder-list")).toBeNull();
});

test("a_vanished_folder_shows_the_banner_and_goes_to_the_ancestor", async () => {
  let removed = false;
  ipc.listDir.mockImplementation((path: WirePath) =>
    path.v === "/a/b" && !removed
      ? Promise.resolve([entry("x")])
      : path.v === "/a"
        ? Promise.resolve([])
        : Promise.reject({ kind: "NotFound", message: "nope", path: null, details: null })
  );
  const tab = openTab("/a/b");
  render(<Host tab={tab} />);
  await screen.findByTestId("folder-list");
  removed = true;
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: tab.id });
  });
  const banner = await screen.findByTestId("gone-banner");
  expect(banner).toHaveTextContent("/a/b");
  expect(screen.queryByTestId("folder-list")).toBeNull();
  fireEvent.click(within(banner).getByRole("button", { name: /\/a$/ }));
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/a"));
  await waitFor(() => expect(screen.queryByTestId("gone-banner")).toBeNull());
});

test("grid_view_shows_cards_and_asks_for_visible_thumbnails", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  await mountGrid([entry("a.png", { mime: "image/png" }), entry("b.txt")]);
  expect(screen.getAllByTestId("file-card").map((c) => c.getAttribute("data-name"))).toEqual([
    "a.png",
    "b.txt",
  ]);
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalled());
  expect(ipc.thumbRequest.mock.calls[0]![1]).toEqual([p("/d/a.png")]);
  act(() =>
    handlers["kernkraft://thumb"]!({
      key: ipc.thumbRequest.mock.calls[0]![0],
      path: p("/d/a.png"),
      file: p("/cache/x.png"),
      error: null,
    })
  );
  await waitFor(() =>
    expect(screen.getAllByTestId("file-card")[0]!.querySelector("img")).toHaveAttribute(
      "src",
      "asset:///cache/x.png"
    )
  );
});

async function mountGrid(entries: WireEntry[]) {
  ipc.listDir.mockResolvedValue(entries);
  const tab = openTab();
  render(<Host tab={tab} />);
  await screen.findByTestId("folder-grid");
  await waitFor(() => expect(screen.queryAllByTestId("file-card").length).toBeGreaterThan(0));
}

test("the_view_buttons_switch_between_list_and_grid_through_the_actions", async () => {
  await mount([entry("a")]);
  fireEvent.click(screen.getByRole("button", { name: /grid view/i }));
  await screen.findByTestId("folder-grid");
  expect(ipc.settingsSet).toHaveBeenCalledWith({ view_mode: "grid" });
  fireEvent.keyDown(window, { key: "1", ctrlKey: true });
  await screen.findByTestId("folder-list");
  expect(ipc.settingsSet).toHaveBeenLastCalledWith({ view_mode: "list" });
});

test("breadcrumb_segments_navigate", async () => {
  await mount([], "/home/u/docs");
  const crumbs = screen.getByRole("navigation", { name: /path/i });
  expect(
    within(crumbs)
      .getAllByRole("button")
      .map((b) => b.textContent)
  ).toEqual(["/", "home", "u", "docs"]);
  fireEvent.click(within(crumbs).getByRole("button", { name: "home" }));
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/home"));
});

test("ctrl_l_opens_the_location_bar_and_enter_navigates", async () => {
  await mount([], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  expect(input).toHaveFocus();
  expect(input).toHaveValue("/d");
  ipc.listDir.mockResolvedValue([]);
  fireEvent.change(input, { target: { value: "~/Documents" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/home/u/Documents"))
  );
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /location/i })).toBeNull());
});

test("the_location_bar_closes_when_focus_leaves_it_and_the_list_does_not_take_the_focus_back", async () => {
  await mount([entry("a")], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  fireEvent.change(input, { target: { value: "/typed" } });
  const grid = screen.getByRole("button", { name: /grid view/i });
  grid.focus();
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /location/i })).toBeNull());
  expect(grid).toHaveFocus();
  // The typed text is gone: reopening shows the folder's path.
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  expect(await screen.findByRole("textbox", { name: /location/i })).toHaveValue("/d");
});

test("escape_closes_the_location_bar_and_gives_the_keyboard_to_the_list", async () => {
  await mount([entry("a")], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /location/i })).toBeNull());
  expect(screen.getByTestId("folder-list")).toHaveFocus();
});

test("a_missing_location_is_navigated_to_and_shown_as_gone_by_the_view", async () => {
  await mount([], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  ipc.listDir.mockClear();
  ipc.listDir.mockImplementation((path: WirePath) =>
    path.v === "/"
      ? Promise.resolve([])
      : Promise.reject({ kind: "NotFound", message: "nope", path: null, details: null })
  );
  fireEvent.change(input, { target: { value: "/nope" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByTestId("gone-banner")).toHaveTextContent("/nope");
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/nope"));
  // The bar did not list the folder to check it: the view's own listing is the only one.
  expect(ipc.listDir.mock.calls.filter((c) => (c[0] as WirePath).v === "/nope")).toHaveLength(1);
});

test("an_unchanged_location_keeps_the_original_path", async () => {
  // "/home/<0xF6>" is not UTF-8, so the tab holds it as Bytes and the bar shows U+FFFD.
  const bytes: WirePath = { k: "Bytes", v: btoa("/home/\xf6") };
  ipc.listDir.mockResolvedValue([]);
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(bytes, false);
  const tab = activeTab(useTabs.getState()) as FolderTab;
  render(<Host tab={tab} />);
  await screen.findByTestId("folder-empty");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  expect(input).toHaveValue("/home/\ufffd");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /location/i })).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  const now = activeTab(useTabs.getState()) as FolderTab;
  expect(now.path).toEqual(bytes);
  expect(now.history).toHaveLength(1);
});

test("an_edited_location_with_a_replacement_character_is_refused", async () => {
  await mount([], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  fireEvent.change(input, { target: { value: "/home/\ufffd/x" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/not valid UTF-8/);
  expect(alert).toHaveTextContent(/breadcrumb/i);
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d"));
});

test("a_relative_location_is_refused_inline", async () => {
  await mount([], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  fireEvent.change(input, { target: { value: "docs" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(/absolute/);
});

test("settings_that_cannot_be_read_are_shown_with_a_retry", async () => {
  ipc.settingsGet.mockRejectedValueOnce({
    kind: "Io",
    message: "settings broken",
    path: null,
    details: null,
  });
  ipc.listDir.mockResolvedValue([entry("a")]);
  const tab = openTab();
  render(<Host tab={tab} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("settings broken");
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await screen.findByTestId("folder-list");
});

test("unmount_stops_the_watch_and_the_thumbnails", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  ipc.listDir.mockResolvedValue([entry("a.png", { mime: "image/png" })]);
  const tab = openTab();
  const { unmount } = render(<Host tab={tab} />);
  await screen.findByTestId("folder-grid");
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalled());
  const key = ipc.thumbRequest.mock.calls[0]![0];
  unmount();
  await waitFor(() => expect(ipc.unwatchDir).toHaveBeenCalledWith(tab.id));
  expect(ipc.thumbCancel).toHaveBeenCalledWith(key);
});

test("every_grid_mount_has_its_own_thumbnail_key", async () => {
  // A cancel of the old view must never land on the new view's queue.
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  ipc.listDir.mockResolvedValue([entry("a.png", { mime: "image/png" })]);
  const tab = openTab("/d/x");
  render(<Host tab={tab} />);
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalledTimes(1));
  fireEvent.click(
    within(screen.getByRole("navigation", { name: /path/i })).getByRole("button", { name: "d" })
  );
  await waitFor(() => expect(ipc.thumbRequest).toHaveBeenCalledTimes(2));
  const [first, second] = ipc.thumbRequest.mock.calls.map((c) => c[0]);
  expect(first).not.toBe(second);
  expect(ipc.thumbCancel).toHaveBeenCalledWith(first);
  expect(ipc.thumbCancel).not.toHaveBeenCalledWith(second);
});

test("a_folder_tab_outcome_is_left_to_its_directive", async () => {
  const { tab } = await mount([entry("link-to-dir")]);
  ipc.openPaths.mockResolvedValue([
    { path: p("/d/link-to-dir"), action: "folder_tab", location: null, error: null },
  ]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalled());
  await act(async () => {});
  expect(useTabs.getState().tabs).toHaveLength(1);
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d"));
  expect(activeTab(useTabs.getState())?.id).toBe(tab.id);
});

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => entry(`f${String(i).padStart(2, "0")}.txt`));

test("opening_more_than_ten_items_asks_first", async () => {
  await mount(many(12));
  ipc.openPaths.mockResolvedValue([]);
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  fireEvent.keyDown(window, { key: "Enter" });
  const ask = await screen.findByRole("alertdialog");
  expect(ask).toHaveTextContent("12");
  expect(ipc.openPaths).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: /cancel/i }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(ipc.openPaths).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Enter" });
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: /open 12/i })
  );
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalledTimes(1));
  expect(ipc.openPaths.mock.calls[0]![0]).toHaveLength(12);
});

test("opening_ten_items_does_not_ask", async () => {
  await mount(many(10));
  ipc.openPaths.mockResolvedValue([]);
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  fireEvent.keyDown(window, { key: "Enter" });
  await waitFor(() => expect(ipc.openPaths).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("focus_returns_to_the_list_after_header_breadcrumb_and_view_buttons", async () => {
  await mount([entry("a"), entry("b")], "/d/x");
  const list = () => screen.getByTestId("folder-list");
  const header = screen.getByRole("columnheader", { name: "Size" });
  within(header).getByRole("button").focus();
  fireEvent.click(within(header).getByRole("button"));
  expect(list()).toHaveFocus();
  const crumb = within(screen.getByRole("navigation", { name: /path/i })).getByRole("button", {
    name: "d",
  });
  crumb.focus();
  fireEvent.click(crumb);
  await waitFor(() => expect(list()).toHaveFocus());
  const grid = screen.getByRole("button", { name: /grid view/i });
  grid.focus();
  fireEvent.click(grid);
  await screen.findByTestId("folder-grid");
  await waitFor(() => expect(screen.getByTestId("folder-grid")).toHaveFocus());
});

test("the_view_scrolls_to_the_cursor_on_keyboard_moves_only", async () => {
  const scrollTo = vi.fn();
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  try {
    await mount(many(100));
    scrollTo.mockClear();
    fireEvent.keyDown(window, { key: "End" });
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    // A relist that puts five new rows above the cursor moves its index; the view stays.
    scrollTo.mockClear();
    ipc.listDir.mockResolvedValue([
      ...many(100),
      ...[0, 1, 2, 3, 4].map((i) => entry(`a${i}.txt`)),
    ]);
    fireEvent.keyDown(window, { key: "F5" });
    await waitFor(() =>
      expect(screen.getByTestId("folder-list")).toHaveAttribute("aria-rowcount", "105")
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(scrollTo).not.toHaveBeenCalled();
  } finally {
    delete (Element.prototype as unknown as Record<string, unknown>).scrollTo;
  }
});

test("a_vanished_folder_says_it_is_still_looking_while_it_walks_up", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let removed = false;
  ipc.listDir.mockImplementation(async (path: WirePath) => {
    if (path.v === "/a/b" && !removed) return [entry("x")];
    if (path.v === "/a") {
      await gate;
      return [];
    }
    throw { kind: "NotFound", message: "nope", path: null, details: null };
  });
  const tab = openTab("/a/b");
  render(<Host tab={tab} />);
  await screen.findByTestId("folder-list");
  removed = true;
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: tab.id });
  });
  const banner = await screen.findByTestId("gone-banner");
  expect(banner).toHaveTextContent(/looking/i);
  expect(within(banner).queryByRole("button")).toBeNull();
  await act(async () => release());
  await within(banner).findByRole("button", { name: "/a" });
});

test("enter_on_a_focused_breadcrumb_navigates_once_and_does_not_open_the_selection", async () => {
  await mount([entry("a.txt")], "/d/x");
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  const crumb = within(screen.getByRole("navigation", { name: /path/i })).getByRole("button", {
    name: "d",
  });
  crumb.focus();
  // The key is the button's: no folder shortcut claims it.
  expect(fireEvent.keyDown(crumb, { key: "Enter" })).toBe(true);
  fireEvent.click(crumb);
  expect(ipc.openPaths).not.toHaveBeenCalled();
  const tab = activeTab(useTabs.getState()) as FolderTab;
  expect(tab.path).toEqual(p("/d"));
  expect(tab.history).toHaveLength(2);
});

test("the_confirmation_takes_focus_closes_on_escape_and_blocks_the_keys_behind_it", async () => {
  await mount(many(12));
  ipc.openPaths.mockResolvedValue([]);
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  fireEvent.keyDown(window, { key: "Enter" });
  const ask = await screen.findByRole("alertdialog");
  expect(within(ask).getByRole("button", { name: /cancel/i })).toHaveFocus();
  // Keys meant for the list do nothing while the question is open. A real key
  // is aimed at the focused element, here the Cancel button inside the view.
  const cancel = within(ask).getByRole("button", { name: /cancel/i });
  const selected = () =>
    screen.getAllByTestId("file-row").filter((r) => r.getAttribute("aria-selected") === "true")
      .length;
  expect(selected()).toBe(12);
  fireEvent.keyDown(cancel, { key: "ArrowDown" });
  fireEvent.keyDown(cancel, { key: "A", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(cancel, { key: "Enter", ctrlKey: true });
  expect(selected()).toBe(12);
  expect(ipc.openPaths).not.toHaveBeenCalled();
  // Escape answers no.
  fireEvent.keyDown(cancel, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(ipc.openPaths).not.toHaveBeenCalled();
  // And the keys work again.
  fireEvent.keyDown(window, { key: "A", ctrlKey: true, shiftKey: true });
  expect(selected()).toBe(0);
});

test("the_confirmation_holds_only_the_keys_aimed_inside_its_folder_view", async () => {
  await mount(many(12));
  ipc.openPaths.mockResolvedValue([]);
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  fireEvent.keyDown(window, { key: "Enter" });
  await screen.findByRole("alertdialog");
  // A key aimed at something outside the view (another part of the window) is not held,
  // and a key aimed inside the view is.
  const outside = document.body.appendChild(document.createElement("button"));
  const seen: boolean[] = [];
  const probe = (e: Event) => seen.push(e.defaultPrevented);
  window.addEventListener("keydown", probe);
  try {
    fireEvent.keyDown(outside, { key: "x", ctrlKey: true });
    fireEvent.keyDown(screen.getByTestId("folder-list"), { key: "x", ctrlKey: true });
    expect(seen).toEqual([false]);
  } finally {
    window.removeEventListener("keydown", probe);
    outside.remove();
  }
});

test("a_folder_on_an_unmounted_volume_offers_the_nearest_folder_that_still_exists", async () => {
  // Unmounting removes the mount point; the watch of a folder under it ends with dir-gone.
  let unmounted = false;
  ipc.listDir.mockImplementation(async (path: WirePath) => {
    const under = path.v.startsWith("/run/media/t/STICK");
    if (under && unmounted) {
      throw { kind: "NotFound", message: "no such directory", path: null, details: null };
    }
    return [entry("x")];
  });
  const tab = openTab("/run/media/t/STICK/a/b");
  render(<Host tab={tab} />);
  await screen.findByTestId("folder-list");
  unmounted = true;
  act(() => {
    void handlers["kernkraft://dir-gone"]!({ key: tab.id });
  });
  const banner = await screen.findByTestId("gone-banner");
  // Not the stale entries, and not a blank pane: the folder above the mount point.
  expect(screen.queryByTestId("file-row")).toBeNull();
  fireEvent.click(await within(banner).findByRole("button", { name: "/run/media/t" }));
  await waitFor(() =>
    expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/run/media/t"))
  );
});

test("the_confirmation_holds_keys_aimed_at_the_page_body_while_this_tab_is_active", async () => {
  await mount(many(12));
  ipc.openPaths.mockResolvedValue([]);
  fireEvent.click(screen.getAllByTestId("file-row")[0]!);
  fireEvent.keyDown(window, { key: "a", ctrlKey: true });
  fireEvent.keyDown(window, { key: "Enter" });
  await screen.findByRole("alertdialog");
  const selected = () =>
    screen.getAllByTestId("file-row").filter((r) => r.getAttribute("aria-selected") === "true")
      .length;
  expect(selected()).toBe(12);
  fireEvent.keyDown(document.body, { key: "A", ctrlKey: true, shiftKey: true });
  expect(selected()).toBe(12);
});

test("an_empty_folder_note_takes_the_keyboard_after_navigating_into_it", async () => {
  ipc.listDir.mockResolvedValue([dir("sub")]);
  const tab = openTab("/d/x");
  render(<Host tab={tab} />);
  await screen.findByTestId("folder-list");
  await waitFor(() => expect(screen.queryAllByTestId("file-row").length).toBeGreaterThan(0));
  ipc.listDir.mockResolvedValue([]);
  const crumb = within(screen.getByRole("navigation", { name: /path/i })).getByRole("button", {
    name: "d",
  });
  fireEvent.click(crumb);
  const note = await screen.findByTestId("folder-empty");
  expect(note).toHaveAttribute("tabindex", "-1");
  await waitFor(() => expect(note).toHaveFocus());
  expect(document.body).not.toHaveFocus();
});

test("focusing_the_list_with_no_cursor_puts_the_cursor_on_the_first_item_without_selecting", async () => {
  await mount([entry("a"), entry("b"), entry("c")]);
  const list = screen.getByTestId("folder-list");
  const selected = () =>
    screen.getAllByTestId("file-row").map((r) => r.getAttribute("aria-selected") === "true");
  act(() => list.focus());
  expect(selected()).toEqual([false, false, false]);
  expect(screen.getAllByTestId("file-row")[0]).toHaveClass("kern-cursor");
  // The arrow key agrees with the outline: it moves on from the first item.
  fireEvent.keyDown(window, { key: "ArrowDown" });
  expect(selected()).toEqual([false, true, false]);
  expect(screen.getAllByTestId("file-row")[1]).toHaveClass("kern-cursor");
});

test("focusing_the_grid_with_no_cursor_seeds_it_too", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  await mountGrid([entry("a"), entry("b")]);
  act(() => screen.getByTestId("folder-grid").focus());
  fireEvent.keyDown(window, { key: "ArrowRight" });
  const cards = screen.getAllByTestId("file-card");
  expect(cards[1]).toHaveAttribute("aria-selected", "true");
  expect(cards[0]).toHaveAttribute("aria-selected", "false");
});

test("a_list_emptied_while_it_has_the_keyboard_hands_it_to_the_empty_note", async () => {
  await mount([entry("a"), entry("b")]);
  act(() => screen.getByTestId("folder-list").focus());
  ipc.listDir.mockResolvedValue([]);
  fireEvent.keyDown(window, { key: "F5" });
  const note = await screen.findByTestId("folder-empty");
  await waitFor(() => expect(note).toHaveFocus());
});

test("a_list_emptied_after_the_user_clicked_away_does_not_take_the_keyboard_back", async () => {
  await mount([entry("a"), entry("b")]);
  const list = screen.getByTestId("folder-list");
  act(() => list.focus());
  // A click on the page's background: focus goes to the body, with no element to go to.
  act(() => list.blur());
  ipc.listDir.mockResolvedValue([]);
  fireEvent.keyDown(window, { key: "F5" });
  const note = await screen.findByTestId("folder-empty");
  expect(note).not.toHaveFocus();
});

test("a_list_emptied_while_another_window_has_the_focus_keeps_the_keyboard_in_the_view", async () => {
  await mount([entry("a")]);
  const list = screen.getByTestId("folder-list");
  act(() => list.focus());
  // The window loses focus: the list blurs while the document has none, which is not the user
  // leaving the list. The note takes the keyboard it will have when the window comes back.
  hasFocus.mockReturnValue(false);
  act(() => list.blur());
  ipc.listDir.mockResolvedValue([]);
  fireEvent.keyDown(window, { key: "F5" });
  const note = await screen.findByTestId("folder-empty");
  await waitFor(() => expect(note).toHaveFocus());
});

test("enter_with_nothing_selected_opens_the_outlined_item", async () => {
  await mount([dir("sub"), entry("b")]);
  act(() => screen.getByTestId("folder-list").focus());
  // The first row is outlined and nothing is selected.
  expect(screen.getAllByTestId("file-row")[0]).toHaveClass("kern-cursor");
  fireEvent.keyDown(window, { key: "Enter" });
  await waitFor(() =>
    expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d/sub"))
  );
});

test("enter_in_the_grid_with_nothing_selected_opens_the_outlined_item", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  await mountGrid([dir("sub"), entry("b")]);
  act(() => screen.getByTestId("folder-grid").focus());
  fireEvent.keyDown(window, { key: "Enter" });
  await waitFor(() =>
    expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d/sub"))
  );
});

test("enter_with_no_selection_and_no_cursor_does_nothing", async () => {
  await mount([dir("sub")]);
  fireEvent.keyDown(window, { key: "Enter" });
  await act(async () => {});
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d"));
});
