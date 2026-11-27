// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// The header of the folder list sits flush under the bar above it at every interface size. The
// window is zoomed by a fraction at 80, 90, 110 and 125 %, so the top of the list lands between
// two device pixels there; the row of pixels the list's clip starts in must show the bar's line and
// the header, never a row of the list scrolling under it.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { freshAppPerTest, kern, rowSelector, waitForWindows } from "./support/app";
import { decodePng } from "./support/png";
import { testDir } from "./support/world";

/** Rows in the folder: far more than the window shows, so rows scroll under the header. */
const FILES = 120;
/** Scroll positions tried: a row is 40 px high, so these cross every offset of it a pixel apart. */
const SCROLLS = [400, 403, 407, 411, 414, 418, 422, 425, 429, 433, 436];
const SIZES = [80, 90, 100, 110, 125];

describe("folder header", function () {
  // Each size starts the app again.
  this.timeout(120_000);
  freshAppPerTest();

  for (const size of SIZES) {
    it(`the_header_sits_flush_at_${size}_percent`, async () => {
      const config = path.join(process.env.XDG_CONFIG_HOME as string, "kern");
      mkdirSync(config, { recursive: true });
      writeFileSync(path.join(config, "settings.json"), JSON.stringify({ interface_size: size }));
      await browser.reloadSession();
      await waitForWindows((ws) => ws.some((w) => w.kind === "main" && w.ready));

      const dir = testDir(`folder-header-${size}`);
      for (let i = 0; i < FILES; i++) {
        writeFileSync(path.join(dir, `file-${String(i).padStart(3, "0")}.txt`), "x\n");
      }
      kern([dir]);
      await waitForWindows(
        (w) => w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === "file-005.txt")),
        "the folder listing"
      );
      // Every row selected, so that a row shows by its colour as well as by its text.
      await (await browser.$(rowSelector("file-005.txt"))).click();
      await browser.keys(["Control", "a"]);

      for (const scrollTop of SCROLLS) {
        const where = (await browser.execute(`
          const scroller = document.querySelector('[data-testid="folder-scroll"]');
          scroller.scrollTop = ${scrollTop};
          const box = scroller.getBoundingClientRect();
          return { top: box.top, left: box.left, right: box.right, ratio: devicePixelRatio };
        `)) as { top: number; left: number; right: number; ratio: number };
        await browser.pause(150);
        const shot = decodePng(Buffer.from(await browser.takeScreenshot(), "base64"));
        // The row of device pixels the scroller's clip starts in is the one that holds its top edge.
        const y = Math.floor(where.top * where.ratio);
        const from = Math.ceil(where.left * where.ratio) + 8;
        const to = Math.floor(where.right * where.ratio) - 8;
        const foreign: string[] = [];
        for (let x = from; x < to; x++) {
          const here = shot.at(x, y);
          // What the bar above shows there, or what the header shows there, or the line between.
          const known = [shot.at(x, y - 3), shot.at(x, y + 3), shot.at(from, y)];
          if (!known.includes(here)) foreign.push(`${x}:${here}`);
        }
        if (foreign.length > 0) {
          throw new Error(
            `at ${size} % (scroll ${scrollTop}, top ${where.top} css px, device row ${y}) ${foreign.length} pixels of the row are neither the bar's nor the header's: ${foreign.slice(0, 5).join(" ")}`
          );
        }
      }
    });
  }
});
