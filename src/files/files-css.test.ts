// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// jsdom does not apply the stylesheet, so the rules are read from its text.
const css = readFileSync(resolve(process.cwd(), "src/files/files.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);
const base = readFileSync(resolve(process.cwd(), "src/theme/base.css"), "utf8");

/** The declarations of every rule whose selector list contains `selector`. */
function rulesFor(source: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}

test("the_list_and_grid_containers_draw_no_focus_outline", () => {
  // base.css gives every :focus-visible element a frame; the containers opt out.
  expect(rulesFor(base, ":focus-visible").join()).toMatch(/outline:\s*2px/);
  for (const sel of [".kern-list:focus-visible", ".kern-grid:focus-visible"]) {
    const rules = rulesFor(css, sel);
    expect(rules.length, sel).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r, sel).toMatch(/outline:\s*none/);
      expect(r, sel).not.toMatch(/outline:\s*\d/);
    }
  }
});

test("the_cursor_outline_is_not_in_the_stylesheet_unconditionally", () => {
  // The class is only put on the current item while the view has the keyboard,
  // so its rule is the outline itself.
  expect(rulesFor(css, ".kern-cursor").join()).toMatch(/outline:\s*2px solid var\(--kern-accent\)/);
});

test("the_first_row_and_the_cards_are_spaced_from_the_path_bar_by_the_gap_token", () => {
  // --kern-density-gap is the theme's gap for the density in use (base.css).
  for (const sel of [".kern-list", ".kern-grid"]) {
    expect(rulesFor(css, sel).join(), sel).toMatch(/padding-top:\s*var\(--kern-density-gap\)/);
  }
});
