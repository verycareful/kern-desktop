// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { PdfAnnotation, Rect } from "../ipc/pdf";
import {
  PALETTE,
  annotationAt,
  colourName,
  deleteOp,
  extendStroke,
  fractionAt,
  inkOp,
  isPickable,
  kindLabel,
  markupOp,
  noteOp,
  noteTextOp,
  pickable,
  recolourOp,
} from "./annotations";

const annotation = (over: Partial<PdfAnnotation>): PdfAnnotation => ({
  id: { object: 7, generation: 0 },
  kind: "Highlight",
  subtype: null,
  drawn_by_library: true,
  rect: [0.1, 0.1, 0.3, 0.2],
  quads: [],
  strokes: [],
  contents: null,
  author: null,
  colour: [1, 1, 0],
  opacity: null,
  line_width: null,
  flags: 4,
  ...over,
});

const YELLOW = PALETTE[0]!.rgb;

// The text layer's rectangles are fractions of the page as it is shown, whatever its turn, and
// the engine takes exactly those and writes the page's user space itself. So the rectangles of a
// selection on a page turned a quarter reach the operation as they are.
test("markup_rects_on_a_rotated_page_are_upright_fractions", () => {
  const turned: Rect[] = [
    [0.25, 0.5, 0.5, 0.75],
    [0.25, 0.75, 0.4, 0.8],
  ];
  expect(markupOp("highlight", 2, turned, YELLOW)).toEqual({
    op: "addMarkup",
    kind: "highlight",
    page: 2,
    quads: turned,
    colour: YELLOW,
  });
});

test("a_markup_names_its_kind_as_the_engine_does_and_a_selection_with_no_area_makes_none", () => {
  const op = markupOp("strikeOut", 0, [[0, 0, 0.5, 0.1]], YELLOW);
  expect(op).toMatchObject({ kind: "strikeOut" });
  expect(markupOp("highlight", 0, [], YELLOW)).toBeNull();
  expect(markupOp("highlight", 0, [[0.2, 0.2, 0.2, 0.3]], YELLOW)).toBeNull();
});

test("ink_strokes_round_trip_through_the_page_transform", () => {
  // A press at the middle of a page 200 by 400 CSS pixels, drawn on, is the middle of the page.
  const bounds = { left: 100, top: 50, width: 200, height: 400 };
  const a = fractionAt(200, 250, bounds)!;
  const b = fractionAt(250, 350, bounds)!;
  expect(a).toEqual([0.5, 0.5]);
  expect(b).toEqual([0.75, 0.75]);
  expect(inkOp(1, [[a, b]], [0.9, 0.15, 0.15], 2)).toEqual({
    op: "addInk",
    page: 1,
    strokes: [
      [
        [0.5, 0.5],
        [0.75, 0.75],
      ],
    ],
    width: 2,
    colour: [0.9, 0.15, 0.15],
  });
  expect(inkOp(1, [], YELLOW, 2)).toBeNull();
  expect(inkOp(1, [[]], YELLOW, 2)).toBeNull();
});

test("a_point_off_the_page_is_kept_on_it_and_a_page_of_no_size_gives_none", () => {
  const bounds = { left: 0, top: 0, width: 100, height: 100 };
  expect(fractionAt(-10, 250, bounds)).toEqual([0, 1]);
  expect(fractionAt(5, 5, { ...bounds, width: 0 })).toBeNull();
});

test("a_stroke_takes_a_point_only_when_it_has_moved", () => {
  const one: [number, number][] = [[0.5, 0.5]];
  expect(extendStroke(one, [0.5001, 0.5])).toBe(one);
  expect(extendStroke(one, [0.6, 0.5])).toEqual([
    [0.5, 0.5],
    [0.6, 0.5],
  ]);
  expect(extendStroke([], [0.1, 0.1])).toEqual([[0.1, 0.1]]);
});

test("a_note_keeps_its_text_and_position", () => {
  expect(noteOp(3, [0.3, 0.6], "check this", YELLOW)).toEqual({
    op: "addNote",
    page: 3,
    at: [0.3, 0.6],
    text: "check this",
    colour: YELLOW,
  });
  const id = { object: 12, generation: 0 };
  expect(noteTextOp(3, id, "checked")).toEqual({
    op: "editAnnotation",
    page: 3,
    id,
    contents: "checked",
  });
});

test("a_new_colour_changes_the_colour_and_nothing_else", () => {
  const id = { object: 12, generation: 0 };
  expect(recolourOp(0, id, PALETTE[2]!.rgb)).toEqual({
    op: "editAnnotation",
    page: 0,
    id,
    colour: PALETTE[2]!.rgb,
  });
  expect(colourName(PALETTE[2]!.rgb)).toBe("Blue");
  expect(colourName([0.1, 0.2, 0.3])).toBeNull();
});

test("delete_removes_only_the_chosen_annotation", () => {
  const id = { object: 12, generation: 1 };
  expect(deleteOp(4, id)).toEqual({ op: "deleteAnnotation", page: 4, id });
});

test("only_an_annotation_an_operation_can_name_and_the_library_draws_can_be_picked", () => {
  const nameless = annotation({ id: null });
  const foreign = annotation({ kind: "Other", subtype: "Link", drawn_by_library: false });
  const mine = annotation({});
  expect(isPickable(nameless)).toBe(false);
  expect(isPickable(foreign)).toBe(false);
  expect(isPickable(mine)).toBe(true);
  expect(pickable([nameless, foreign, mine])).toEqual([mine]);
  expect(kindLabel(annotation({ kind: "StrikeOut" }))).toBe("Strikeout");
  expect(kindLabel(foreign)).toBe("Link");
});

test("the_annotation_at_a_point_is_the_one_on_top_and_a_text_markup_is_hit_inside_its_quads", () => {
  const under = annotation({
    id: { object: 1, generation: 0 },
    quads: [[0.1, 0.1, 0.5, 0.2]],
  });
  const over = annotation({
    id: { object: 2, generation: 0 },
    kind: "Underline",
    quads: [[0.2, 0.1, 0.4, 0.2]],
  });
  expect(annotationAt([under, over], 0.3, 0.15)?.id.object).toBe(2);
  expect(annotationAt([under, over], 0.45, 0.15)?.id.object).toBe(1);
  expect(annotationAt([under, over], 0.6, 0.15)).toBeNull();
});

test("an_ink_line_is_hit_near_its_path_and_not_in_its_box", () => {
  const ink = annotation({
    kind: "Ink",
    rect: [0.1, 0.1, 0.9, 0.9],
    strokes: [
      [
        [0.1, 0.1],
        [0.9, 0.1],
      ],
    ],
  });
  expect(annotationAt([ink], 0.5, 0.105)).not.toBeNull();
  expect(annotationAt([ink], 0.5, 0.5)).toBeNull();
  const dot = annotation({ kind: "Ink", rect: [0.4, 0.4, 0.41, 0.41], strokes: [[[0.4, 0.4]]] });
  expect(annotationAt([dot], 0.402, 0.4)).not.toBeNull();
});

test("a_note_is_hit_inside_its_icon_and_an_unpickable_annotation_never", () => {
  const note = annotation({ kind: "Note", rect: [0.5, 0.5, 0.55, 0.55] });
  const link = annotation({
    id: { object: 9, generation: 0 },
    kind: "Other",
    subtype: "Link",
    drawn_by_library: false,
    rect: [0.5, 0.5, 0.9, 0.9],
  });
  expect(annotationAt([note, link], 0.52, 0.52)?.kind).toBe("Note");
  expect(annotationAt([note, link], 0.8, 0.8)).toBeNull();
});
