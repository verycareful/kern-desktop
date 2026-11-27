// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// Ctrl+S in the Settings window saves the changes, wherever the focus is: on a button, and on the
// page itself, which is where it is when the window has just opened.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { freshAppPerTest, kern, waitForWindows } from "./support/app";
import { testDir } from "./support/world";

describe("settings", function () {
  this.timeout(120_000);
  freshAppPerTest();

  /** The stored value of `field`, read from the settings file. */
  const stored = (field: string): unknown =>
    (
      JSON.parse(
        readFileSync(
          path.join(process.env.XDG_CONFIG_HOME as string, "kern", "settings.json"),
          "utf8"
        )
      ) as Record<string, unknown>
    )[field];

  async function openSettings(): Promise<void> {
    const dir = testDir("settings-save");
    writeFileSync(path.join(dir, "a.txt"), "x\n");
    kern([dir]);
    await waitForWindows((w) => w.some((x) => x.kind === "main" && x.rows.length > 0));
    await browser.keys(["Control", ","]);
    await browser.waitUntil(
      async () => {
        for (const handle of await browser.getWindowHandles()) {
          await browser.switchToWindow(handle);
          if (await browser.$('[data-testid="settings-window"]').isExisting()) return true;
        }
        return false;
      },
      { timeout: 15_000, timeoutMsg: "the Settings window did not open" }
    );
  }

  const status = async () =>
    (await (await browser.$('[data-testid="settings-status"]')).getText()).trim();

  /** Presses Ctrl+S until the status says nothing is waiting to be saved. */
  async function saveByKey(): Promise<void> {
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(async () => (await status()) !== "Changes not saved yet.", {
      timeout: 10_000,
      timeoutMsg: "Ctrl+S did not save the change",
    });
  }

  it("ctrl_s_saves_with_the_focus_on_the_page", async () => {
    await openSettings();
    const focused = await browser.execute("return document.activeElement === document.body");
    if (!focused)
      throw new Error("the Settings window was expected to open with no focused element");
    // A theme is changed by a click, which focuses its button; the focus is then given back to the page.
    const theme = await browser.$('[role="group"][aria-label="Theme"]');
    const dark = await theme.$("button=Dark");
    await dark.click();
    await browser.execute("document.activeElement && document.activeElement.blur();");
    if ((await status()) !== "Changes not saved yet.")
      throw new Error("the change was not offered");
    await saveByKey();
    if (stored("theme_mode") !== "dark") throw new Error(`stored ${String(stored("theme_mode"))}`);
  });
});
