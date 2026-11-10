// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// A file renamed inside Kern while it is open with unsaved text: its tab follows
// the file, keeps the text, shows no deleted banner, and saves to the new name,
// leaving no second file at the old one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";
import {
  SHOWS_WITHIN_MS,
  activateTab,
  doubleClick,
  focusWindow,
  freshAppPerTest,
  kern,
  only,
  rowSelector,
  waitForWindows,
} from "./support/app";
import { testDir } from "./support/world";

describe("rename", () => {
  freshAppPerTest();

  it("a_renamed_open_file_keeps_its_tab_its_text_and_saves_at_the_new_name", async () => {
    const dir = testDir("rename-open");
    const oldFile = path.join(dir, "old.txt");
    const newFile = path.join(dir, "new.txt");
    writeFileSync(oldFile, "kept\n");
    expect(kern([dir]).status).toBe(0);
    const listed = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === "old.txt")),
      "the main window listing the folder"
    );
    await focusWindow(only(listed, "main").handle);
    // The folder opened from the command line is a tab named for it, beside the Home tab.
    const folderTab = path.basename(dir);

    // Open the file in a tab and type into it, so it holds text that is not on the disk.
    await doubleClick(rowSelector("old.txt"));
    await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.text.includes("kept")),
      "the file open in a tab"
    );
    const editor = await browser.$('[data-testid="editor-host"] .cm-content');
    await editor.click();
    await browser.keys(["Control", "End"]);
    await browser.keys("typed");
    await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.text.includes("typed")),
      "the typed text in the editor"
    );

    // Rename it from the folder's own tab.
    await activateTab(folderTab);
    await waitForWindows(
      (w) =>
        w.some(
          (x) =>
            x.kind === "main" &&
            x.tabs.some((t) => t.active && t.title === folderTab) &&
            x.rows.some((r) => r.name === "old.txt")
        ),
      "the folder tab on show with the file in its listing"
    );
    const row = await browser.$(rowSelector("old.txt"));
    await row.waitForClickable({ timeout: SHOWS_WITHIN_MS });
    await row.click();
    await browser.keys("F2");
    const input = await browser.$('input[aria-label="Rename old.txt"]');
    await input.waitForDisplayed({ timeout: SHOWS_WITHIN_MS });
    // F2 selects the name without its extension: typing replaces it, as a user would.
    await browser.keys("new");
    await browser.keys("Enter");

    const after = await waitForWindows(
      (w) =>
        w.some(
          (x) =>
            x.kind === "main" &&
            x.tabs.some((t) => t.title === "new.txt") &&
            !x.tabs.some((t) => t.title === "old.txt")
        ),
      "the tab to take the new name"
    );
    expect(only(after, "main").tabs.map((t) => t.title)).toContain("new.txt");

    // The tab holds the text typed before the rename, and says nothing about a deleted file.
    await activateTab("new.txt");
    const now = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.text.includes("typed")),
      "the renamed tab with its unsaved text"
    );
    expect(only(now, "main").text).toContain("kept");
    expect(await browser.$$('[data-testid="deleted-banner"]')).toHaveLength(0);

    // Saved with Ctrl+S, it is written at the new name, and the old name is not made again.
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(() => readFileSync(newFile, "utf8").includes("typed"), {
      timeout: SHOWS_WITHIN_MS,
      timeoutMsg: "the typed text was not saved at the new name",
    });
    expect(existsSync(oldFile)).toBe(false);
  });
});
