// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect } from "./support/mockInvoke";

test("boots_with_mocked_ipc", async ({ page, mockTauri }) => {
  // The theme the shell asks for at startup.
  await mockTauri({
    settings_get: {
      follow: { colours: true, accent: true, fonts: true, radius: true },
      theme_mode: "system",
      accent: "slate",
      density: "cozy",
      show_hidden: false,
      view_mode: "list",
    },
    "plugin:kernkraft-tauri|list_dir": [],
    "plugin:kernkraft-tauri|watch_dir": null,
    "plugin:kernkraft-tauri|unwatch_dir": null,
    "plugin:kernkraft-tauri|user_dirs": { home: { k: "Utf8", v: "/home/tester/docs" }, dirs: [] },
    "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByTestId("shell")).toBeVisible();
  // The Home folder tab and the three regions of a folder tab.
  await expect(page.getByRole("tab", { name: /docs/ })).toBeVisible();
  await expect(page.getByTestId("places-strip")).toBeVisible();
  await expect(page.getByTestId("folder-area")).toBeVisible();
  await expect(page.getByTestId("side-panel")).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("/home/tester/docs");

  // R55 layout: the places strip runs from the window top down to the status
  // bar, the tab row sits over the folder area (its left edge is the folder
  // area's) and ends at the right third, which runs from the window top; the
  // status bar spans the bottom.
  const tabBar = (await page.getByTestId("tab-bar").boundingBox())!;
  const places = (await page.getByTestId("places-strip").boundingBox())!;
  const area = (await page.getByTestId("folder-area").boundingBox())!;
  const side = (await page.getByTestId("side-panel").boundingBox())!;
  const status = (await page.getByTestId("status-bar").boundingBox())!;
  expect(places.y).toBe(0);
  expect(places.y + places.height).toBeCloseTo(status.y, 0);
  expect(tabBar.x).toBeCloseTo(area.x, 0);
  expect(tabBar.x).toBeCloseTo(places.x + places.width, 0);
  expect(tabBar.y).toBeLessThanOrEqual(places.y);
  expect(tabBar.x + tabBar.width).toBeCloseTo(side.x, 0);
  expect(tabBar.y + tabBar.height).toBeCloseTo(area.y, 0);
  expect(side.y).toBe(0);
  expect(side.y + side.height).toBeCloseTo(status.y, 0);
  expect(Math.abs(side.width / (side.x + side.width) - 1 / 3)).toBeLessThan(0.02);
  expect(status.x).toBe(0);
  expect(status.width).toBeGreaterThanOrEqual(side.x + side.width - 1);

  // Alt+Up goes to the parent, Alt+Left comes back (actions table shortcuts).
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("status-bar")).toContainText("/home/tester");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("status-bar")).toContainText("/home/tester/docs");

  // Right-click menu reads the same table.
  await page.getByRole("tab").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Close tab/ })).toContainText("Ctrl+W");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("action-menu")).toHaveCount(0);
  expect(errors).toEqual([]);
});
