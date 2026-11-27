// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// The panels of a PDF in the real app: the tools as a bar, a rail or rows with names, wherever the
// settings put them, and the pages keeping their room.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SHOWS_WITHIN_MS, freshAppPerTest, waitForWindows } from "./support/app";
import { textPagePdf } from "./support/pdf";
import { openPdf } from "./support/pdf-window";
import { testDir } from "./support/world";

describe("pdf panels", function () {
  // Each placement starts the app again, and the first PDF an app opens indexes the fonts.
  this.timeout(240_000);
  freshAppPerTest();

  // Where the panels stand comes from the settings file, so each placement is written there and
  // the app is started again. (A document window cannot change the file itself.)
  const side = (thumbnails: string, tools: string, folded = false) => ({
    thumbnails: { side: thumbnails, collapsed: false },
    tools: { side: tools, collapsed: folded },
  });
  const PLACEMENTS: readonly {
    name: string;
    panels: object | null;
    form: string | null;
    pen: boolean;
    options: string | null;
  }[] = [
    { name: "tools_on_top_by_default", panels: null, form: "bar", pen: true, options: "row" },
    {
      name: "tools_on_the_bottom",
      panels: side("left", "bottom"),
      form: "bar",
      pen: true,
      options: "row",
    },
    {
      name: "tools_named_on_the_left",
      panels: side("right", "left"),
      form: "named",
      pen: true,
      options: "inline",
    },
    {
      name: "tools_rail_on_the_right",
      panels: side("left", "right", true),
      form: "rail",
      pen: true,
      options: "column",
    },
    {
      name: "tools_folded_on_the_top",
      panels: side("left", "top", true),
      form: null,
      pen: false,
      options: null,
    },
  ];
  for (const placement of PLACEMENTS) {
    it(`panels_${placement.name}_and_the_pages_keep_their_room`, async () => {
      const config = path.join(process.env.XDG_CONFIG_HOME as string, "kern");
      mkdirSync(config, { recursive: true });
      writeFileSync(
        path.join(config, "settings.json"),
        JSON.stringify(placement.panels === null ? {} : { pdf_panels: placement.panels })
      );
      await browser.reloadSession();
      await waitForWindows((ws) => ws.some((w) => w.kind === "main" && w.ready));
      const file = path.join(testDir(`pdf-panels-${placement.name}`), "words.pdf");
      writeFileSync(file, textPagePdf());
      await openPdf(file);

      type Box = { left: number; top: number; right: number; bottom: number } | null;
      const measure = async () =>
        (await browser.execute(`
          const box = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          };
          const panel = document.querySelector('[data-testid="pdf-panel-tools"]');
          return {
            window: { width: innerWidth, height: innerHeight },
            panel: box(panel),
            header: box(panel && panel.querySelector("header")),
            tools: panel && panel.querySelector('[data-testid="pdf-tools"]')
              ? panel.querySelector('[data-testid="pdf-tools"]').getAttribute("data-form")
              : null,
            pages: box(document.querySelector('[data-testid="pdf-scroll"]')),
            options: box(document.querySelector('[data-testid="pdf-tool-options"]')),
            optionsClass: document.querySelector('[data-testid="pdf-tool-options"]')
              ? document.querySelector('[data-testid="pdf-tool-options"]').className
              : null,
          };
        `)) as {
          window: { width: number; height: number };
          panel: Box;
          header: Box;
          tools: string | null;
          pages: Box;
          options: Box;
          optionsClass: string | null;
        };
      const inside = (b: Box, w: { width: number; height: number }) =>
        b !== null &&
        b.left >= -1 &&
        b.top >= -1 &&
        b.right <= w.width + 1 &&
        b.bottom <= w.height + 1;

      let seen = await measure();
      expect(seen.tools).toBe(placement.form);
      expect(inside(seen.panel, seen.window)).toBe(true);
      expect((seen.header?.bottom ?? 0) - (seen.header?.top ?? 0)).toBeCloseTo(36, 0);
      expect((seen.pages?.right ?? 0) - (seen.pages?.left ?? 0)).toBeGreaterThan(300);
      expect((seen.pages?.bottom ?? 0) - (seen.pages?.top ?? 0)).toBeGreaterThan(250);
      expect(seen.options).toBeNull();

      if (placement.pen) {
        const pen = await browser.$('button[aria-label="Draw with the pen"]');
        await pen.waitForExist({ timeout: SHOWS_WITHIN_MS });
        // The pen comes into hand by its key, as the driver's window may be larger than the screen
        // it is shown on and a pointer press at the bottom of it would land elsewhere. The key does
        // nothing until the viewer has registered with the action, so it is pressed again until the
        // pen is in hand.
        await browser.waitUntil(
          async () => {
            await browser.keys(["Control", "Alt", "i"]);
            return (await pen.getAttribute("aria-pressed")) === "true";
          },
          { timeout: SHOWS_WITHIN_MS, interval: 500, timeoutMsg: "the pen did not come into hand" }
        );
        const options = await browser.$('[data-testid="pdf-tool-options"]');
        await options.waitForDisplayed({ timeout: SHOWS_WITHIN_MS });
        seen = await measure();
        expect(seen.optionsClass).toContain(`kern-pdf-options-${placement.options}`);
        expect(inside(seen.options, seen.window)).toBe(true);
        // Drawing keeps its room: the pages are as large as ever and the options stay in view.
        expect((seen.pages?.right ?? 0) - (seen.pages?.left ?? 0)).toBeGreaterThan(300);
        expect((seen.pages?.bottom ?? 0) - (seen.pages?.top ?? 0)).toBeGreaterThan(250);
      }
    });
  }

  it("a_panel_is_moved_and_folded_in_the_document_window_and_the_settings_file_keeps_it", async () => {
    // The settings the earlier tests left in this world are cleared, so the panels start as a new
    // settings file has them.
    const config = path.join(process.env.XDG_CONFIG_HOME as string, "kern");
    mkdirSync(config, { recursive: true });
    writeFileSync(path.join(config, "settings.json"), "{}");
    await browser.reloadSession();
    await waitForWindows((ws) => ws.some((w) => w.kind === "main" && w.ready));
    const file = path.join(testDir("pdf-panels-move"), "words.pdf");
    writeFileSync(file, textPagePdf());
    await openPdf(file);
    const stored = () =>
      (
        JSON.parse(
          readFileSync(
            path.join(process.env.XDG_CONFIG_HOME as string, "kern", "settings.json"),
            "utf8"
          )
        ) as { pdf_panels: { tools: { side: string; collapsed: boolean } } }
      ).pdf_panels.tools;
    const tools = await browser.$('[data-testid="pdf-panel-tools"]');
    await tools.waitForExist({ timeout: SHOWS_WITHIN_MS });
    if ((await tools.getAttribute("data-side")) !== "top")
      throw new Error("the tools start on top");

    // The driver's window can be larger than the screen it is shown on, and a pointer press at the
    // far end of the bar would land elsewhere, so each button is pressed through the page.
    const press = (selector: string) =>
      browser.execute(`document.querySelector(${JSON.stringify(selector)}).click();`);

    // Moved by the menu of its header: the panel stands on the left and the file says so.
    await press('button[aria-label="Move Tools"]');
    await (
      await browser.$('//*[@role="menuitem"][contains(., "Move Tools to the left")]')
    ).waitForExist({
      timeout: SHOWS_WITHIN_MS,
    });
    await browser.execute(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent.includes("Move Tools to the left")).click();`
    );
    await browser.waitUntil(
      async () =>
        (await (await browser.$('[data-testid="pdf-panel-tools"]')).getAttribute("data-side")) ===
        "left",
      { timeout: SHOWS_WITHIN_MS, timeoutMsg: "the tools did not move to the left" }
    );
    if (stored().side !== "left") throw new Error(`stored side ${stored().side}`);

    // Folded by the chevron: a rail, and the file says so.
    await press('button[aria-label="Collapse Tools"]');
    await browser.waitUntil(
      async () =>
        (await (
          await browser.$('[data-testid="pdf-panel-tools"]')
        ).getAttribute("data-collapsed")) === "true",
      { timeout: SHOWS_WITHIN_MS, timeoutMsg: "the tools did not fold" }
    );
    if (!stored().collapsed) throw new Error("the folded state was not stored");
  });
});
