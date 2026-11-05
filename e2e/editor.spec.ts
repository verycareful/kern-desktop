// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The mocks are serialised into the page, so each is self-contained.
const FILE = { k: "Utf8", v: "/home/tester/notes.txt" };
const OPENED = (text: string, over: Record<string, unknown> = {}) => ({
  path: FILE,
  text,
  ending: "lf",
  bom: false,
  read_only: null,
  stamp: "s1:13:0:1:1:0",
  ...over,
});

const COMMON = {
  open_pending_take: [{ event: "kern://open", payload: { kind: "doc_tab", path: FILE } }],
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
    word_wrap: false,
    editor_zoom: 1,
    interface_size: 90,
  },
  "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  "plugin:kernkraft-tauri|watch_dir": null,
  "plugin:kernkraft-tauri|unwatch_dir": null,
  "plugin:kernkraft-tauri|undo_state": { undo: null, redo: null },
  "plugin:kernkraft-tauri|text_check": "same",
  "plugin:kernkraft-tauri|user_dirs": {
    home: { k: "Utf8", v: "/home/tester" },
    dirs: [],
  },
  "plugin:kernkraft-tauri|volumes_list": { mounted: [], unmounted: [], problems: [] },
  "plugin:kernkraft-tauri|volumes_problems_take": [],
  doc_opened: null,
  doc_closed: null,
  recent_touch: { entries: [] },
  ...EMPTY_PINNED_RECENT,
};

test("open_edit_save_ctrl_s", async ({ page, mockTauri, invokeCalls }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft-tauri|text_open": OPENED("hello world\nline two"),
    "plugin:kernkraft-tauri|text_save": "s1:24:0:1:1:1",
  });
  await page.goto("/");

  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("hello world");
  await expect(page.getByRole("tab", { name: "notes.txt" })).toBeVisible();
  await expect(page.getByTestId("status-dirty")).toHaveCount(0);

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" and more");
  await expect(page.getByTestId("status-dirty")).toBeVisible();
  await expect(page.getByRole("img", { name: "Unsaved changes" }).first()).toBeVisible();

  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("status-dirty")).toHaveCount(0);

  const saves = (await invokeCalls()).filter((c) => c.cmd === "plugin:kernkraft-tauri|text_save");
  expect(saves).toHaveLength(1);
  expect(saves[0]!.args).toMatchObject({
    path: FILE,
    text: "hello world\nline two and more",
    ending: "lf",
    bom: false,
    // The file as opened; a normal save never skips the check.
    expect: { kind: "unchanged", stamp: "s1:13:0:1:1:0" },
  });
  // The document was registered and put in Recent when it opened.
  const cmds = (await invokeCalls()).map((c) => c.cmd);
  expect(cmds).toContain("doc_opened");
  expect(cmds).toContain("recent_touch");
});

test("status_bar_tracks_cursor", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft-tauri|text_open": OPENED("one\ntwo\nthree four", {
      ending: "crlf",
      bom: true,
    }),
  });
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("three four");

  const position = page.getByTestId("status-position");
  await editor.click();
  await page.keyboard.press("Control+Home");
  await expect(position).toHaveText("Ln 1, Col 1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText("Ln 2, Col 2");
  await page.keyboard.press("Control+End");
  await expect(position).toHaveText("Ln 3, Col 11");
  await page.keyboard.press("Home");
  await expect(position).toHaveText("Ln 3, Col 1");

  await expect(page.getByTestId("status-encoding")).toHaveText("UTF-8 with BOM");
  await expect(page.getByTestId("status-ending")).toHaveText("CRLF");
});

test("a_mixed_line_ending_file_opens_read_only_with_the_reason", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft-tauri|text_open": OPENED("a\nb", {
      read_only: { kind: "MixedLineEndings", detail: "mixed line endings: 1 LF, 1 CRLF, 0 CR" },
    }),
  });
  await page.goto("/");
  await expect(page.getByTestId("read-only-banner")).toContainText(
    "mixes Windows and Unix line endings"
  );
  await page.locator(".cm-content").click();
  await page.keyboard.type("zzz");
  await expect(page.locator(".cm-content")).not.toContainText("zzz");
  await expect(page.getByTestId("status-dirty")).toHaveCount(0);
});
