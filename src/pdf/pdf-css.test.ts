// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

// jsdom does not apply the stylesheet, so the rules are read from its text.
const css = readFileSync(resolve(process.cwd(), "src/pdf/pdf.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/** The declarations of every rule whose selector list has a selector containing `part`. */
function rulesTouching(part: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(",").some((s) => s.includes(part))) out.push(m[2]!);
  }
  return out;
}

test("every_panel_header_is_one_36px_row_with_a_12px_start_edge", () => {
  const header = rulesTouching(".kern-pdf-panel-header");
  const base = css.match(/^\.kern-pdf-panel-header\s*\{([^}]*)\}/m)?.[1] ?? "";
  expect(base).toMatch(/height:\s*36px/);
  expect(base).toMatch(/padding:\s*0 \d+px 0 12px/);
  expect(base).toMatch(/align-items:\s*center/);
  // No variant of the header changes its height, so no panel's header differs from another's.
  const variants = header.filter((rule) => rule !== base.replace(/^\n|\n$/g, "") && rule !== base);
  expect(variants.length).toBeGreaterThan(0);
  for (const rule of variants) expect(rule).not.toMatch(/(^|[;\s])(min-|max-)?height:/);
});

test("the_group_captions_and_the_rows_start_12px_from_the_edge_like_the_header", () => {
  const caption = css.match(/\.kern-pdf-tool-group-title\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(caption).toMatch(/margin:\s*0 0 2px 12px/);
  const row = css.match(/\.kern-pdf-tool\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(row).toMatch(/padding:\s*4px 12px/);
});

test("the_swatches_take_no_colour_from_the_theme", () => {
  for (const rule of rulesTouching(".kern-pdf-swatch")) {
    expect(rule).not.toMatch(/background[^;]*var\(--kern/);
  }
});

test("a_side_panel_is_176px_and_48px_folded_and_a_rail_options_column_is_52px", () => {
  expect(css).toMatch(/\.kern-pdf-dock-column \.kern-pdf-panel\s*\{[^}]*width:\s*176px/);
  expect(css).toMatch(
    /\.kern-pdf-dock-column \.kern-pdf-panel\[data-collapsed="true"\]\s*\{[^}]*width:\s*48px/
  );
  expect(css).toMatch(/\.kern-pdf-options-column\s*\{[^}]*width:\s*52px/);
});

test("an_icon_button_is_34px", () => {
  const icon = css.match(/\.kern-pdf-tool\[data-collapsed="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(icon).toMatch(/width:\s*34px/);
  expect(icon).toMatch(/height:\s*34px/);
});
