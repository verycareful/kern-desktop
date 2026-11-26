// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it } from "vitest";
import type { PdfPageText, PdfTextLine, Rect } from "../ipc/pdf";
import { pageText } from "./text-lines";

const wire = (lines: PdfTextLine[]): PdfPageText => ({
  revision: 4,
  lines,
  blocks: [],
  tagged: false,
});
const glyph = (i: number): Rect => [0.1 + i * 0.01, 0.1, 0.11 + i * 0.01, 0.12];
const line = (text: string, glyphs = Array.from(text).map((_, i) => glyph(i))): PdfTextLine => ({
  block: 0,
  text,
  wrapped: false,
  rect: [0.1, 0.1, 0.1 + glyphs.length * 0.01, 0.12],
  glyphs,
});

describe("pageText", () => {
  it("a_blank_line_is_dropped", () => {
    const text = pageText(wire([line("one"), line("   "), line(""), line("two")]));
    expect(text.lines.map((l) => l.text)).toEqual(["one", "two"]);
    expect(text.revision).toBe(4);
  });

  it("a_page_with_no_text_gives_an_empty_layer", () => {
    expect(pageText(wire([])).lines).toEqual([]);
    expect(pageText(wire([line("  ")])).lines).toEqual([]);
  });

  it("a_line_is_cut_into_one_unit_per_character_with_its_glyph", () => {
    const [only] = pageText(wire([line("abc")])).lines;
    expect(only?.whole).toBe(false);
    expect(only?.units.map((u) => u.text)).toEqual(["a", "b", "c"]);
    expect(only?.units[1]?.rect).toEqual(glyph(1));
  });

  it("a_character_outside_the_basic_plane_is_one_unit", () => {
    const [only] = pageText(wire([line("a\u{1F600}b")])).lines;
    expect(only?.units.map((u) => u.text)).toEqual(["a", "\u{1F600}", "b"]);
  });

  it("a_line_whose_glyphs_do_not_match_its_characters_is_one_unit_with_the_line_rectangle", () => {
    // "fi" drawn as one ligature glyph: three characters, two glyphs.
    const ligature = line("fie", [glyph(0), glyph(1)]);
    const [only] = pageText(wire([ligature])).lines;
    expect(only?.whole).toBe(true);
    expect(only?.units).toEqual([{ text: "fie", rect: ligature.rect }]);
  });
});
