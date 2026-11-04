// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
//
// A folder on show follows the file system: a file another program creates
// appears in the listing without any action by the user (the app watches the
// folder with inotify(7)).

import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "@wdio/globals";
import { freshAppPerTest, kern, only, waitForWindows } from "./support/app";
import { testDir } from "./support/world";

describe("watch", () => {
  freshAppPerTest();

  it("inotify_refresh_on_external_create", async () => {
    const dir = testDir("watched");
    writeFileSync(path.join(dir, "before.txt"), "already there\n");
    expect(kern([dir]).status).toBe(0);
    const listed = await waitForWindows(
      (w) => w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === "before.txt")),
      "the folder listing"
    );
    expect(only(listed, "main").rows.map((r) => r.name)).toEqual(["before.txt"]);

    // Made by this process, not by the app, while the folder is on show.
    writeFileSync(path.join(dir, "created-outside.txt"), "new\n");

    const after = await waitForWindows(
      (w) =>
        w.some((x) => x.kind === "main" && x.rows.some((r) => r.name === "created-outside.txt")),
      "the new file to appear in the listing"
    );
    expect(
      only(after, "main")
        .rows.map((r) => r.name)
        .sort()
    ).toEqual(["before.txt", "created-outside.txt"]);
  });
});
