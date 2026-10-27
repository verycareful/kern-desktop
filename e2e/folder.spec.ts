// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Page } from "@playwright/test";
import { test, expect } from "./support/mockInvoke";

// The mocks are serialised into the page, so each is self-contained.
const SETTINGS = {
  follow: { colours: true, accent: true, fonts: true, radius: true },
  theme_mode: "system",
  accent: "slate",
  density: "cozy",
  show_hidden: false,
  view_mode: "list",
};
const COMMON = {
  settings_get: SETTINGS,
  settings_set: (args: Record<string, unknown>) => ({
    follow: { colours: true, accent: true, fonts: true, radius: true },
    theme_mode: "system",
    accent: "slate",
    density: "cozy",
    show_hidden: false,
    view_mode: "list",
    ...(args.patch as object),
  }),
  "plugin:kernkraft|user_dirs": { home: { k: "Utf8", v: "/home/tester/docs" }, dirs: [] },
  "plugin:kernkraft|theme_get": { css: ":root{}", tokens: {}, fallbacks: [], problems: [] },
  "plugin:kernkraft|watch_dir": null,
  "plugin:kernkraft|unwatch_dir": null,
};

const rows = (page: Page) => page.getByTestId("file-row");

test("navigates_breadcrumb_and_back", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft|list_dir": (args: Record<string, unknown>) => {
      const file = (dir: string, name: string) => ({
        path: { k: "Utf8", v: `${dir}/${name}` },
        name,
        kind: "file",
        target_is_dir: false,
        len: 1500,
        modified_ms: null,
        hidden: false,
        mime: "application/pdf",
      });
      const path = (args.path as { v: string }).v;
      if (path === "/home/tester/docs") {
        return [
          {
            path: { k: "Utf8", v: "/home/tester/docs/reports" },
            name: "reports",
            kind: "dir",
            target_is_dir: true,
            len: 0,
            modified_ms: null,
            hidden: false,
            mime: "inode/directory",
          },
          file(path, "a.pdf"),
        ];
      }
      if (path === "/home/tester/docs/reports") return [file(path, "r.pdf")];
      return [];
    },
  });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId("status-count")).toHaveText("2 items");

  await rows(page).filter({ hasText: "reports" }).dblclick();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-name", "r.pdf");
  const crumbs = page.getByRole("navigation", { name: "Path" });
  await expect(crumbs.getByRole("button", { name: "reports" })).toHaveAttribute(
    "aria-current",
    "location"
  );

  // A breadcrumb segment goes up; Back returns to where we were.
  await crumbs.getByRole("button", { name: "tester" }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId("folder-empty")).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(rows(page).first()).toHaveAttribute("data-name", "r.pdf");
});

test("scrolls_100k_rows", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft|list_dir": () =>
      Array.from({ length: 100_000 }, (_, i) => ({
        path: { k: "Utf8", v: `/home/tester/docs/file${i}.txt` },
        name: `file${i}.txt`,
        kind: "file",
        target_is_dir: false,
        len: i,
        modified_ms: null,
        hidden: false,
        mime: "text/plain",
      })),
  });
  await page.goto("/");
  await expect(page.getByTestId("status-count")).toHaveText("100,000 items");
  const drawn = await rows(page).count();
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThanOrEqual(200);

  // Natural order puts file99999 last: scroll to the bottom and it is drawn,
  // still with at most 200 rows in the DOM.
  await page.getByTestId("folder-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(rows(page).last()).toHaveAttribute("data-name", "file99999.txt");
  expect(await rows(page).count()).toBeLessThanOrEqual(200);
});

test("hidden_toggle_ctrl_h", async ({ page, mockTauri }) => {
  await mockTauri({
    ...COMMON,
    "plugin:kernkraft|list_dir": (args: Record<string, unknown>) => {
      const e = (name: string) => ({
        path: { k: "Utf8", v: `/home/tester/docs/${name}` },
        name,
        kind: "file",
        target_is_dir: false,
        len: 1,
        modified_ms: null,
        hidden: name.startsWith("."),
        mime: "text/plain",
      });
      return args.hidden ? [e(".secret"), e("a.txt")] : [e("a.txt")];
    },
  });
  await page.goto("/");
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("Control+h");
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute("data-name", ".secret");
  await page.keyboard.press("Control+h");
  await expect(rows(page)).toHaveCount(1);
});

test.describe("non-ASCII names", () => {
  test.use({ locale: "en-US" });

  // The names the mock below makes, rebuilt here to know the right order.
  const PREFIXES = ["é", "e", "z", "ä", "a", "日", "ß"];
  const nameAt = (i: number) => `${PREFIXES[i % 7]}file${(i * 7919) % 100000}-${i}.txt`;

  test("sorts_100k_non_ascii_names_without_holding_up_a_frame", async ({ page, mockTauri }) => {
    await mockTauri({
      ...COMMON,
      "plugin:kernkraft|list_dir": () => {
        const prefixes = ["é", "e", "z", "ä", "a", "日", "ß"];
        return Array.from({ length: 100_000 }, (_, i) => {
          const name = `${prefixes[i % 7]}file${(i * 7919) % 100000}-${i}.txt`;
          return {
            path: { k: "Utf8", v: `/home/tester/docs/${name}` },
            name,
            kind: "file",
            target_is_dir: false,
            len: i,
            modified_ms: null,
            hidden: false,
            mime: "text/plain",
          };
        });
      },
    });
    // What the page's collator orders: the smallest and the largest name.
    const collator = new Intl.Collator("en-US", { numeric: true });
    let min = nameAt(0);
    let max = nameAt(0);
    for (let i = 1; i < 100_000; i++) {
      const n = nameAt(i);
      if (collator.compare(n, min) < 0) min = n;
      if (collator.compare(n, max) > 0) max = n;
    }

    await page.goto("/");
    await expect(page.getByTestId("status-count")).toHaveText("100,000 items");
    await expect(rows(page).first()).toHaveAttribute("data-name", min);

    // Watch the frames while the list is sorted the other way round: a
    // requestAnimationFrame callback that comes late means the page was busy.
    await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __run: boolean };
      w.__gaps = [];
      w.__run = true;
      let last = performance.now();
      const tick = (now: number) => {
        w.__gaps.push(now - last);
        last = now;
        if (w.__run) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.getByRole("columnheader", { name: "Name" }).getByRole("button").click();
    await expect(rows(page).first()).toHaveAttribute("data-name", max);
    const gaps = await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __run: boolean };
      w.__run = false;
      return w.__gaps;
    });
    expect(gaps.length).toBeGreaterThan(0);
    const worst = Math.max(...gaps);
    test.info().annotations.push({ type: "longest frame gap (ms)", description: String(worst) });
    expect(worst).toBeLessThan(200);

    // And the other end of the list is the smallest name.
    await page.getByTestId("folder-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(rows(page).last()).toHaveAttribute("data-name", min);
  });
});
