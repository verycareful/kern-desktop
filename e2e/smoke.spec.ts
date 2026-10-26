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
    },
    "plugin:kernkraft|user_dirs": { home: { k: "Utf8", v: "/home/tester/docs" }, dirs: [] },
    "plugin:kernkraft|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
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
  await expect(page.getByTestId("status-bar")).toHaveText("/home/tester/docs");

  // Alt+Up goes to the parent, Alt+Left comes back (actions table shortcuts).
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("status-bar")).toHaveText("/home/tester");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByTestId("status-bar")).toHaveText("/home/tester/docs");

  // Right-click menu reads the same table.
  await page.getByRole("tab").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Close tab/ })).toContainText("Ctrl+W");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("action-menu")).toHaveCount(0);
  expect(errors).toEqual([]);
});
