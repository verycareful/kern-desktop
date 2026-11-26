// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it } from "vitest";
import type { PdfPageText, PdfTextLine, Rect } from "../ipc/pdf";
import {
  charNear,
  hitTest,
  sameChar,
  selectedText,
  selectionRects,
  visualOrder,
  wholePage,
} from "./selection";
import { pageText } from "./text-lines";

const W = 0.02;
const H = 0.02;

// A horizontal line of `text` whose first character is at `x`, glyph `i` at `x + i * W`.
function across(text: string, x: number, y: number): PdfTextLine {
  const glyphs: Rect[] = Array.from(text).map((_, i) => [x + i * W, y, x + (i + 1) * W, y + H]);
  return { block: 0, text, rect: [x, y, x + glyphs.length * W, y + H], glyphs };
}

// A right-to-left line: its text is in logical order and its first character stands at the
// right end, so glyph `i` is `i` places in from `right`.
function leftward(text: string, right: number, y: number): PdfTextLine {
  const glyphs: Rect[] = Array.from(text).map((_, i) => [
    right - (i + 1) * W,
    y,
    right - i * W,
    y + H,
  ]);
  return { block: 0, text, rect: [right - glyphs.length * W, y, right, y + H], glyphs };
}

// A line on a page turned a quarter: the glyphs stand one above the next. `up` reads from the
// bottom, the way a page turned 270 degrees draws its lines.
function down(text: string, x: number, top: number, up = false): PdfTextLine {
  const n = Array.from(text).length;
  const glyphs: Rect[] = Array.from(text).map((_, i) => {
    const place = up ? n - 1 - i : i;
    return [x, top + place * H, x + W, top + (place + 1) * H];
  });
  return { block: 0, text, rect: [x, top, x + W, top + n * H], glyphs };
}

const page = (...lines: PdfTextLine[]) =>
  pageText({ revision: 1, lines, blocks: [], tagged: false } as PdfPageText);

describe("selection", () => {
  it("selecting_across_lines_returns_the_text_in_reading_order", () => {
    const text = page(
      across("first line", 0.1, 0.1),
      across("second", 0.1, 0.2),
      across("third one", 0.1, 0.3)
    );
    // From the "r" of "first" (index 2) to the "r" of "third" (index 2).
    const from = hitTest(text, 0.1 + 2.5 * W, 0.11)!;
    const to = hitTest(text, 0.1 + 2.5 * W, 0.31)!;
    expect(selectedText(text, from, to)).toBe("rst line\nsecond\nthi");
    // The other way round gives the same.
    expect(selectedText(text, to, from)).toBe("rst line\nsecond\nthi");
  });

  it("a_right_to_left_line_selects_by_visual_index", () => {
    // Logical "abcd": "a" at the right end, "d" at the left end.
    const text = page(leftward("abcd", 0.5, 0.1));
    expect(visualOrder(text.lines[0]!)).toEqual([3, 2, 1, 0]);
    // Drag from the left end to the middle: the two glyphs there are "d" and "c".
    const from = hitTest(text, 0.5 - 3.5 * W, 0.11)!;
    const to = hitTest(text, 0.5 - 2.5 * W, 0.11)!;
    expect(from).toEqual({ line: 0, unit: 3 });
    expect(to).toEqual({ line: 0, unit: 2 });
    expect(selectedText(text, from, to)).toBe("cd");
    expect(selectionRects(text, from, to)).toEqual([[0.5 - 4 * W, 0.1, 0.5 - 2 * W, 0.1 + H]]);
  });

  it("a_mixed_line_selects_the_glyphs_that_are_between_the_ends_on_the_page", () => {
    // "ab" then a right-to-left "xyz" that is logical x, y, z but shown z y x: the line is shown
    // a b z y x, with glyph rectangles in that order from the left.
    const glyphs: Rect[] = [];
    const place = (i: number): Rect => [0.1 + i * W, 0.1, 0.1 + (i + 1) * W, 0.1 + H];
    // logical a b x y z -> shown at places 0 1 4 3 2
    for (const shown of [0, 1, 4, 3, 2]) glyphs.push(place(shown));
    const text = page({ block: 0, text: "abxyz", rect: [0.1, 0.1, 0.1 + 5 * W, 0.1 + H], glyphs });
    // From "b" (place 1) to "y" (place 3): places 1 2 3 are b, z, y.
    const from = hitTest(text, 0.1 + 1.5 * W, 0.11)!;
    const to = hitTest(text, 0.1 + 3.5 * W, 0.11)!;
    expect(selectedText(text, from, to)).toBe("byz");
  });

  it("a_sizeless_glyph_is_not_hit", () => {
    const line = across("abc", 0.1, 0.1);
    line.glyphs[1] = [0.12, 0.1, 0.12, 0.1];
    const text = page(line);
    // Wherever the press lands, it is never on the glyph of no size.
    for (const x of [0.119, 0.12, 0.121]) expect(hitTest(text, x, 0.1)?.unit).not.toBe(1);
    // The sizeless character is still in the text.
    expect(selectedText(text, { line: 0, unit: 0 }, { line: 0, unit: 2 })).toBe("abc");
    expect(selectionRects(text, { line: 0, unit: 0 }, { line: 0, unit: 2 })).toEqual([
      [0.1, 0.1, 0.1 + 3 * W, 0.1 + H],
    ]);
  });

  it("rects_of_a_rotated_page_follow_the_glyphs", () => {
    // A page turned 90 degrees reads each line downwards; one turned 270 reads it upwards.
    for (const up of [false, true]) {
      const text = page(down("abcd", 0.4, 0.1, up));
      // The glyphs of "bc" are the two in the middle of the column, whichever way it reads.
      const b = hitTest(text, 0.41, 0.1 + (up ? 2.5 : 1.5) * H)!;
      const c = hitTest(text, 0.41, 0.1 + (up ? 1.5 : 2.5) * H)!;
      expect(selectedText(text, b, c)).toBe("bc");
      expect(selectionRects(text, b, c)).toEqual([[0.4, 0.1 + H, 0.4 + W, 0.1 + 3 * H]]);
    }
  });

  it("hit_testing_misses_a_point_off_the_text_and_charNear_still_finds_an_end", () => {
    const text = page(across("ab", 0.1, 0.1), across("cd", 0.1, 0.5));
    expect(hitTest(text, 0.9, 0.9)).toBeNull();
    expect(charNear(text, 0.9, 0.9)).toEqual({ line: 1, unit: 1 });
    expect(charNear(text, 0.0, 0.0)).toEqual({ line: 0, unit: 0 });
    // Between the two lines, nearer the second: its glyph, not the first line's.
    expect(charNear(text, 0.1, 0.4)).toEqual({ line: 1, unit: 0 });
    expect(charNear(page(), 0.5, 0.5)).toBeNull();
  });

  it("a_line_taken_whole_is_selected_whole", () => {
    // Three characters, two glyphs: the line is one unit.
    const line = across("fie", 0.1, 0.1);
    line.glyphs = line.glyphs.slice(0, 2);
    const text = page(line);
    const at = hitTest(text, 0.11, 0.11)!;
    expect(selectedText(text, at, at)).toBe("fie");
    expect(selectionRects(text, at, at)).toEqual([line.rect]);
  });

  it("the_whole_page_is_the_first_line_to_the_last", () => {
    const text = page(across("ab", 0.1, 0.1), across("cd", 0.1, 0.2));
    const [from, to] = wholePage(text)!;
    expect(selectedText(text, from, to)).toBe("ab\ncd");
    expect(wholePage(page())).toBeNull();
    const one = page(leftward("abc", 0.5, 0.1));
    const [a, b] = wholePage(one)!;
    expect(selectedText(one, a, b)).toBe("abc");
    expect(sameChar(a, b)).toBe(false);
  });
});
