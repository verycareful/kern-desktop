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

test("the_cards_are_spaced_from_the_path_bar_by_the_gap_token", () => {
  // --kern-density-gap is the theme's gap for the density in use (base.css).
  expect(rulesFor(css, ".kern-grid").join()).toMatch(/padding-top:\s*var\(--kern-density-gap\)/);
});

test("the_list_header_sits_flush_under_the_bar_with_no_space_above_it", () => {
  // The header is sticky at the top of the scroller; any padding above the scroller would show
  // rows scrolling past in the gap between the bar and the header.
  expect(rulesFor(css, ".kern-list").join()).not.toMatch(/padding/);
  expect(rulesFor(css, ".kern-list-head").join()).toMatch(/position:\s*sticky/);
  expect(rulesFor(css, ".kern-list-head").join()).toMatch(/top:\s*0\b/);
});

test("the_path_bar_paints_over_the_list_so_a_fractional_zoom_cannot_show_rows_in_its_border_row", () => {
  // Above the sticky header (z-index 2), so the pixel row the list's clip is snapped outward into
  // is the bar's own border.
  const bar = rulesFor(css, ".kern-files-bar").join();
  expect(bar).toMatch(/position:\s*relative/);
  const z = Number(bar.match(/z-index:\s*(\d+)/)?.[1]);
  const head = Number(
    rulesFor(css, ".kern-list-head")
      .join()
      .match(/z-index:\s*(\d+)/)?.[1]
  );
  expect(z).toBeGreaterThan(head);
  // A layer of its own, or it is drawn under the scroller's layer whatever its z-index.
  expect(bar).toMatch(/will-change:\s*opacity/);
  expect(bar).toMatch(/border-bottom:\s*1px solid var\(--kern-border\)/);
});

test("the_empty_notes_keep_the_theme_focus_frame_when_they_hold_the_keyboard", () => {
  // An empty folder or Trash note takes focus (tabIndex -1) so the keyboard is never lost
  // to the page; it keeps base.css's :focus-visible frame, drawn inside so the note's
  // overflow does not clip it.
  const rules = rulesFor(css, ".kern-note:focus-visible").join();
  expect(rules).toMatch(/outline-offset:\s*-2px/);
  expect(rules).not.toMatch(/outline:\s*none/);
});
