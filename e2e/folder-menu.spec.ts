// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The right-click menu of a folder tab and its submenus, with the real layout: where a submenu
// opens, that it flips at the window's edge, and that the menu fits the window. The mocks are
// serialised into the page, so each is self-contained.
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

test("a_submenu_opens_beside_its_row_level_with_it", async ({ page, mockTauri }) => {
  await mockTauri({ ...COMMON, settings_get: settings({}) });
  await page.goto("/");
  await page.getByTestId("folder-empty").click({ button: "right", position: { x: 40, y: 60 } });
  const menu = page.getByTestId("action-menu");
  await expect(menu).toBeVisible();
  const row = menu.getByRole("menuitem", { name: "More edit actions" });
  await row.hover();
  const sub = page.getByRole("menu", { name: "More edit actions" });
  await expect(sub).toBeVisible();
  const r = (await row.boundingBox())!;
  const s = (await sub.boundingBox())!;
  const first = (await sub.getByRole("menuitem").first().boundingBox())!;
  expect(Math.round(s.x)).toBe(Math.round(r.x + r.width));
  // The first entry of the submenu is level with the row it opened from.
  expect(Math.round(first.y)).toBe(Math.round(r.y));
  // The standard menu is short enough to need no scrolling in the default window.
  expect(await menu.evaluate((m) => m.scrollHeight <= m.clientHeight)).toBe(true);
});

test("a_submenu_flips_to_the_left_when_the_window_has_no_room_on_the_right", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({ ...COMMON, settings_get: settings({}) });
  await page.goto("/");
  const view = page.viewportSize()!;
  // A press at the folder area's right edge leaves less room on the right than a submenu needs.
  const area = (await page.getByTestId("folder-empty").boundingBox())!;
  await page
    .getByTestId("folder-empty")
    .click({ button: "right", position: { x: area.width - 10, y: 60 } });
  const menu = page.getByTestId("action-menu");
  await expect(menu).toBeVisible();
  const m = (await menu.boundingBox())!;
  expect(m.x + m.width).toBeLessThanOrEqual(view.width);
  const row = menu.getByRole("menuitem", { name: "View", exact: true });
  await row.hover();
  const sub = page.getByRole("menu", { name: "View" });
  await expect(sub).toBeVisible();
  const r = (await row.boundingBox())!;
  const s = (await sub.boundingBox())!;
  expect(s.x).toBeGreaterThanOrEqual(0);
  expect(s.x + s.width).toBeLessThanOrEqual(view.width);
  // It does not fit on the right, so it is on the left of the row.
  expect(r.x + r.width + s.width).toBeGreaterThan(view.width);
  expect(Math.round(s.x + s.width)).toBeLessThanOrEqual(Math.round(r.x) + 1);
});

test("the_collapsed_menu_is_six_rows_that_each_open_a_submenu", async ({ page, mockTauri }) => {
  await mockTauri({ ...COMMON, settings_get: settings({ folder_menu: "collapsed" }) });
  await page.goto("/");
  await page.getByTestId("folder-empty").click({ button: "right", position: { x: 40, y: 60 } });
  const menu = page.getByTestId("action-menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(6);
  await expect(menu.locator("[aria-haspopup=menu]")).toHaveCount(6);
});

test("the_expanded_menu_has_no_submenu_rows", async ({ page, mockTauri }) => {
  await mockTauri({ ...COMMON, settings_get: settings({ folder_menu: "expanded" }) });
  await page.goto("/");
  await page.getByTestId("folder-empty").click({ button: "right", position: { x: 40, y: 60 } });
  const menu = page.getByTestId("action-menu");
  await expect(menu.getByRole("menuitem", { name: /^Copy path/ })).toBeVisible();
  await expect(menu.locator("[aria-haspopup=menu]")).toHaveCount(0);
});
