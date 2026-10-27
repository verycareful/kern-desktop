// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { pathKey, type Settings, type WireEntry, type WirePath } from "../ipc";
import { useFolderUi } from "../files/folder-ui";
import { entry } from "../files/test-entries";
import { stubLayout } from "../files/test-layout";
import { useViewSettings } from "../files/view-settings";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";

// Switching tabs keeps each folder tab's scroll offset, selection,
// cursor and location bar; the view is remounted, never kept hidden.

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
  userDirs: vi.fn(),
  volumesList: vi.fn(),
  thumbRequest: vi.fn(),
  thumbCancel: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  ...ipc,
  assetUrl: (f: { v: string }) => `asset://${f.v}`,
}));

import MainWindow from "./MainWindow";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const files = (dir: string, n: number): WireEntry[] =>
  Array.from({ length: n }, (_, i) => entry(`f${String(i).padStart(2, "0")}`, {}, dir));

// jsdom has no scrolling: a per-element offset, and a scroll height of 1000
// against the stubbed client height of 600 (so the largest offset is 400).
const offsets = new WeakMap<Element, number>();
const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 600;
let restoreScroll: () => void;
function stubScroll() {
  const top = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  const height = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return offsets.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      offsets.set(this, v);
    },
  });
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    value: SCROLL_HEIGHT,
  });
  return () => {
    for (const [name, d] of [
      ["scrollTop", top],
      ["scrollHeight", height],
    ] as const) {
      if (d) Object.defineProperty(Element.prototype, name, d);
      else delete (Element.prototype as unknown as Record<string, unknown>)[name];
    }
  };
}

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubLayout(800, CLIENT_HEIGHT);
  restoreScroll = stubScroll();
  ipc.on.mockResolvedValue(() => undefined);
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.thumbRequest.mockResolvedValue(undefined);
  ipc.thumbCancel.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({ home: p("/home/u"), dirs: [] });
  ipc.volumesList.mockResolvedValue({ mounted: [], unmounted: [], problems: [] });
  ipc.settingsGet.mockResolvedValue({
    show_hidden: false,
    view_mode: "list",
    density: "cozy",
  } as Settings);
  ipc.listDir.mockImplementation((path: WirePath) =>
    Promise.resolve(files((path as { v: string }).v, 30))
  );
  useViewSettings.setState({ loaded: false, error: null });
  useFolderUi.setState({ sort: {} });
  useTabs.setState({ tabs: [], activeId: null, views: {} });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreScroll();
  restoreLayout();
  vi.clearAllMocks();
});

/** Two folder tabs, /d/a (first) and /d/b (active), the window rendered and b listed. */
async function twoTabs() {
  useTabs.getState().openFolder(p("/d/a"), false);
  const a = useTabs.getState().activeId!;
  useTabs.getState().openFolder(p("/d/b"), true);
  const b = useTabs.getState().activeId!;
  render(<MainWindow />);
  await listed();
  return { a, b };
}
const listed = () =>
  waitFor(() => expect(screen.queryAllByTestId("file-row").length).toBeGreaterThan(0));
const row = (name: string) =>
  screen.getAllByTestId("file-row").find((r) => r.getAttribute("data-name") === name)!;
const selectedNames = () =>
  screen
    .queryAllByTestId("file-row")
    .filter((r) => r.getAttribute("aria-selected") === "true")
    .map((r) => r.getAttribute("data-name"));
const scroller = () => screen.getByTestId("folder-scroll");
async function switchTo(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
  await listed();
}
function scrollTo(top: number) {
  scroller().scrollTop = top;
  fireEvent.scroll(scroller());
}

test("switching_away_and_back_restores_scroll_selection_cursor_and_location", async () => {
  const { a } = await twoTabs();
  await switchTo("a");
  fireEvent.click(row("f02"));
  fireEvent.click(row("f04"), { ctrlKey: true });
  scrollTo(250);
  fireEvent.keyDown(window, { key: "l", ctrlKey: true });
  const input = screen.getByRole("textbox", { name: "Location" });
  fireEvent.change(input, { target: { value: "/d/typed" } });

  await switchTo("b");
  expect(selectedNames()).toEqual([]);
  expect(screen.queryByRole("textbox", { name: "Location" })).toBeNull();
  expect(scroller().scrollTop).toBe(0);
  expect(useTabs.getState().views[a]).toBeDefined();

  await switchTo("a");
  expect(selectedNames()).toEqual(["f02", "f04"]);
  expect(row("f04")).toHaveClass("kern-cursor");
  expect(scroller().scrollTop).toBe(250);
  expect(screen.getByRole("textbox", { name: "Location" })).toHaveValue("/d/typed");
});

test("a_closed_location_bar_stays_closed", async () => {
  await twoTabs();
  await switchTo("a");
  await switchTo("b");
  await switchTo("a");
  expect(screen.queryByRole("textbox", { name: "Location" })).toBeNull();
});

test("closing_a_tab_drops_its_state", async () => {
  const { a } = await twoTabs();
  await switchTo("a");
  fireEvent.click(row("f01"));
  await switchTo("b");
  expect(useTabs.getState().views[a]).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Close a" }));
  expect(useTabs.getState().views[a]).toBeUndefined();
  // A view torn down by the close does not save itself back.
  await act(async () => {});
  expect(useTabs.getState().views[a]).toBeUndefined();
  expect(Object.keys(useTabs.getState().views)).not.toContain(a);
});

test("an_entry_removed_meanwhile_is_not_reselected", async () => {
  await twoTabs();
  await switchTo("a");
  fireEvent.click(row("f03"));
  fireEvent.click(row("f05"), { ctrlKey: true });
  await switchTo("b");
  ipc.listDir.mockImplementation((path: WirePath) =>
    Promise.resolve(files((path as { v: string }).v, 30).filter((e) => e.name !== "f05"))
  );
  await switchTo("a");
  expect(screen.queryByText("f05")).toBeNull();
  expect(selectedNames()).toEqual(["f03"]);
});

test("a_saved_offset_beyond_the_new_end_is_clamped", async () => {
  await twoTabs();
  await switchTo("a");
  scrollTo(390);
  await switchTo("b");
  // The listing is now shorter: the document is no taller than the viewport.
  const shortHeight = vi.spyOn(Element.prototype, "scrollHeight", "get");
  shortHeight.mockReturnValue(CLIENT_HEIGHT + 100);
  await switchTo("a");
  expect(scroller().scrollTop).toBe(100);
  shortHeight.mockRestore();
});

test("navigating_in_the_tab_starts_fresh_and_back_does_not_restore", async () => {
  const { a } = await twoTabs();
  await switchTo("a");
  fireEvent.click(row("f02"));
  scrollTo(200);
  act(() => useTabs.getState().navigateTab(a, p("/d/a/sub")));
  await waitFor(() => expect(selectedNames()).toEqual([]));
  await listed();
  expect(scroller().scrollTop).toBe(0);
  expect(useTabs.getState().views[a]).toBeUndefined();
  act(() => useTabs.getState().back());
  await listed();
  expect(selectedNames()).toEqual([]);
  expect(scroller().scrollTop).toBe(0);
});

test("a_state_from_another_folder_of_the_tab_is_not_applied", async () => {
  const { a } = await twoTabs();
  useTabs.getState().saveView(a, {
    pathKey: "some other folder",
    scrollTop: 300,
    selected: ["some other folder/f01"],
    anchor: null,
    cursor: null,
    location: { text: "x" },
  });
  await switchTo("a");
  expect(selectedNames()).toEqual([]);
  expect(scroller().scrollTop).toBe(0);
  expect(screen.queryByRole("textbox", { name: "Location" })).toBeNull();
});

test("no_view_is_kept_mounted_for_a_tab_that_is_not_shown", async () => {
  await twoTabs();
  await switchTo("a");
  expect(screen.getAllByTestId("folder-view")).toHaveLength(1);
  await switchTo("b");
  expect(screen.getAllByTestId("folder-view")).toHaveLength(1);
});

test("a_view_that_never_listed_does_not_overwrite_the_saved_state", async () => {
  const { a } = await twoTabs();
  await switchTo("a");
  fireEvent.click(row("f07"));
  await switchTo("b");
  // Back to a, but away again before its listing arrives.
  let release: ((e: WireEntry[]) => void) | undefined;
  ipc.listDir.mockImplementation(() => new Promise<WireEntry[]>((r) => (release = r)));
  fireEvent.click(screen.getByRole("tab", { name: "a" }));
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.click(screen.getByRole("tab", { name: "b" }));
  await act(async () => release?.(files("/d/a", 30)));
  expect(useTabs.getState().views[a]?.selected).toEqual([pathKey(p("/d/a/f07"))]);
});

test("the_offset_survives_two_round_trips", async () => {
  await twoTabs();
  await switchTo("a");
  scrollTo(250);
  await switchTo("b");
  await switchTo("a");
  expect(scroller().scrollTop).toBe(250);
  // Away again without scrolling: the restored offset is what is kept.
  await switchTo("b");
  await switchTo("a");
  expect(scroller().scrollTop).toBe(250);
});

test("the_offset_survives_two_round_trips_in_the_grid", async () => {
  ipc.settingsGet.mockResolvedValue({
    show_hidden: false,
    view_mode: "grid",
    density: "cozy",
  } as Settings);
  useTabs.getState().openFolder(p("/d/a"), false);
  useTabs.getState().openFolder(p("/d/b"), true);
  render(<MainWindow />);
  const gridListed = () => waitFor(() => expect(screen.getByTestId("folder-grid")).toBeVisible());
  await gridListed();
  const go = async (name: string) => {
    fireEvent.click(screen.getByRole("tab", { name }));
    await gridListed();
    await waitFor(() => expect(screen.getAllByTestId("file-card").length).toBeGreaterThan(0));
  };
  await go("a");
  scrollTo(250);
  await go("b");
  await go("a");
  expect(scroller().scrollTop).toBe(250);
  await go("b");
  await go("a");
  expect(scroller().scrollTop).toBe(250);
});
