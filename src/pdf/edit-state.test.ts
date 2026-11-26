// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { PdfEditAnswer } from "../ipc";
import { afterEdit, afterSave, openedEdit, stampOp, substitutionNotice } from "./edit-state";

const answer = (over: Partial<PdfEditAnswer>): PdfEditAnswer => ({
  revision: 1,
  pages: 3,
  changed_pages: [1],
  can_undo: true,
  can_redo: false,
  modified: true,
  ...over,
});

test("modified_comes_from_the_engine_answer_not_a_local_counter", () => {
  let state = openedEdit(0, 3);
  state = afterEdit(state, answer({ revision: 1, modified: true }));
  state = afterEdit(state, answer({ revision: 2, modified: true }));
  expect(state.modified).toBe(true);
  // Two steps taken and two undone: the engine says the document is as opened.
  state = afterEdit(state, answer({ revision: 3, modified: true, can_redo: true }));
  state = afterEdit(
    state,
    answer({ revision: 4, modified: false, can_undo: false, can_redo: true })
  );
  expect(state.modified).toBe(false);
  expect(state.canUndo).toBe(false);
  expect(state.canRedo).toBe(true);
});

test("an_answer_that_is_not_newer_changes_nothing", () => {
  const state = afterEdit(openedEdit(0, 3), answer({ revision: 2 }));
  expect(afterEdit(state, answer({ revision: 1, modified: false }))).toBe(state);
  expect(afterEdit(state, answer({ revision: 2, modified: false }))).toBe(state);
});

test("only_the_pages_an_answer_names_take_its_revision", () => {
  let state = openedEdit(0, 4);
  state = afterEdit(state, answer({ revision: 1, pages: 4, changed_pages: [2] }));
  expect(state.pageRevisions).toEqual([0, 0, 1, 0]);
  state = afterEdit(state, answer({ revision: 2, pages: 4, changed_pages: [0, 2] }));
  expect(state.pageRevisions).toEqual([2, 0, 2, 0]);
});

test("a_page_that_did_not_exist_before_takes_the_revision_of_the_answer", () => {
  const state = afterEdit(openedEdit(0, 2), answer({ revision: 1, pages: 3, changed_pages: [] }));
  expect(state.pages).toBe(3);
  expect(state.pageRevisions).toEqual([0, 0, 1]);
});

test("a_removed_page_takes_the_revision_of_the_answer_on_every_page_the_engine_names", () => {
  const state = afterEdit(
    openedEdit(0, 3),
    answer({ revision: 1, pages: 2, changed_pages: [0, 1] })
  );
  expect(state.pageRevisions).toEqual([1, 1]);
});

test("stampOp_dates_the_ops_that_take_a_date_and_no_other", () => {
  const date = "D:20261126010309+00'00'";
  expect(
    stampOp({ op: "addNote", page: 0, at: [0.1, 0.2], text: "x", colour: [1, 0, 0] }, date)
  ).toMatchObject({ op: "addNote", modified: date });
  expect(stampOp({ op: "rotate", pages: [0], degrees: 90 }, date)).toEqual({
    op: "rotate",
    pages: [0],
    degrees: 90,
  });
  expect(
    stampOp({ op: "deleteAnnotation", page: 0, id: { object: 3, generation: 0 } }, date)
  ).not.toHaveProperty("modified");
  // The engine refuses a field an op does not have, and new text has no date.
  expect(
    stampOp({ op: "addText", page: 0, at: [0.1, 0.2], width: 0.5, text: "x" }, date)
  ).not.toHaveProperty("modified");
});

test("a_substituted_font_is_said_with_the_file_and_the_engine_words", () => {
  expect(
    substitutionNotice("book.pdf", [
      "substitute font used for: Helvetica (DejaVu Sans)",
      "substitute font used for: Times (DejaVu Serif)",
    ])
  ).toBe(
    "Some letters of the change to book.pdf are set in another font, because the page's font cannot show them (substitute font used for: Helvetica (DejaVu Sans); substitute font used for: Times (DejaVu Serif))."
  );
});

test("a_save_makes_the_document_equal_to_its_file_and_keeps_the_history", () => {
  let state = afterEdit(openedEdit(0, 3), answer({ revision: 1 }));
  expect(state.modified).toBe(true);
  state = afterSave(state);
  expect(state).toMatchObject({ modified: false, canUndo: true, revision: 1 });
  // An undo goes back past the save: the document differs from its file again.
  state = afterEdit(
    state,
    answer({ revision: 2, can_undo: false, can_redo: true, modified: true })
  );
  expect(state.modified).toBe(true);
});

test("saving_a_document_that_is_unchanged_changes_nothing", () => {
  const state = openedEdit(0, 3);
  expect(afterSave(state)).toBe(state);
});
