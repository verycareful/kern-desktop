// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// Windows of the real app: a file opened from outside gets a window of its
// own, whose Home button moves the document into the main window as a tab, and
// Ctrl+double-click opens a file in a window of its own where a plain double
// click opens a tab. Each test reads what the windows show.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";
import {
  clickClosingWindow,
  ctrlDoubleClick,
  doubleClick,
  focusWindow,
  freshAppPerTest,
  kern,
  only,
  rowSelector,
  settleAt,
  waitForWindows,
} from "./support/app";
import { testDir } from "./support/world";

describe("windows", () => {
  freshAppPerTest();

  it("outside_file_opens_window_with_home", async () => {
    const dir = testDir("outside-file");
    const file = path.join(dir, "outside.txt");
    writeFileSync(file, "from outside\n");

    const launched = kern([file]);
    expect(launched.status).toBe(0);

    const ws = await waitForWindows(
      (w) => w.length === 2 && w.some((x) => x.kind === "doc" && x.text.includes("from outside")),
      "a document window showing the file"
    );
    const doc = only(ws, "doc");
    expect(doc.docTitle).toBe("outside.txt");
    // Home is how the document goes to the main window.
    expect(doc.home).toBe(true);
    // The main window is still the file manager, with no tab for the document.
    const main = only(ws, "main");
    expect(main.tabs.map((t) => t.title)).not.toContain("outside.txt");
  });

  it("home_moves_into_main", async () => {
    const dir = testDir("home-moves");
    const file = path.join(dir, "homeward.txt");
    writeFileSync(file, "going home\n");
    expect(kern([file]).status).toBe(0);
    const ws = await waitForWindows(
      (w) => w.length === 2 && w.some((x) => x.kind === "doc" && x.home && x.text !== ""),
      "the document window with its Home button"
    );

    await focusWindow(only(ws, "doc").handle);
    await clickClosingWindow('button[aria-label^="Home"]');

    // The document window closes and the main window holds the document in a tab.
    const after = await waitForWindows(
      (w) =>
        w.length === 1 &&
        w.some((x) => x.kind === "main" && x.tabs.some((t) => t.title === "homeward.txt")),
      "the main window with the document as a tab and no document window"
    );
    const main = only(after, "main");
    const tab = main.tabs.find((t) => t.title === "homeward.txt");
    expect(tab?.active).toBe(true);
    expect(main.text).toContain("going home");
  });

  it("ctrl_double_click_opens_window", async () => {
    const dir = testDir("ctrl-double-click");
    writeFileSync(path.join(dir, "gesture.txt"), "new window please\n");
    writeFileSync(path.join(dir, "plain.txt"), "same window\n");
    expect(kern([dir]).status).toBe(0);
    const ws = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === "gesture.txt")),
      "the main window listing the folder"
    );
    await focusWindow(only(ws, "main").handle);

    await ctrlDoubleClick(rowSelector("gesture.txt"));

    // Ctrl+double-click: a window of its own, and the main window gains no tab.
    const after = await waitForWindows(
      (w) => w.length === 2 && w.some((x) => x.kind === "doc" && x.text.includes("new window")),
      "a document window for the Ctrl+double-clicked file"
    );
    expect(only(after, "doc").docTitle).toBe("gesture.txt");
    expect(only(after, "main").tabs.map((t) => t.title)).not.toContain("gesture.txt");
    // Without Ctrl the same gesture opens a tab of the main window, and no window.
    await focusWindow(only(after, "main").handle);
    await doubleClick(rowSelector("plain.txt"));
    const last = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.tabs.some((t) => t.title === "plain.txt")),
      "a tab for the plainly double-clicked file"
    );
    expect(last.length).toBe(2);
    await settleAt(2);
  });
});
