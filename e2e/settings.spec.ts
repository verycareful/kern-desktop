// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The mocks are serialised into the page, so each is self-contained.
const SETTINGS = {
  follow: { colours: true, accent: true, fonts: true, radius: true },
  theme_mode: "system",
  accent: "slate",
  density: "cozy",
  show_hidden: false,
  view_mode: "list",
  default_layout: "file_manager",
  new_tab_folder: null,
  new_tab_default: "folder",
  interface_size: 100,
  terminal: null,
};

test("the_version_beside_the_logo_is_centred_on_the_mark", async ({ page, mockTauri }) => {
  await mockTauri({
    open_pending_take: [],
    settings_get: SETTINGS,
    ...EMPTY_PINNED_RECENT,
    "plugin:kernkraft-tauri|user_dirs": { home: { k: "Utf8", v: "/home/t" }, dirs: [] },
    "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  });
  // This page is the Settings window.
  await page.addInitScript(() => {
    const w = window as unknown as { __TAURI_INTERNALS__: { metadata: unknown } };
    w.__TAURI_INTERNALS__.metadata = {
      currentWindow: { label: "settings" },
      currentWebview: { label: "settings" },
    };
  });
  await page.goto("/");
  const logo = page.locator(".kern-settings-nav-foot .kern-logo");
  await expect(logo).toBeVisible();
  const m = await logo.evaluate((el) => {
    const mark = el.querySelector(".kern-logo-mark")!.getBoundingClientRect();
    const ver = el.querySelector(".kern-logo-version")!;
    const box = ver.getBoundingClientRect();
    return {
      markMid: mark.top + mark.height / 2,
      verMid: box.top + box.height / 2,
      verHeight: box.height,
      fontSize: parseFloat(getComputedStyle(ver).fontSize),
    };
  });
  // The box is the digits' cap height, well under the font size, so its middle is theirs.
  expect(m.verHeight).toBeLessThan(m.fontSize);
  expect(Math.abs(m.verMid - m.markMid)).toBeLessThanOrEqual(0.5);
});
