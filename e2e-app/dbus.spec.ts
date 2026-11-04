// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// Kern on the session bus: a second launch forwards its arguments to the
// running instance (plan Task 16, "Single instance"), a file already open is
// focused and never opened twice (design D4.5), and org.freedesktop.FileManager1
// shows items in a folder (plan Task 17; freedesktop.org FileManager1 wiki,
// "ShowItems"). The bus is the run's own (support/world.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import {
  activateTab,
  doubleClick,
  fileManager1,
  fileUri,
  focusWindow,
  freshAppPerTest,
  kern,
  only,
  rowSelector,
  settleAt,
  waitForWindows,
} from "./support/app";
import { testDir } from "./support/world";

describe("dbus", () => {
  freshAppPerTest();

  it("second_launch_forwards_paths", async () => {
    const dir = testDir("forwarded");
    const sub = path.join(dir, "sub");
    mkdirSync(sub);
    writeFileSync(path.join(dir, "first.txt"), "first\n");
    writeFileSync(path.join(sub, "second.txt"), "second\n");

    // An absolute path and a relative one, the relative one against the
    // directory the second launch was started in, not the running app's.
    const launched = kern([path.join(dir, "first.txt"), path.join("sub", "second.txt")], dir);
    // It forwarded and exited: the windows below belong to the first process,
    // the one the driver started.
    expect(launched.status).toBe(0);

    const ws = await waitForWindows(
      (w) =>
        w.filter((x) => x.kind === "doc").length === 2 &&
        w.every((x) => x.kind !== "doc" || x.text !== ""),
      "two document windows"
    );
    const titles = ws
      .filter((w) => w.kind === "doc")
      .map((w) => w.docTitle)
      .sort();
    expect(titles).toEqual(["first.txt", "second.txt"]);
    const texts = ws
      .filter((w) => w.kind === "doc")
      .map((w) => w.text.trim())
      .sort();
    expect(texts).toEqual(["first", "second"]);

    // A folder goes to the main window as a tab.
    expect(kern([sub]).status).toBe(0);
    const after = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.tabs.some((t) => t.title === "sub")),
      "a folder tab for the forwarded folder"
    );
    expect(after.length).toBe(3);
  });

  it("already_open_focuses", async () => {
    const dir = testDir("already-open");
    const file = path.join(dir, "once.txt");
    const other = path.join(dir, "other.txt");
    writeFileSync(file, "only once\n");
    writeFileSync(other, "other\n");

    // Open in a window of its own; a second launch for the same file opens
    // nothing more.
    expect(kern([file]).status).toBe(0);
    await waitForWindows((w) => w.length === 2 && w.some((x) => x.text !== ""), "its window");
    expect(kern([file]).status).toBe(0);
    await settleAt(2);

    // Open as a tab of the main window; a launch for the file brings that tab
    // forward instead of opening a window or a second tab.
    expect(kern([dir]).status).toBe(0);
    const listed = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === "other.txt")),
      "the folder listing"
    );
    await focusWindow(only(listed, "main").handle);
    await doubleClick(rowSelector("other.txt"));
    await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.tabs.some((t) => t.title === "other.txt")),
      "a tab for the file"
    );
    // Another tab is active, so that bringing the file's tab forward is visible.
    await activateTab("already-open");
    const away = await waitForWindows(
      (w) =>
        w.some((x) => x.kind === "main" && !x.tabs.find((t) => t.title === "other.txt")?.active),
      "another tab active"
    );
    expect(away.length).toBe(2);

    expect(kern([other]).status).toBe(0);
    const back = await waitForWindows(
      (w) =>
        w.some((x) => x.kind === "main" && x.tabs.find((t) => t.title === "other.txt")?.active),
      "the file's tab brought forward"
    );
    expect(back.length).toBe(2);
    expect(only(back, "main").tabs.filter((t) => t.title === "other.txt").length).toBe(1);
    await settleAt(2);
  });

  it("filemanager1_show_items_selects", async () => {
    const dir = testDir("show-items");
    // A name with a space and a percent sign, so the URI must be decoded.
    const wanted = "report 100%.txt";
    for (const name of ["alpha.txt", wanted, "omega.txt"]) {
      writeFileSync(path.join(dir, name), `${name}\n`);
    }

    // The service is served once the app is up; the first call may precede it.
    let reply = fileManager1("ShowItems", [fileUri(path.join(dir, wanted))]);
    for (let i = 0; i < 20 && reply.status !== 0; i++) {
      await browser.pause(250);
      reply = fileManager1("ShowItems", [fileUri(path.join(dir, wanted))]);
    }
    expect(reply.status).toBe(0);

    // The parent folder is on show with the item, and only the item, selected.
    const ws = await waitForWindows(
      (w) =>
        w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === wanted && r.selected)),
      "the folder with the item selected"
    );
    const rows = only(ws, "main").rows;
    expect(rows.map((r) => r.name).sort()).toEqual(["alpha.txt", "omega.txt", wanted].sort());
    expect(rows.filter((r) => r.selected).map((r) => r.name)).toEqual([wanted]);
    expect(only(ws, "main").tabs.find((t) => t.active)?.title).toBe("show-items");
  });
});
