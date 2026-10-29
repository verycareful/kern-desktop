// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// jsdom does not apply the stylesheet, so the rule is read from its text.
const css = readFileSync(resolve(process.cwd(), "src/keys/action-menu.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

test("a_menu_taller_than_the_window_scrolls_instead_of_running_off_it", () => {
  const rule = /\.kern-menu\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toMatch(/max-height:\s*100vh/);
  expect(rule).toMatch(/overflow-y:\s*auto/);
});
