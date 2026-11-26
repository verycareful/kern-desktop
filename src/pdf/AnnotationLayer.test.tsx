// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import type { PdfAnnotation } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfAnnotations: vi.fn(), pdfText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { AnnotationLayer } from "./AnnotationLayer";
import { INK_GROUP_MS, PALETTE } from "./annotations";
import { markPainted } from "./page-paint";
import { dropPageText } from "./page-text";
import { usePdfTool } from "./pdf-tool";
import { testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

const TAB = "tab-1";
const HANDLE = 3;
const SIZE = 1000;
const ID = { object: 7, generation: 0 };

const highlight: PdfAnnotation = {
  id: ID,
  kind: "Highlight",
  subtype: null,
  drawn_by_library: true,
  rect: [0.1, 0.1, 0.4, 0.15],
  quads: [[0.1, 0.1, 0.4, 0.15]],
  strokes: [],
  contents: null,
  author: null,
  colour: [1, 0.92, 0.2],
  opacity: null,
  line_width: null,
  flags: 4,
};
const note: PdfAnnotation = {
  ...highlight,
  id: { object: 8, generation: 0 },
  kind: "Note",
  rect: [0.5, 0.5, 0.55, 0.55],
  quads: [],
  contents: "check the date",
};
const nameless: PdfAnnotation = { ...highlight, id: null };
const link: PdfAnnotation = {
  ...highlight,
  id: { object: 9, generation: 0 },
  kind: "Other",
  subtype: "Link",
  drawn_by_library: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  usePdfTool.setState({ byTab: {}, listed: {} });
  ipc.pdfAnnotations.mockResolvedValue([highlight]);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: SIZE,
    bottom: SIZE,
    width: SIZE,
    height: SIZE,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

const size = { widthPt: 500, heightPt: 700, rotate: 0 as const };

async function layer(
  over: {
    apply?: Mock<PdfDoc["apply"]>;
    applyChecked?: Mock<PdfDoc["applyChecked"]>;
    canEdit?: boolean;
    revisions?: number[];
  } = {}
) {
  const apply = over.apply ?? vi.fn<PdfDoc["apply"]>().mockResolvedValue(undefined);
  const doc = testDoc({
    handle: HANDLE,
    pages: 1,
    pageRevisions: over.revisions ?? [0],
    apply,
    ...(over.applyChecked ? { applyChecked: over.applyChecked } : {}),
    canEdit: over.canEdit ?? true,
  });
  const element = (d = doc) => (
    <AnnotationLayer tabId={TAB} doc={d} page={0} size={size} cssWidth={SIZE} visible current />
  );
  const view = render(element());
  await waitFor(() => expect(usePdfTool.getState().listed[TAB]?.[0]).toBeDefined());
  return { apply, doc, view, element };
}

const tool = (t: "select" | "ink" | "note" | "editText") =>
  act(() => usePdfTool.getState().setTool(TAB, t));

test("clicking_an_annotation_selects_it_and_offers_colour_and_delete", async () => {
  const { apply } = await layer();
  expect(screen.queryByTestId("pdf-annotation-picked")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  expect(screen.getByTestId("pdf-annotation-picked")).toBeInTheDocument();
  expect(usePdfTool.getState().byTab[TAB]?.picked).toEqual({ page: 0, id: ID });

  fireEvent.click(screen.getByRole("button", { name: "Blue" }));
  expect(apply).toHaveBeenLastCalledWith({
    op: "editAnnotation",
    page: 0,
    id: ID,
    colour: PALETTE[2]!.rgb,
  });

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(apply).toHaveBeenLastCalledWith({ op: "deleteAnnotation", page: 0, id: ID });
  expect(usePdfTool.getState().byTab[TAB]?.picked).toBeNull();
});

test("an_annotation_with_no_name_and_one_the_page_owns_cannot_be_picked", async () => {
  ipc.pdfAnnotations.mockResolvedValue([nameless, link, highlight]);
  await layer();
  expect(screen.getAllByTestId("pdf-annotation")).toHaveLength(1);
});

test("a_document_that_cannot_be_changed_shows_the_menu_with_its_buttons_off", async () => {
  const { apply } = await layer({ canEdit: false });
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
  expect(apply).not.toHaveBeenCalled();
});

test("an_annotation_that_goes_from_the_page_is_no_longer_picked", async () => {
  const { doc, view, element } = await layer();
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  ipc.pdfAnnotations.mockResolvedValue([]);
  view.rerender(element({ ...doc, pageRevisions: [1] }));
  await waitFor(() => expect(usePdfTool.getState().byTab[TAB]?.picked).toBeNull());
  expect(screen.queryByTestId("pdf-annotation-picked")).toBeNull();
});

test("the_annotations_of_a_page_are_read_again_when_an_edit_changes_it", async () => {
  const { doc, view, element } = await layer();
  expect(ipc.pdfAnnotations).toHaveBeenCalledTimes(1);
  expect(ipc.pdfAnnotations).toHaveBeenCalledWith(HANDLE, 0);
  view.rerender(element({ ...doc, pageRevisions: [2] }));
  await waitFor(() => expect(ipc.pdfAnnotations).toHaveBeenCalledTimes(2));
  view.rerender(element({ ...doc, pageRevisions: [2] }));
  expect(ipc.pdfAnnotations).toHaveBeenCalledTimes(2);
});

test("escape_puts_down_the_picked_annotation_and_never_leaves_the_tool", async () => {
  ipc.pdfText.mockResolvedValue({ revision: 1, tagged: false, lines: [], blocks: [] });
  await layer();
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(usePdfTool.getState().byTab[TAB]?.picked).toBeNull();
  expect(usePdfTool.getState().byTab[TAB]?.tool).toBe("select");
  for (const held of ["ink", "note", "editText"] as const) {
    tool(held);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePdfTool.getState().byTab[TAB]?.tool).toBe(held);
  }
});

test("the_note_tool_puts_a_note_where_the_page_is_pressed_with_the_text_written", async () => {
  const { apply } = await layer();
  tool("note");
  fireEvent.pointerDown(screen.getByTestId("pdf-note-surface"), {
    button: 0,
    clientX: 300,
    clientY: 600,
  });
  const add = screen.getByRole("button", { name: "Add note" });
  expect(add).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Text of the note"), { target: { value: "ask Sam" } });
  fireEvent.click(add);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({
    op: "addNote",
    page: 0,
    at: [0.3, 0.6],
    text: "ask Sam",
    colour: PALETTE[0]!.rgb,
  });
  expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull();
});

test("escape_in_the_note_box_adds_nothing_and_ctrl_enter_keeps_the_text", async () => {
  const { apply } = await layer();
  tool("note");
  const surface = screen.getByTestId("pdf-note-surface");
  fireEvent.pointerDown(surface, { button: 0, clientX: 600, clientY: 600 });
  const field = screen.getByLabelText("Text of the note");
  fireEvent.change(field, { target: { value: "x" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(apply).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull();
  // The tool stays in hand after the note is let go.
  expect(usePdfTool.getState().byTab[TAB]?.tool).toBe("note");

  fireEvent.pointerDown(surface, { button: 0, clientX: 600, clientY: 600 });
  const again = screen.getByLabelText("Text of the note");
  fireEvent.change(again, { target: { value: "kept" } });
  fireEvent.keyDown(again, { key: "Enter", ctrlKey: true });
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ op: "addNote", text: "kept" }));
});

test("a_second_press_while_a_note_is_being_written_does_not_lose_it", async () => {
  await layer();
  tool("note");
  const surface = screen.getByTestId("pdf-note-surface");
  fireEvent.pointerDown(surface, { button: 0, clientX: 600, clientY: 600 });
  fireEvent.change(screen.getByLabelText("Text of the note"), { target: { value: "draft" } });
  fireEvent.pointerDown(surface, { button: 0, clientX: 800, clientY: 800 });
  expect(screen.getByLabelText("Text of the note")).toHaveValue("draft");
  expect(usePdfTool.getState().byTab[TAB]?.draft).toEqual({ kind: "new", page: 0, at: [0.6, 0.6] });
});

test("the_text_of_a_picked_note_is_shown_and_can_be_changed", async () => {
  ipc.pdfAnnotations.mockResolvedValue([note]);
  const { apply } = await layer();
  fireEvent.click(screen.getByRole("button", { name: "Note on page 1" }));
  expect(screen.getByText("check the date")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
  const field = screen.getByLabelText("Text of the note");
  expect(field).toHaveValue("check the date");
  fireEvent.change(field, { target: { value: "dated 3 May" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(apply).toHaveBeenCalledWith({
    op: "editAnnotation",
    page: 0,
    id: note.id,
    contents: "dated 3 May",
  });
});

test("the_tools_are_not_offered_while_the_document_cannot_be_changed", async () => {
  await layer({ canEdit: false });
  tool("note");
  expect(screen.queryByTestId("pdf-note-surface")).toBeNull();
  tool("ink");
  expect(screen.queryByTestId("pdf-ink-surface")).toBeNull();
});

test("the_boxes_of_the_annotations_are_not_offered_while_a_tool_is_in_hand", async () => {
  await layer();
  expect(screen.getAllByTestId("pdf-annotation")).toHaveLength(1);
  tool("ink");
  expect(screen.queryByTestId("pdf-annotation")).toBeNull();
});

test("an_annotation_that_cannot_be_read_says_so", async () => {
  ipc.pdfAnnotations.mockRejectedValue({ kind: "Other", message: "unreadable" });
  render(
    <AnnotationLayer
      tabId={TAB}
      doc={testDoc({ handle: HANDLE, pages: 1 })}
      page={0}
      size={size}
      cssWidth={SIZE}
      visible
      current
    />
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The annotations of page 1 could not be read: Other: unreadable"
  );
});

test("the_edit_text_tool_offers_the_blocks_of_the_page_and_only_while_the_document_can_be_changed", async () => {
  ipc.pdfText.mockResolvedValue({
    revision: 0,
    tagged: false,
    lines: [{ block: 0, text: "hello", wrapped: false, rect: [0.1, 0.1, 0.3, 0.14], glyphs: [] }],
    blocks: [{ id: 0, rect: [0.1, 0.1, 0.3, 0.14], editable: true }],
  });
  const { doc, view, element } = await layer();
  expect(screen.queryByTestId("pdf-blocks-0")).toBeNull();
  tool("editText");
  expect(await screen.findByRole("button", { name: "Edit text: hello" })).toBeInTheDocument();
  // The annotations' keyboard boxes are for the Select tool only.
  expect(screen.queryByTestId("pdf-annotation")).toBeNull();
  view.rerender(element({ ...doc, canEdit: false }));
  expect(screen.queryByTestId("pdf-blocks-0")).toBeNull();
});

test("the_note_tool_opens_the_note_that_is_pressed_instead_of_putting_another_on_top", async () => {
  ipc.pdfAnnotations.mockResolvedValue([note]);
  const { apply } = await layer();
  tool("note");
  fireEvent.pointerDown(screen.getByTestId("pdf-note-surface"), {
    button: 0,
    clientX: 520,
    clientY: 520,
  });
  expect(usePdfTool.getState().byTab[TAB]?.draft).toEqual({ kind: "edit", page: 0, id: note.id });
  const field = screen.getByLabelText("Text of the note");
  expect(field).toHaveValue("check the date");
  fireEvent.change(field, { target: { value: "checked" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({
    op: "editAnnotation",
    page: 0,
    id: note.id,
    contents: "checked",
  });
});

test("the_note_tool_opens_the_note_of_marked_text_that_is_pressed_and_a_press_on_the_page_still_adds_one", async () => {
  const { apply } = await layer();
  tool("note");
  const surface = screen.getByTestId("pdf-note-surface");
  // The highlight covers x 0.1 to 0.4, y 0.1 to 0.15.
  fireEvent.pointerDown(surface, { button: 0, clientX: 200, clientY: 120 });
  expect(usePdfTool.getState().byTab[TAB]?.draft).toEqual({ kind: "edit", page: 0, id: ID });
  fireEvent.keyDown(screen.getByLabelText("Text of the note"), { key: "Escape" });
  expect(apply).not.toHaveBeenCalled();

  fireEvent.pointerDown(surface, { button: 0, clientX: 700, clientY: 700 });
  expect(usePdfTool.getState().byTab[TAB]?.draft).toEqual({ kind: "new", page: 0, at: [0.7, 0.7] });
});

test("a_picked_highlight_offers_a_note_that_is_kept_with_it_and_can_be_taken_away", async () => {
  const { apply } = await layer();
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  const field = screen.getByLabelText("Text of the note");
  expect(field).toHaveValue("");
  fireEvent.change(field, { target: { value: "ask about this" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(apply).toHaveBeenCalledWith({
    op: "editAnnotation",
    page: 0,
    id: ID,
    contents: "ask about this",
  });
});

test("a_highlight_with_a_note_shows_the_note_and_saving_nothing_takes_it_away", async () => {
  ipc.pdfAnnotations.mockResolvedValue([{ ...highlight, contents: "see page 4" }]);
  const { apply } = await layer();
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  expect(screen.getByText("see page 4")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
  fireEvent.change(screen.getByLabelText("Text of the note"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(apply).toHaveBeenCalledWith({ op: "editAnnotation", page: 0, id: ID, contents: "" });
});

test("a_note_on_text_selected_with_the_menu_is_one_highlight_that_carries_it", async () => {
  const { apply } = await layer();
  act(() =>
    usePdfTool.getState().draft(TAB, {
      kind: "markup",
      page: 0,
      at: [0.2, 0.2],
      rects: [[0.1, 0.1, 0.2, 0.12]],
    })
  );
  fireEvent.change(screen.getByLabelText("Text of the note"), { target: { value: "why?" } });
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({
    op: "addMarkup",
    kind: "highlight",
    page: 0,
    quads: [[0.1, 0.1, 0.2, 0.12]],
    colour: PALETTE[0]!.rgb,
    contents: "why?",
  });
});

test("a_line_stays_on_show_until_the_page_is_drawn_with_it_in_it", async () => {
  const applyChecked = vi
    .fn<PdfDoc["applyChecked"]>()
    .mockResolvedValue({ status: "applied", notes: [], revision: 7 });
  await layer({ applyChecked });
  tool("ink");
  vi.useFakeTimers();
  try {
    const surface = screen.getByTestId("pdf-ink-surface");
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 400, clientY: 300 });
    await act(async () => void vi.advanceTimersByTime(INK_GROUP_MS));
    expect(applyChecked).toHaveBeenCalledTimes(1);
    expect(applyChecked.mock.calls[0]?.[0]).toMatchObject({ op: "addInk", page: 0 });
    // The engine has answered; the page's picture at revision 7 is not on screen yet.
    expect(surface.querySelectorAll("polyline")).toHaveLength(1);
    await act(async () => markPainted(HANDLE, 0, 6));
    expect(surface.querySelectorAll("polyline")).toHaveLength(1);
    await act(async () => markPainted(HANDLE, 0, 7));
    expect(surface.querySelectorAll("polyline")).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test("a_line_the_engine_refused_does_not_wait_for_a_picture", async () => {
  const applyChecked = vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({
    status: "failed",
    error: { kind: "Invalid", message: "no", path: null, details: null },
  });
  await layer({ applyChecked });
  tool("ink");
  vi.useFakeTimers();
  try {
    const surface = screen.getByTestId("pdf-ink-surface");
    fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 300, clientY: 300 });
    await act(async () => void vi.advanceTimersByTime(INK_GROUP_MS));
    expect(surface.querySelectorAll("polyline")).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
