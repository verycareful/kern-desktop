// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import type { PdfAnnotation } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfAnnotations: vi.fn(), pdfText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { AnnotationLayer } from "./AnnotationLayer";
import { PALETTE } from "./annotations";
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
  over: { apply?: Mock<PdfDoc["apply"]>; canEdit?: boolean; revisions?: number[] } = {}
) {
  const apply = over.apply ?? vi.fn<PdfDoc["apply"]>().mockResolvedValue(undefined);
  const doc = testDoc({
    handle: HANDLE,
    pages: 1,
    pageRevisions: over.revisions ?? [0],
    apply,
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

test("escape_puts_down_the_picked_annotation_and_then_the_tool", async () => {
  await layer();
  fireEvent.click(screen.getByRole("button", { name: "Highlight on page 1" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(usePdfTool.getState().byTab[TAB]?.picked).toBeNull();
  tool("ink");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(usePdfTool.getState().byTab[TAB]?.tool).toBe("select");
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
  fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100 });
  const field = screen.getByLabelText("Text of the note");
  fireEvent.change(field, { target: { value: "x" } });
  fireEvent.keyDown(field, { key: "Escape" });
  expect(apply).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull();
  // The tool stays in hand after the note is let go.
  expect(usePdfTool.getState().byTab[TAB]?.tool).toBe("note");

  fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100 });
  const again = screen.getByLabelText("Text of the note");
  fireEvent.change(again, { target: { value: "kept" } });
  fireEvent.keyDown(again, { key: "Enter", ctrlKey: true });
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ op: "addNote", text: "kept" }));
});

test("a_second_press_while_a_note_is_being_written_does_not_lose_it", async () => {
  await layer();
  tool("note");
  const surface = screen.getByTestId("pdf-note-surface");
  fireEvent.pointerDown(surface, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.change(screen.getByLabelText("Text of the note"), { target: { value: "draft" } });
  fireEvent.pointerDown(surface, { button: 0, clientX: 700, clientY: 700 });
  expect(screen.getByLabelText("Text of the note")).toHaveValue("draft");
  expect(usePdfTool.getState().byTab[TAB]?.draft).toEqual({ kind: "new", page: 0, at: [0.1, 0.1] });
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
    lines: [{ block: 0, text: "hello", rect: [0.1, 0.1, 0.3, 0.14], glyphs: [] }],
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
