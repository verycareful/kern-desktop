// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The panel orders are settings; the real layout engine places the panels by them, so the boxes
// are read from the page. The mocks are serialised into the page, so each is self-contained.
const COMMON = {
  open_pending_take: [],
  layout_get: {
    left_width: 300,
    left_open: true,
    right_width: 260,
    tree_root: { k: "Utf8", v: "/home/tester" },
  },
  layout_set: { left_width: 300, left_open: true, right_width: 260, tree_root: null },
  "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  "plugin:kernkraft-tauri|list_dir": [],
  "plugin:kernkraft-tauri|watch_dir": null,
  "plugin:kernkraft-tauri|unwatch_dir": null,
  "plugin:kernkraft-tauri|undo_state": { undo: null, redo: null },
  "plugin:kernkraft-tauri|user_dirs": { home: { k: "Utf8", v: "/home/tester" }, dirs: [] },
  "plugin:kernkraft-tauri|volumes_problems_take": [],
  "plugin:kernkraft-tauri|volumes_list": { mounted: [], unmounted: [], problems: [] },
  open_paths: [],
  ...EMPTY_PINNED_RECENT,
};

const settings = (extra: Record<string, unknown>) => ({
  follow: { colours: true, accent: true, fonts: true, radius: true },
  theme_mode: "system",
  accent: "slate",
  show_hidden: false,
  view_mode: "list",
  default_layout: "file_manager",
  new_tab_folder: null,
  new_tab_default: "folder",
  ...extra,
});

async function boxes(page: import("@playwright/test").Page) {
  const box = async (id: string) => {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, id).not.toBeNull();
    return b!;
  };
  return {
    places: await box("places-strip"),
    folder: await box("folder-area"),
    pinned: await box("side-panel"),
    grid: await box("main-grid"),
  };
}

test("the_default_order_is_places_folders_pinned_from_left_to_right", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({ ...COMMON, settings_get: settings({}) });
  await page.goto("/");
  const b = await boxes(page);
  expect(b.places.x).toBeLessThan(b.folder.x);
  expect(b.folder.x).toBeLessThan(b.pinned.x);
});

test("pinned_and_recent_first_puts_it_on_the_left_and_the_strip_on_the_right", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({
    ...COMMON,
    settings_get: settings({ panel_order: ["pinned", "folder", "places"] }),
  });
  await page.goto("/");
  const b = await boxes(page);
  expect(b.pinned.x).toBeLessThan(b.folder.x);
  expect(b.folder.x).toBeLessThan(b.places.x);
  // The three columns fill the grid with no gap and no overlap, at their own widths.
  expect(Math.round(b.pinned.x + b.pinned.width)).toBe(Math.round(b.folder.x));
  expect(Math.round(b.folder.x + b.folder.width)).toBe(Math.round(b.places.x));
  expect(Math.round(b.places.x + b.places.width)).toBe(Math.round(b.grid.x + b.grid.width));
  expect(Math.round(b.pinned.width)).toBe(260);
});

test("the_folder_area_can_be_first_and_the_tab_row_stays_over_it", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    settings_get: settings({ panel_order: ["folder", "places", "pinned"] }),
  });
  await page.goto("/");
  const b = await boxes(page);
  const tabs = await page.getByTestId("tab-bar").boundingBox();
  expect(b.folder.x).toBeLessThan(b.places.x);
  expect(b.places.x).toBeLessThan(b.pinned.x);
  expect(Math.round(tabs!.x)).toBe(Math.round(b.folder.x));
  expect(Math.round(tabs!.width)).toBe(Math.round(b.folder.width));
});

test("the_editor_layout_puts_the_folder_column_right_of_the_editor_when_ordered_so", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({
    ...COMMON,
    settings_get: settings({
      default_layout: "editor",
      editor_panel_order: ["pinned", "places"],
    }),
  });
  await page.goto("/");
  const column = await page.getByTestId("editor-left").boundingBox();
  const welcome = await page.getByTestId("welcome-pane").boundingBox();
  expect(column).not.toBeNull();
  expect(welcome).not.toBeNull();
  expect(column!.x).toBeGreaterThan(welcome!.x);
  expect(Math.round(column!.width)).toBe(300);
});
