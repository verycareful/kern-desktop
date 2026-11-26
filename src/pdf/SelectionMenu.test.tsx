// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn(), clipText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { dropPageText } from "./page-text";
import { usePdfSelection } from "./pdf-selection";
import { markSelection } from "./annotation-actions";
import { copySelection, searchSelection, selectAllOnPage } from "./selection-actions";
import { SelectionMenu } from "./SelectionMenu";
import { testDoc } from "./test-doc";

const TAB = "tab-1";
const HANDLE = 3;
const glyphs = (text: string, y: number): Rect[] =>
  Array.from(text).map((_, i) => [0.1 + i * 0.02, y, 0.12 + i * 0.02, y + 0.02]);
const wire: PdfPageText = {
  revision: 1,
  lines: [
    {
      block: 0,
      text: "hello there",
      wrapped: false,
      rect: [0.1, 0.1, 0.32, 0.12],
      glyphs: glyphs("hello there", 0.1),
    },
    {
      block: 0,
      text: "second",
      wrapped: false,
      rect: [0.1, 0.2, 0.22, 0.22],
      glyphs: glyphs("second", 0.2),
    },
  ],
  blocks: [],
  tagged: false,
};
const doc = testDoc({ handle: HANDLE, pages: 3 });

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  usePdfSelection.setState({ byTab: {}, searches: {} });
  useOps.setState({ notice: null } as never);
  ipc.pdfText.mockResolvedValue(wire);
  ipc.clipText.mockResolvedValue(undefined);
});

const select = (from: number, to: number) =>
  act(() =>
    usePdfSelection.getState().select(TAB, {
      page: 1,
      from: { line: 0, unit: from },
      to: { line: 0, unit: to },
    })
  );

test("the_menu_has_a_button_for_each_thing_to_do_with_the_text", () => {
  const onCopy = vi.fn();
  const onSearch = vi.fn();
  render(
    <SelectionMenu
      at={{ left: 0.5, top: 0.25 }}
      onCopy={onCopy}
      onSearch={onSearch}
      canMark
      onMark={vi.fn()}
      onNote={vi.fn()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Search for it" }));
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onSearch).toHaveBeenCalledTimes(1);
});

test("copy_puts_the_text_on_the_clipboard", async () => {
  select(0, 4);
  await copySelection(TAB, doc);
  expect(ipc.pdfText).toHaveBeenCalledWith(HANDLE, 1);
  expect(ipc.clipText).toHaveBeenCalledWith("hello");
});

test("copy_across_lines_keeps_the_line_breaks", async () => {
  act(() =>
    usePdfSelection.getState().select(TAB, {
      page: 1,
      from: { line: 0, unit: 6 },
      to: { line: 1, unit: 2 },
    })
  );
  await copySelection(TAB, doc);
  expect(ipc.clipText).toHaveBeenCalledWith("there\nsec");
});

test("a_failed_copy_is_said_and_a_missing_selection_copies_nothing", async () => {
  await copySelection(TAB, doc);
  expect(ipc.clipText).not.toHaveBeenCalled();
  select(0, 4);
  ipc.clipText.mockRejectedValue({ kind: "Other", message: "no clipboard" });
  const notify = vi.spyOn(useOps.getState(), "notify");
  await copySelection(TAB, doc);
  expect(notify).toHaveBeenCalledWith("The text could not be copied: Other: no clipboard");
});

test("search_opens_find_with_the_selected_text", async () => {
  select(0, 4);
  await searchSelection(TAB, doc);
  expect(usePdfSelection.getState().searches[TAB]).toEqual({ text: "hello", seq: 1 });
  await searchSelection(TAB, doc);
  expect(usePdfSelection.getState().searches[TAB]?.seq).toBe(2);
});

test("select_all_selects_the_whole_page_and_a_page_without_text_says_so", async () => {
  await selectAllOnPage(TAB, doc, 1);
  expect(usePdfSelection.getState().byTab[TAB]).toEqual({
    page: 1,
    from: { line: 0, unit: 0 },
    to: { line: 1, unit: 5 },
  });
  await copySelection(TAB, doc);
  expect(ipc.clipText).toHaveBeenCalledWith("hello there\nsecond");

  usePdfSelection.setState({ byTab: {} });
  ipc.pdfText.mockResolvedValue({ ...wire, lines: [] });
  const notify = vi.spyOn(useOps.getState(), "notify");
  await selectAllOnPage(TAB, doc, 2);
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
  expect(notify).toHaveBeenCalledWith("Page 3 has no text to select");
});

test("highlight_underline_strikeout_and_note_appear_after_this_session", () => {
  const onMark = vi.fn();
  const onNote = vi.fn();
  render(
    <SelectionMenu
      at={{ left: 0.5, top: 0.25 }}
      onCopy={vi.fn()}
      onSearch={vi.fn()}
      canMark
      onMark={onMark}
      onNote={onNote}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Highlight" }));
  fireEvent.click(screen.getByRole("button", { name: "Underline" }));
  fireEvent.click(screen.getByRole("button", { name: "Strikeout" }));
  fireEvent.click(screen.getByRole("button", { name: "Note" }));
  expect(onMark.mock.calls).toEqual([["highlight"], ["underline"], ["strikeOut"]]);
  expect(onNote).toHaveBeenCalledTimes(1);
});

test("a_document_that_cannot_be_changed_offers_the_markup_and_does_not_make_it", () => {
  const onMark = vi.fn();
  render(
    <SelectionMenu
      at={{ left: 0.5, top: 0.25 }}
      onCopy={vi.fn()}
      onSearch={vi.fn()}
      canMark={false}
      onMark={onMark}
      onNote={vi.fn()}
    />
  );
  for (const name of ["Highlight", "Underline", "Strikeout", "Note"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
});

test("highlight_applies_one_op_and_marks_the_tab_dirty", async () => {
  // The change goes to the document as one op, and the document (usePdfDoc) takes the engine's
  // `modified` as the tab's dirty flag (usePdfDoc.edit.test.ts).
  const apply = vi.fn().mockResolvedValue(undefined);
  const editable = testDoc({ handle: HANDLE, pages: 3, apply });
  select(0, 4);
  await markSelection(TAB, editable, "highlight");
  expect(apply).toHaveBeenCalledTimes(1);
  const op = apply.mock.calls[0]![0] as { op: string; kind: string; page: number; quads: Rect[] };
  expect(op).toMatchObject({ op: "addMarkup", kind: "highlight", page: 1 });
  expect(op.quads.length).toBe(1);
  expect(op.quads[0]![0]).toBeCloseTo(0.1);
  expect(op.quads[0]![2]).toBeCloseTo(0.2);
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
});

test("a_document_that_cannot_be_changed_is_not_marked_and_says_so", async () => {
  const apply = vi.fn();
  const locked = testDoc({ handle: HANDLE, pages: 3, apply, canEdit: false });
  select(0, 4);
  const notify = vi.spyOn(useOps.getState(), "notify");
  await markSelection(TAB, locked, "underline");
  expect(apply).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith("This document cannot be changed here");
});
