// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect } from "./support/mockInvoke";

// The mocks are serialised into the page, so each is self-contained.
const COMMON = {
  open_pending_take: [],
  settings_get: {
    follow: { colours: true, accent: true, fonts: true, radius: true },
    theme_mode: "system",
    accent: "slate",
    density: "cozy",
    show_hidden: false,
    view_mode: "list",
  },
  "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  "plugin:kernkraft-tauri|watch_dir": null,
  "plugin:kernkraft-tauri|unwatch_dir": null,
  "plugin:kernkraft-tauri|list_dir": [],
  "plugin:kernkraft-tauri|user_dirs": {
    home: { k: "Utf8", v: "/home/tester" },
    dirs: [
      { name: "desktop", path: { k: "Utf8", v: "/home/tester/Desktop" } },
      { name: "documents", path: { k: "Utf8", v: "/home/tester/Documents" } },
    ],
  },
  "plugin:kernkraft-tauri|volumes_list": {
    mounted: [
      {
        mount_point: { k: "Utf8", v: "/run/media/tester/STICK" },
        device: "/dev/sdb1",
        fs_type: "vfat",
        label: "STICK",
        removable: true,
        read_only: false,
      },
    ],
    unmounted: [
      {
        object_path: "/org/freedesktop/UDisks2/block_devices/sdc1",
        device: "/dev/sdc1",
        label: "BACKUP",
        fs_type: "ext4",
        size: 500000000000,
        system: false,
      },
    ],
    problems: [],
  },
  "plugin:kernkraft-tauri|trash_list": {
    items: [
      {
        id: "1",
        name: "old.txt",
        original: { k: "Utf8", v: "/home/tester/Documents/old.txt" },
        deleted: "2026-10-20T14:05:09",
        trash_dir: { k: "Utf8", v: "/home/tester/.local/share/Trash" },
        is_dir: false,
      },
    ],
    unreadable: [],
  },
};

test("the_strip_lists_places_volumes_and_trash_and_the_trash_opens_in_a_tab", async ({
  page,
  mockTauri,
}) => {
  await mockTauri(COMMON);
  await page.goto("/");
  const strip = page.getByTestId("places-strip");
  await expect(strip.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
  // Home, then Documents, then Desktop.
  const places = await strip.getByRole("list").first().getByRole("button").allTextContents();
  expect(places).toEqual(["Home", "Documents", "Desktop"]);
  await expect(strip.getByRole("button", { name: "STICK" })).toBeVisible();
  await expect(strip.getByRole("button", { name: "Mount BACKUP" })).toBeVisible();

  await strip.getByRole("button", { name: "Documents" }).click();
  await expect(page.getByTestId("status-bar")).toContainText("/home/tester/Documents");
  await expect(page.getByRole("tab")).toHaveCount(1);

  await strip.getByRole("button", { name: "Trash" }).click();
  await expect(page.getByRole("tab", { name: "Trash" })).toBeVisible();
  const row = page.getByTestId("trash-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("/home/tester/Documents/old.txt");
  await expect(row).toContainText("2026-10-20 14:05");
  await expect(strip.getByRole("button", { name: "Trash" })).toHaveAttribute(
    "aria-current",
    "page"
  );

  // A place from the Trash brings the folder tab back.
  await strip.getByRole("button", { name: "Home" }).click();
  await expect(page.getByTestId("folder-view")).toBeVisible();
  await expect(page.getByTestId("status-bar")).toContainText("/home/tester");
});

test("empty_trash_asks_before_it_runs", async ({ page, mockTauri }) => {
  await mockTauri(COMMON);
  await page.goto("/");
  await page.getByTestId("places-strip").getByRole("button", { name: "Trash" }).click();
  await page.getByRole("button", { name: "Empty Trash" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("cannot be undone");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const calls = await page.evaluate(
    () => (window as unknown as { __tauriCalls: { cmd: string }[] }).__tauriCalls
  );
  expect(calls.some((c) => c.cmd.endsWith("|start_op"))).toBe(false);
});
