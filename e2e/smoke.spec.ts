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
    "plugin:kernkraft|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByTestId("shell")).toBeVisible();
  expect(errors).toEqual([]);
});
