// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it, vi } from "vitest";
import type { PdfPageText, PdfTextBlock, Rect } from "../ipc/pdf";
import type { ApplyOutcome } from "./edit-state";
import {
  MIN_WIDTH_PT,
  PAGE_MARGIN_PT,
  addTextOp,
  defaultRight,
  nearestLineRect,
  placeNewText,
  snapRight,
  submitNewText,
} from "./new-text";
import { pageText, type PageText } from "./text-lines";
import type { PdfDoc } from "./usePdfDoc";

const WIDTH_PT = 600;
const CSS_WIDTH = 1000;

const line = (block: number, text: string, rect: Rect) => ({
  block,
  text,
  wrapped: false,
  rect,
  glyphs: Array.from(text).map((): Rect => rect),
});

/** A column from 0.1 to 0.8, a narrower note from 0.1 to 0.4, and a heading that cannot be edited. */
const page = (blocks?: PdfTextBlock[]): PageText =>
  pageText({
    revision: 4,
    tagged: false,
    lines: [
      line(0, "body", [0.1, 0.2, 0.8, 0.22]),
      line(1, "note", [0.1, 0.5, 0.4, 0.53]),
      line(2, "Title", [0.1, 0.05, 0.9, 0.1]),
    ],
    blocks: blocks ?? [
      { id: 0, rect: [0.1, 0.2, 0.8, 0.3], editable: true },
      { id: 1, rect: [0.1, 0.5, 0.4, 0.53], editable: true },
      { id: 2, rect: [0.1, 0.05, 0.9, 0.1], editable: false, reason: "Type3Font" },
    ],
  } satisfies PdfPageText);

const empty = (): PageText => ({ revision: 4, lines: [], blocks: [] });

describe("addTextOp", () => {
  it("new_text_has_its_box_in_fractions_of_the_displayed_page_and_no_date", () => {
    expect(addTextOp({ page: 2, at: [0.1, 0.6], width: 0.5 }, "Hello")).toEqual({
      op: "addText",
      page: 2,
      at: [0.1, 0.6],
      width: 0.5,
      text: "Hello",
    });
  });

  it("a_size_is_sent_only_when_one_is_given", () => {
    expect(addTextOp({ page: 0, at: [0, 0], width: 1 }, "x", 14)).toMatchObject({ size: 14 });
    expect(addTextOp({ page: 0, at: [0, 0], width: 1 }, "x")).not.toHaveProperty("size");
  });
});

describe("defaultRight", () => {
  it("a_click_runs_to_the_furthest_right_edge_of_the_page_text", () => {
    expect(defaultRight(page(), 0.2, WIDTH_PT)).toBe(0.9);
  });

  it("text_too_near_its_right_edge_is_passed_over", () => {
    // A column that ends at 0.5: from 0.46 it leaves less than the least width, so the box runs to
    // the margin instead.
    const column = page([{ id: 0, rect: [0.1, 0.2, 0.5, 0.3], editable: true }]);
    expect(0.5 - 0.46).toBeLessThan(MIN_WIDTH_PT / WIDTH_PT);
    expect(defaultRight(column, 0.46, WIDTH_PT)).toBeCloseTo(1 - PAGE_MARGIN_PT / WIDTH_PT);
  });

  it("a_page_with_no_text_runs_to_one_margin_short_of_the_edge", () => {
    expect(defaultRight(empty(), 0.2, WIDTH_PT)).toBeCloseTo(1 - PAGE_MARGIN_PT / WIDTH_PT);
  });

  it("past_the_margin_it_runs_to_the_page_edge", () => {
    expect(defaultRight(empty(), 0.95, WIDTH_PT)).toBe(1);
  });
});

describe("snapRight", () => {
  const tolerance = 0.01;

  it("a_drag_that_ends_near_a_block_right_edge_takes_it", () => {
    expect(snapRight(page(), 0.3, 0.795, tolerance)).toBe(0.8);
  });

  it("a_drag_that_ends_near_the_width_of_a_block_takes_that_width", () => {
    // The note is 0.3 wide; a box from 0.45 dragged to 0.756 is near 0.45 + 0.3.
    expect(snapRight(page(), 0.45, 0.756, tolerance)).toBeCloseTo(0.75);
  });

  it("the_nearest_of_two_widths_is_taken", () => {
    // From 0.5: the column edge 0.8 is 0.004 away, 0.5 + the note's 0.3 is the same 0.8; the
    // heading's edge 0.9 is far.
    expect(snapRight(page(), 0.5, 0.804, tolerance)).toBeCloseTo(0.8);
  });

  it("a_drag_far_from_every_width_is_left_where_it_ended", () => {
    expect(snapRight(page(), 0.3, 0.62, tolerance)).toBe(0.62);
  });

  it("a_width_left_of_the_box_or_past_the_page_is_never_taken", () => {
    expect(snapRight(page(), 0.5, 0.405, tolerance)).toBe(0.405);
    // From 0.5, the width of a block 0.6 wide would end at 1.1, past the page.
    expect(
      snapRight(page([{ id: 0, rect: [0, 0, 0.6, 0.1], editable: true }]), 0.5, 0.99, 0.2)
    ).toBe(0.99);
    expect(
      snapRight(page([{ id: 0, rect: [0, 0, 0.9, 0.1], editable: true }]), 0.2, 0.995, 0.2)
    ).toBe(0.9);
  });
});

describe("placeNewText", () => {
  const args = { page: 1, widthPt: WIDTH_PT, cssWidth: CSS_WIDTH };

  it("a_click_places_the_box_there_running_to_the_text_column", () => {
    expect(
      placeNewText({ ...args, text: page(), down: [0.2, 0.7], up: [0.2, 0.7], dragged: false })
    ).toEqual({ page: 1, at: [0.2, 0.7], width: expect.closeTo(0.7) as number });
  });

  it("a_drag_sets_the_width_and_snaps_its_end", () => {
    const place = placeNewText({
      ...args,
      text: page(),
      down: [0.3, 0.7],
      up: [0.797, 0.75],
      dragged: true,
    });
    expect(place?.at).toEqual([0.3, 0.7]);
    expect(place?.width).toBeCloseTo(0.5);
  });

  it("a_drag_to_the_left_starts_the_box_at_its_end", () => {
    const place = placeNewText({
      ...args,
      text: empty(),
      down: [0.6, 0.7],
      up: [0.2, 0.7],
      dragged: true,
    });
    expect(place?.at).toEqual([0.2, 0.7]);
    expect(place?.width).toBeCloseTo(0.4);
  });

  it("a_drag_narrower_than_the_least_width_is_widened_to_it", () => {
    const place = placeNewText({
      ...args,
      text: empty(),
      down: [0.3, 0.7],
      up: [0.31, 0.7],
      dragged: true,
    });
    expect(place?.width).toBeCloseTo(MIN_WIDTH_PT / WIDTH_PT);
  });

  it("a_box_never_runs_past_the_page_edge", () => {
    const place = placeNewText({
      ...args,
      text: empty(),
      down: [0.98, 0.7],
      up: [0.98, 0.7],
      dragged: false,
    });
    expect(place?.width).toBeCloseTo(0.02);
  });

  it("a_press_on_the_page_edge_places_nothing", () => {
    expect(
      placeNewText({ ...args, text: empty(), down: [1, 0.5], up: [1, 0.5], dragged: false })
    ).toBeNull();
    expect(
      placeNewText({ ...args, text: empty(), down: [0.5, 1], up: [0.5, 1], dragged: false })
    ).toBeNull();
  });
});

describe("the nearest text", () => {
  it("the_box_takes_the_look_of_the_nearest_block_that_can_be_edited", () => {
    // Under the heading, which cannot be edited: the body below it is the nearest that can.
    expect(nearestLineRect(page(), [0.5, 0.12])).toEqual([0.1, 0.2, 0.8, 0.22]);
    expect(nearestLineRect(page(), [0.2, 0.6])).toEqual([0.1, 0.5, 0.4, 0.53]);
    expect(nearestLineRect(empty(), [0.2, 0.6])).toBeNull();
  });
});

describe("submitNewText", () => {
  const place = { page: 0, at: [0.1, 0.1] as [number, number], width: 0.5 };
  const doc = (outcome: ApplyOutcome) =>
    ({ applyChecked: vi.fn(async () => outcome) }) as unknown as PdfDoc;
  const failed = (kind: string, message = "m"): ApplyOutcome => ({
    status: "failed",
    error: { kind, message, path: null, details: null },
  });

  it("an_applied_change_is_done", async () => {
    const d = doc({ status: "applied", notes: [] });
    expect(await submitNewText(d, place, "Hi")).toEqual({ status: "done" });
    expect(d.applyChecked).toHaveBeenCalledWith(addTextOp(place, "Hi"));
  });

  it("a_page_with_no_text_to_follow_asks_for_a_size", async () => {
    expect(await submitNewText(doc(failed("NoSizeForNewText")), place, "Hi")).toEqual({
      status: "needs-size",
    });
  });

  it("the_size_is_sent_when_given_and_a_refusal_then_is_said", async () => {
    const d = doc(failed("NoSizeForNewText", "no size"));
    const result = await submitNewText(d, place, "Hi", 12);
    expect(d.applyChecked).toHaveBeenCalledWith(addTextOp(place, "Hi", 12));
    expect(result.status).toBe("failed");
  });

  it("a_character_with_no_glyph_names_the_character", async () => {
    const result = await submitNewText(
      doc(failed("NoGlyphForCharacter", "no glyph for U+1F600")),
      place,
      "Hi"
    );
    expect(result).toEqual({
      status: "failed",
      message: expect.stringContaining("U+1F600") as string,
    });
  });

  it("a_document_that_cannot_take_a_change_says_why", async () => {
    expect(
      await submitNewText(doc({ status: "refused", message: "not open" }), place, "Hi")
    ).toEqual({
      status: "failed",
      message: "not open",
    });
  });

  it("a_cancelled_copy_question_is_declined", async () => {
    expect(await submitNewText(doc({ status: "declined" }), place, "Hi")).toEqual({
      status: "declined",
    });
  });
});
