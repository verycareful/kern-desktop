// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The mocks are serialised into the page, so each is self-contained.
const COMMON = {
  open_pending_take: [],
  layout_get: {
    left_width: 300,
    left_open: true,
    tree_root: { k: "Utf8", v: "/home/tester" },
  },
  layout_set: { left_width: 300, left_open: true, tree_root: null },
  settings_get: {
    follow: { colours: true, accent: true, fonts: true, radius: true },
    theme_mode: "system",
    accent: "slate",
    density: "cozy",
    show_hidden: false,
    view_mode: "list",
    default_layout: "editor",
    new_tab_folder: null,
    new_tab_default: "folder",
  },
  "plugin:kernkraft-tauri|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  "plugin:kernkraft-tauri|watch_dir": null,
  "plugin:kernkraft-tauri|unwatch_dir": null,
  "plugin:kernkraft-tauri|undo_state": { undo: null, redo: null },
  "plugin:kernkraft-tauri|user_dirs": {
    home: { k: "Utf8", v: "/home/tester" },
    dirs: [{ name: "documents", path: { k: "Utf8", v: "/home/tester/Documents" } }],
  },
  "plugin:kernkraft-tauri|volumes_problems_take": [],
  "plugin:kernkraft-tauri|volumes_list": { mounted: [], unmounted: [], problems: [] },
  open_paths: [],
  ...EMPTY_PINNED_RECENT,
};

/** list_dir for a small tree: /home/tester holds docs/ (a.txt, deep/), src/ and two files. */
const SMALL_TREE = (args: Record<string, unknown>) => {
  const at = (args.path as { v: string }).v;
  const e = (dir: string, name: string, folder: boolean) => ({
    path: { k: "Utf8", v: `${dir}/${name}` },
    name,
    kind: folder ? "dir" : "file",
    target_is_dir: folder,
    len: 1,
    modified_ms: null,
    hidden: false,
    mime: "text/plain",
    mode: 0o644,
  });
  const tree: Record<string, [string, boolean][]> = {
    "/home/tester": [
      ["docs", true],
      ["src", true],
      ["readme.md", false],
      ["zed.txt", false],
    ],
    "/home/tester/docs": [
      ["a.txt", false],
      ["deep", true],
    ],
    "/home/tester/docs/deep": [["d.txt", false]],
    "/home/tester/src": [["main.rs", false]],
  };
  return (tree[at] ?? []).map(([n, f]) => e(at, n, f));
};

test("tree_keyboard_navigation", async ({ page, mockTauri, invokeCalls }) => {
  await mockTauri({ ...COMMON, "plugin:kernkraft-tauri|list_dir": SMALL_TREE });
  await page.goto("/");
  const tree = page.getByRole("tree");
  await expect(tree).toBeVisible();
  const items = page.getByRole("treeitem");
  await expect(items).toHaveCount(4);
  expect(await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-name")))).toEqual([
    "docs",
    "src",
    "readme.md",
    "zed.txt",
  ]);

  const current = () =>
    tree.evaluate(
      (el) => document.getElementById(el.getAttribute("aria-activedescendant") ?? "")?.dataset.name
    );
  await tree.focus();
  await page.keyboard.press("ArrowDown");
  expect(await current()).toBe("docs");
  // Right opens the folder, then goes into it.
  await page.keyboard.press("ArrowRight");
  await expect(items).toHaveCount(6);
  await expect(page.getByRole("treeitem", { name: /^docs/ })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await page.keyboard.press("ArrowRight");
  expect(await current()).toBe("deep");
  await page.keyboard.press("ArrowRight");
  await expect(items).toHaveCount(7);
  await page.keyboard.press("ArrowDown");
  expect(await current()).toBe("d.txt");
  // Left goes to the parent, then closes it.
  await page.keyboard.press("ArrowLeft");
  expect(await current()).toBe("deep");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("treeitem", { name: /^deep/ })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await page.keyboard.press("ArrowLeft");
  expect(await current()).toBe("docs");
  await page.keyboard.press("ArrowLeft");
  await expect(items).toHaveCount(4);
  await page.keyboard.press("End");
  expect(await current()).toBe("zed.txt");
  await page.keyboard.press("Home");
  expect(await current()).toBe("docs");
  // Type-ahead, then Enter opens the file the way the folder view does.
  await page.keyboard.type("re");
  expect(await current()).toBe("readme.md");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await invokeCalls()).filter((c) => c.cmd === "open_paths").length)
    .toBe(1);
  const open = (await invokeCalls()).find((c) => c.cmd === "open_paths")!;
  expect(open.args).toEqual({
    paths: [{ k: "Utf8", v: "/home/tester/readme.md" }],
    origin: "inside",
    gesture: "default",
  });
});

test("ctrl_b_hides_and_shows_the_left_column_and_the_welcome_pane_fills_the_centre", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({ ...COMMON, "plugin:kernkraft-tauri|list_dir": SMALL_TREE });
  await page.goto("/");
  await expect(page.getByTestId("welcome-pane")).toBeVisible();
  await expect(page.getByTestId("welcome-tip")).toContainText(/Ctrl|Alt|F\d/);
  await expect(page.getByTestId("editor-left")).toBeVisible();
  await page.keyboard.press("Control+b");
  await expect(page.getByTestId("editor-left")).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await expect(page.getByTestId("editor-left")).toBeVisible();
  // The column's width is the stored one.
  const box = await page.getByTestId("editor-left").boundingBox();
  expect(Math.round(box!.width)).toBe(300);
});

test("tree_scrolls_100k_rows", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft-tauri|list_dir": () =>
      Array.from({ length: 100_000 }, (_, i) => ({
        path: { k: "Utf8", v: `/home/tester/file${String(i).padStart(6, "0")}.txt` },
        name: `file${String(i).padStart(6, "0")}.txt`,
        kind: "file",
        target_is_dir: false,
        len: i,
        modified_ms: null,
        hidden: false,
        mime: "text/plain",
        mode: 0o644,
      })),
  });
  await page.goto("/");
  const items = page.getByRole("treeitem");
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeLessThanOrEqual(200);
  await page.getByRole("tree").focus();
  await page.keyboard.press("End");
  await expect(items.last()).toHaveAttribute("data-name", "file099999.txt");
  expect(await items.count()).toBeLessThanOrEqual(200);
});

test("the_panel_buttons_share_the_tab_row_with_settings_and_the_menu", async ({
  page,
  mockTauri,
}) => {
  await mockTauri({
    ...COMMON,
    open_pending_take: [
      {
        event: "kern://open",
        payload: { kind: "doc_tab", path: { k: "Utf8", v: "/home/tester/readme.md" } },
      },
    ],
    "plugin:kernkraft-tauri|list_dir": SMALL_TREE,
    "plugin:kernkraft-tauri|text_open": {
      path: { k: "Utf8", v: "/home/tester/readme.md" },
      text: "one",
      ending: "lf",
      bom: false,
      read_only: null,
      stamp: "s1:3:0:1:1:0",
    },
    "plugin:kernkraft-tauri|text_check": "same",
    doc_opened: null,
    doc_closed: null,
    recent_touch: { entries: [] },
  });
  await page.goto("/");
  await expect(page.getByTestId("editor-left")).toBeVisible();
  await expect(page.getByTestId("tab")).toHaveCount(1);
  const boxes = await Promise.all(
    [
      page.getByTestId("panel-toggle-left"),
      page.getByTestId("panel-toggle-right"),
      page.getByRole("button", { name: "Open Settings" }),
      page.getByRole("button", { name: "Main menu" }),
    ].map(async (b) => (await b.boundingBox())!)
  );
  // One row, one size: the same top, the same width and height as the main menu's button.
  const [first] = boxes;
  for (const b of boxes) {
    expect(Math.abs(b.y - first!.y)).toBeLessThan(0.5);
    expect(Math.abs(b.width - first!.width)).toBeLessThan(0.5);
    expect(Math.abs(b.height - first!.height)).toBeLessThan(0.5);
  }
  // The folder button starts the row, the three-line one stands just before Settings.
  const [left, right, settings] = boxes;
  expect(left!.x).toBeLessThan((await page.getByTestId("tab").first().boundingBox())!.x);
  expect(right!.x).toBeLessThan(settings!.x);
  // Open, Pinned and Recent leave the tab row clear: the same button closes them again.
  const toggle = page.getByTestId("panel-toggle-right");
  await toggle.click();
  await expect(page.getByTestId("side-panel")).toBeVisible();
  const onTop = await toggle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(onTop).toBe(true);
  await toggle.click();
  await expect(page.getByTestId("side-panel")).toHaveCount(0);
});
