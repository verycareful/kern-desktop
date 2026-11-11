// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// The document window of the real app, which has a capability of its own: a file opened from
// outside is shown, edited and saved there, and its Home button then gives the document, with
// the text saved, to the main window. A command the capability does not grant is refused by
// Tauri, so a missing grant shows here as a window that cannot do what it is for.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";
import {
  SHOWS_WITHIN_MS,
  clickClosingWindow,
  focusWindow,
  freshAppPerTest,
  kern,
  only,
  waitForWindows,
} from "./support/app";
import { testDir } from "./support/world";

describe("document window", () => {
  freshAppPerTest();

  it("edits_and_saves_its_file_and_then_goes_home_with_it", async () => {
    const dir = testDir("document-window");
    const file = path.join(dir, "doc.txt");
    writeFileSync(file, "first\n");
    expect(kern([file]).status).toBe(0);
    const ws = await waitForWindows(
      (w) => w.length === 2 && w.some((x) => x.kind === "doc" && x.text.includes("first")),
      "a document window showing the file"
    );
    await focusWindow(only(ws, "doc").handle);

    // Typed at the end and saved with Ctrl+S: the text reaches the file.
    const editor = await browser.$('[data-testid="editor-host"] .cm-content');
    await editor.click();
    await browser.keys(["Control", "End"]);
    await browser.keys("second");
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(() => readFileSync(file, "utf8").includes("second"), {
      timeout: SHOWS_WITHIN_MS,
      timeoutMsg: "the typed text was not saved by the document window",
    });

    // Home hands the saved document to the main window and closes this one.
    await clickClosingWindow('button[aria-label^="Home"]');
    const after = await waitForWindows(
      (w) =>
        w.length === 1 &&
        w.some((x) => x.kind === "main" && x.tabs.some((t) => t.title === "doc.txt")),
      "the main window holding the document as a tab"
    );
    expect(only(after, "main").text).toContain("second");
  });
});
