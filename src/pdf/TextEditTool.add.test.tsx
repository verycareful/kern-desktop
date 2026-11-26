// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi, type Mock } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";
import type { ApplyOutcome } from "./edit-state";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { dropPageText } from "./page-text";
import { testDoc } from "./test-doc";
import { TextEditTool } from "./TextEditTool";
import type { PdfDoc } from "./usePdfDoc";

const HANDLE = 4;
const CSS_WIDTH = 1000;
const CSS_HEIGHT = 1400;
const size = { widthPt: 500, heightPt: 700, rotate: 0 as const };

const glyphs = (text: string, top: number): Rect[] =>
  Array.from(text).map((_, i) => [0.1 + i * 0.01, top, 0.11 + i * 0.01, top + 0.04]);

/** One paragraph from 0.1 to 0.6 across the top of the page. */
const wire = (blocks = true): PdfPageText => ({
  revision: 2,
  tagged: false,
  lines: blocks
    ? [{ block: 0, text: "body", rect: [0.1, 0.1, 0.6, 0.14], glyphs: glyphs("body", 0.1) }]
    : [],
  blocks: blocks ? [{ id: 0, rect: [0.1, 0.1, 0.6, 0.2], editable: true }] : [],
});

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  ipc.pdfText.mockResolvedValue(wire());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: CSS_WIDTH,
    bottom: CSS_HEIGHT,
    width: CSS_WIDTH,
    height: CSS_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

const applied = (): Mock<PdfDoc["applyChecked"]> =>
  vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({ status: "applied", notes: [] });

async function tool(apply: Mock<PdfDoc["applyChecked"]> = applied()) {
  const doc = testDoc({ handle: HANDLE, pages: 1, pageRevisions: [0], applyChecked: apply });
  render(<TextEditTool doc={doc} page={0} size={size} cssWidth={CSS_WIDTH} />);
  await screen.findByTestId("pdf-new-text-surface-0");
  return apply;
}

const surface = () => screen.getByTestId("pdf-new-text-surface-0");
const at = (x: number, y: number) => ({ clientX: x * CSS_WIDTH, clientY: y * CSS_HEIGHT });
const press = (from: [number, number], to: [number, number] = from) => {
  fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, ...at(...from) });
  if (to !== from) fireEvent.pointerMove(surface(), { pointerId: 1, ...at(...to) });
  fireEvent.pointerUp(surface(), { pointerId: 1, ...at(...to) });
};
const box = () => screen.getByRole("textbox", { name: "New text" });
const type = (text: string) => {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter" });
};

test("a_click_where_there_is_no_text_adds_text_there_running_to_the_column", async () => {
  const apply = await tool();
  press([0.3, 0.7]);
  type("Hello World");
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = apply.mock.calls[0]?.[0] as { op: string; page: number; at: number[]; width: number };
  expect(op).toMatchObject({ op: "addText", page: 0, text: "Hello World" });
  expect(op.at[0]).toBeCloseTo(0.3);
  expect(op.at[1]).toBeCloseTo(0.7);
  expect(op.width).toBeCloseTo(0.3);
  expect(op).not.toHaveProperty("size");
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
});

test("a_drag_sets_the_width_and_its_end_takes_the_column_edge_near_it", async () => {
  const apply = await tool();
  press([0.3, 0.7], [0.595, 0.71]);
  type("Hi");
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect((apply.mock.calls[0]?.[0] as { width: number }).width).toBeCloseTo(0.3);
});

test("a_drag_far_from_the_page_widths_keeps_its_own", async () => {
  const apply = await tool();
  press([0.3, 0.7], [0.45, 0.7]);
  type("Hi");
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect((apply.mock.calls[0]?.[0] as { width: number }).width).toBeCloseTo(0.15);
});

test("a_drag_under_the_least_width_draws_the_line_as_wide_as_the_box_that_opens", async () => {
  const apply = await tool();
  // 0.02 of a 500 pt page is 10 pt, under the least width of 36 pt.
  fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, ...at(0.3, 0.7) });
  fireEvent.pointerMove(surface(), { pointerId: 1, ...at(0.32, 0.7) });
  expect(screen.getByTestId("pdf-new-text-drag").style.width).toBe("7.2%");
  fireEvent.pointerUp(surface(), { pointerId: 1, ...at(0.32, 0.7) });
  type("Hi");
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect((apply.mock.calls[0]?.[0] as { width: number }).width).toBeCloseTo(0.072);
});

test("an_empty_box_puts_nothing_on_the_page", async () => {
  const apply = await tool();
  press([0.3, 0.7]);
  type("   ");
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(apply).not.toHaveBeenCalled();
});

test("escape_lets_the_box_go_and_while_it_is_open_the_blocks_wait", async () => {
  await tool();
  press([0.3, 0.7]);
  expect(screen.getByRole("button", { name: /Edit text: body/ })).toBeDisabled();
  fireEvent.keyDown(box(), { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: /Edit text: body/ })).toBeEnabled();
});

test("a_page_with_no_text_to_follow_asks_for_a_size_and_keeps_the_text", async () => {
  ipc.pdfText.mockResolvedValue(wire(false));
  const apply = await tool(
    vi
      .fn<PdfDoc["applyChecked"]>()
      .mockResolvedValueOnce({
        status: "failed",
        error: { kind: "NoSizeForNewText", message: "no size", path: null, details: null },
      })
      .mockResolvedValueOnce({ status: "applied", notes: [] })
  );
  press([0.2, 0.2]);
  type("Hi");
  const field = await screen.findByRole("spinbutton", { name: "Size in points" });
  expect(field).toHaveValue(12);
  expect(box()).toHaveValue("Hi");
  expect(screen.getByRole("alert")).toHaveTextContent(/no text/);
  fireEvent.change(field, { target: { value: "18" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ op: "addText", size: 18 }));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
});

test("a_size_out_of_range_is_refused_under_the_field_and_nothing_is_sent", async () => {
  ipc.pdfText.mockResolvedValue(wire(false));
  const apply = await tool(
    vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({
      status: "failed",
      error: { kind: "NoSizeForNewText", message: "no size", path: null, details: null },
    })
  );
  press([0.2, 0.2]);
  type("Hi");
  const field = await screen.findByRole("spinbutton", { name: "Size in points" });
  fireEvent.change(field, { target: { value: "0" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(/from 1 to 1000/);
  expect(apply).toHaveBeenCalledTimes(1);
});

test("a_character_with_no_glyph_shows_the_engine_error_and_keeps_the_text", async () => {
  await tool(
    vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({
      status: "failed",
      error: {
        kind: "NoGlyphForCharacter",
        message: "no glyph for U+1F600",
        path: null,
        details: null,
      },
    } as ApplyOutcome)
  );
  press([0.3, 0.7]);
  type("Hi \u{1F600}");
  expect(await screen.findByRole("alert")).toHaveTextContent(/U\+1F600/);
  expect(box()).toHaveValue("Hi \u{1F600}");
});

test("a_click_on_a_block_edits_it_and_adds_nothing", async () => {
  const apply = await tool();
  fireEvent.click(screen.getByRole("button", { name: /Edit text: body/ }));
  expect(screen.getByRole("textbox", { name: "Text of the block" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "New text" })).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
