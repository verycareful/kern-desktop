// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { test, expect, EMPTY_PINNED_RECENT } from "./support/mockInvoke";

// The mocks are serialised into the page, so each is self-contained.
const COMMON = {
  open_pending_take: [],
  layout_get: {
    layout: "editor",
    left_width: 300,
    left_open: true,
    tree_root: { k: "Utf8", v: "/home/tester" },
  },
  layout_set: { layout: "editor", left_width: 300, left_open: true, tree_root: null },
  settings_get: {
    follow: { colours: true, accent: true, fonts: true, radius: true },
    theme_mode: "system",
    accent: "slate",
    density: "cozy",
    show_hidden: false,
    view_mode: "list",
    default_layout: "file_manager",
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
