// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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

beforeEach(() => {
  restoreLayout = stubLayout();
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

test("double_click_on_a_text_file_opens_a_doc_tab_from_the_outcome", async () => {
  await mount([entry("n.txt", { mime: "text/plain" })]);
  const outcome: OpenOutcome = {
    path: p("/d/n.txt"),
    action: "doc_tab",
    location: null,
    error: null,
  };
  ipc.openPaths.mockResolvedValue([outcome]);
  fireEvent.doubleClick(screen.getAllByTestId("file-row")[0]!);
  await waitFor(() => expect(useTabs.getState().tabs.some((t) => t.kind === "doc")).toBe(true));
  expect(ipc.openPaths).toHaveBeenCalledWith([p("/d/n.txt")], "inside", "default");
  const doc = useTabs.getState().tabs.find((t) => t.kind === "doc")!;
  expect(doc.path).toEqual(p("/d/n.txt"));
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

test("a_location_that_cannot_be_listed_stays_open_with_the_error", async () => {
  await mount([], "/d");
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = await screen.findByRole("textbox", { name: /location/i });
  ipc.listDir.mockRejectedValue({
    kind: "NotFound",
    message: "no such folder: /nope",
    path: null,
    details: null,
  });
  fireEvent.change(input, { target: { value: "/nope" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent("no such folder: /nope");
  expect(input).toBeInTheDocument();
  expect((activeTab(useTabs.getState()) as FolderTab).path).toEqual(p("/d"));
  // Escape closes without navigating.
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: /location/i })).toBeNull();
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
  const { tab, unmount } = await mount([entry("a")]);
  unmount();
  expect(ipc.unwatchDir).toHaveBeenCalledWith(tab.id);
});
