// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The notices the side panels show (shell.css .kern-places-error), measured in a real layout.
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
    default_layout: "file_manager",
    new_tab_folder: null,
    new_tab_default: "folder",
  },
  "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  "plugin:kernkraft-tauri|watch_dir": null,
  "plugin:kernkraft-tauri|unwatch_dir": null,
  // The window reads the undo history once.
  "plugin:kernkraft-tauri|undo_state": { undo: null, redo: null },
  "plugin:kernkraft-tauri|list_dir": [],
  "plugin:kernkraft-tauri|user_dirs": {
    home: { k: "Utf8", v: "/home/tester" },
    dirs: [
      { name: "desktop", path: { k: "Utf8", v: "/home/tester/Desktop" } },
      { name: "documents", path: { k: "Utf8", v: "/home/tester/Documents" } },
    ],
  },
  "plugin:kernkraft-tauri|volumes_problems_take": [],
  ...EMPTY_PINNED_RECENT,
  "plugin:kernkraft-tauri|volumes_list": {
    mounted: [
      {
        mount_point: { k: "Utf8", v: "/run/media/tester/STICK" },
        identity: { state: "known", major: 8, minor: 17, diskseq: 12 },
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
        uuid: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
        identity: { state: "known", major: 8, minor: 33, diskseq: 13 },
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

test("a_one_line_notice_has_its_text_centred_beside_its_dismiss_button", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({
    ...COMMON,
    prune: {
      pins_removed: [],
      recents_removed: [],
      corrupt: [],
      pins: { entries: [] },
      recents: { entries: [] },
      errors: [
        {
          path: { k: "Utf8", v: "/home/tester/gone" },
          error: { kind: "Io", message: "no way to look", path: null, details: null },
        },
      ],
    },
  });
  await page.goto("/");
  const notice = page.locator(".kern-places-error", { hasText: "could not check whether gone" });
  await expect(notice).toBeVisible();
  const m = await notice.evaluate((el) => {
    const text = el.querySelector("span")!.getBoundingClientRect();
    const button = el.querySelector("button")!.getBoundingClientRect();
    return {
      textMid: text.top + text.height / 2,
      buttonMid: button.top + button.height / 2,
    };
  });
  expect(Math.abs(m.textMid - m.buttonMid)).toBeLessThanOrEqual(1);
});
