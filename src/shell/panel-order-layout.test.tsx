// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useUserDirs } from "./user-dirs-store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Panel, WirePath } from "../ipc";

const opened = vi.hoisted(() => ({ settings: [] as (string | undefined)[] }));

// The places strip looks the user's folders and the volumes up.
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  userDirs: () => Promise.resolve({ home: { k: "Utf8", v: "/home/a" }, dirs: [] }),
  volumesList: () => Promise.resolve({ mounted: [], unmounted: [], problems: [] }),
  volumesProblemsTake: () => Promise.resolve([]),
  on: () => Promise.resolve(() => undefined),
  // The window reads the undo history once.
  undoState: () => Promise.resolve({ undo: null, redo: null }),
  // Pinned and Recent read the pins and recents.
  prune: async () => (await import("./test-pinned-recent")).EMPTY_PRUNE,
  pinsGet: async () => ({ entries: [] }),
  storeErrorsTake: () => Promise.resolve([]),
  // A document tab's editor opens its file and registers it.
  textOpen: (path: WirePath) =>
    Promise.resolve({
      path,
      text: "hello",
      ending: "lf",
      bom: false,
      read_only: null,
      stamp: "s1:5:0:1:1:0",
    }),
  textCheck: () => Promise.resolve("same"),
  textSave: () => Promise.resolve("s1:6:0:1:1:1"),
  // Settings opens in a window of its own.
  openSettings: (section?: string) => {
    opened.settings.push(section);
    return Promise.resolve();
  },
  settingsGet: async () => (await import("../settings/test-settings")).SETTINGS,
  bindsGet: () => Promise.resolve({ binds: {} }),
  layoutGet: async () => (await import("../settings/test-settings")).NO_LAYOUT,
  defaultFmStatus: () => Promise.resolve({ is_default: true, current: null }),
  fm1Status: () => Promise.resolve({ owned: true, owner: null, reason: null }),
  recentTouch: () => Promise.resolve({ entries: [] }),
  docOpened: () => Promise.resolve(),
  docClosed: () => Promise.resolve(),
}));
import { usePanelsStore } from "../store/panels";
import { useLayout } from "../store/layout";
import { useTabs } from "../store/tabs";
import MainWindow from "./MainWindow";
import { usePinnedRecent } from "./pinned-recent-store";
import { useCloseGuard } from "./useCloseGuard";
import { useOps } from "../ops/useOps";
import { useViewSettings } from "../files/view-settings";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useUserDirs.getState().reset();
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useOps.setState({ notice: null });
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
  useLayout.setState({ loaded: true, rightWidth: 280 });
  useViewSettings.setState({ panelOrder: ["places", "folder", "pinned"] });
});
afterEach(cleanup);

/** Draws the window, then gives the settings store `order` (the stored settings answer the default). */
async function windowWithOrder(order: Panel[]) {
  render(<MainWindow />);
  await waitFor(() => expect(useViewSettings.getState().loaded).toBe(true));
  act(() => useViewSettings.setState({ panelOrder: order }));
}

const grid = () => screen.getByTestId("main-grid");

test("the_default_order_puts_the_strip_left_and_pinned_and_recent_right_with_no_flipped_edge", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  await windowWithOrder(["places", "folder", "pinned"]);
  expect(grid().style.getPropertyValue("--col-places")).toBe("1");
  expect(grid().style.getPropertyValue("--col-folder")).toBe("2");
  expect(grid().style.getPropertyValue("--col-pinned")).toBe("3");
  expect(screen.getByTestId("places-strip")).not.toHaveClass("kern-side-right");
  expect(screen.getByTestId("side-panel")).not.toHaveClass("kern-side-left");
});

test("the_grid_follows_the_panel_order_and_each_panel_keeps_its_border_towards_the_folder_area", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  await windowWithOrder(["pinned", "folder", "places"]);
  expect(grid().style.getPropertyValue("--shell-columns")).toBe(
    "var(--shell-right-width) minmax(0, 1fr) var(--shell-places-width)"
  );
  expect(grid().style.getPropertyValue("--col-pinned")).toBe("1");
  expect(grid().style.getPropertyValue("--col-folder")).toBe("2");
  expect(grid().style.getPropertyValue("--col-places")).toBe("3");
  expect(screen.getByTestId("places-strip")).toHaveClass("kern-side-right");
  expect(screen.getByTestId("side-panel")).toHaveClass("kern-side-left");
  // The same three cells of one grid, whatever the order.
  expect(screen.getByTestId("places-strip").parentElement).toBe(grid());
  expect(screen.getByTestId("folder-area").parentElement).toBe(grid());
  expect(screen.getByTestId("side-panel").parentElement).toBe(grid());
});

test("the_tab_row_stays_over_the_folder_area_when_the_folder_area_is_moved", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  await windowWithOrder(["folder", "places", "pinned"]);
  expect(grid().style.getPropertyValue("--col-folder")).toBe("1");
  expect(screen.getByTestId("tab-bar").parentElement).toBe(grid());
});

test("pinned_and_recent_on_the_left_widens_as_its_divider_moves_right", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  await windowWithOrder(["pinned", "folder", "places"]);
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Pinned and Recent" }), {
    key: "ArrowRight",
  });
  expect(useLayout.getState().rightWidth).toBe(296);
});

test("pinned_and_recent_on_the_right_widens_as_its_divider_moves_left", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  await windowWithOrder(["places", "folder", "pinned"]);
  fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Pinned and Recent" }), {
    key: "ArrowLeft",
  });
  expect(useLayout.getState().rightWidth).toBe(296);
});

test("beside_a_document_the_panel_buttons_and_the_slid_panels_follow_the_order", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  await windowWithOrder(["pinned", "folder", "places"]);
  // Pinned and Recent is first in the order, so its button is first on the row.
  const row = screen.getByTestId("tab-bar");
  const buttons = within(row)
    .getAllByRole("button")
    .filter((b) => b.getAttribute("data-testid")?.startsWith("panel-toggle"))
    .map((b) => b.getAttribute("data-testid"));
  expect(buttons).toEqual(["panel-toggle-right", "panel-toggle-left"]);
  act(() => usePanelsStore.setState({ leftSlid: true, rightSlid: true }));
  expect(screen.getByTestId("places-panel")).toHaveClass("kern-side-right");
  expect(screen.getByTestId("side-panel")).toHaveClass("kern-side-left");
});

test("beside_a_document_in_the_default_order_the_places_button_is_first_and_nothing_is_flipped", async () => {
  useTabs.getState().openFolder(p("/home/a"), false);
  useTabs.getState().openDoc(p("/home/a/n.md"));
  await windowWithOrder(["places", "folder", "pinned"]);
  const row = screen.getByTestId("tab-bar");
  const buttons = within(row)
    .getAllByRole("button")
    .filter((b) => b.getAttribute("data-testid")?.startsWith("panel-toggle"))
    .map((b) => b.getAttribute("data-testid"));
  expect(buttons).toEqual(["panel-toggle-left", "panel-toggle-right"]);
  act(() => usePanelsStore.setState({ leftSlid: true, rightSlid: true }));
  expect(screen.getByTestId("places-panel")).not.toHaveClass("kern-side-right");
  expect(screen.getByTestId("side-panel")).not.toHaveClass("kern-side-left");
});
