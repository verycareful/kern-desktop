// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi, type Mock } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { dropPageText } from "./page-text";
import { testDoc } from "./test-doc";
import { TextEditTool } from "./TextEditTool";
import type { PdfDoc } from "./usePdfDoc";

const HANDLE = 6;
const CSS_WIDTH = 1000;
const CSS_HEIGHT = 1400;
const size = { widthPt: 500, heightPt: 700, rotate: 0 as const };

const glyphs = (text: string, top: number): Rect[] =>
  Array.from(text).map((_, i) => [0.1 + i * 0.01, top, 0.11 + i * 0.01, top + 0.04]);

const wire: PdfPageText = {
  revision: 5,
  tagged: false,
  lines: [
    {
      block: 0,
      text: "first line",
      wrapped: false,
      rect: [0.1, 0.1, 0.2, 0.14],
      glyphs: glyphs("first line", 0.1),
    },
    {
      block: 1,
      text: "Title",
      wrapped: false,
      rect: [0.1, 0.5, 0.15, 0.54],
      glyphs: glyphs("Title", 0.5),
    },
  ],
  blocks: [
    { id: 0, rect: [0.1, 0.1, 0.6, 0.2], editable: true },
    { id: 1, rect: [0.1, 0.5, 0.6, 0.54], editable: false, reason: "Type3Font" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  ipc.pdfText.mockResolvedValue(wire);
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
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

async function tool() {
  const apply = vi
    .fn<PdfDoc["applyChecked"]>()
    .mockResolvedValue({ status: "applied", notes: [], revision: 1 });
  const doc = testDoc({ handle: HANDLE, pages: 1, pageRevisions: [0], applyChecked: apply });
  render(<TextEditTool doc={doc} page={0} size={size} cssWidth={CSS_WIDTH} />);
  await screen.findByTestId("pdf-new-text-surface-0");
  return apply;
}

const surface = () => screen.getByTestId("pdf-new-text-surface-0");
const at = (x: number, y: number) => ({ clientX: x * CSS_WIDTH, clientY: y * CSS_HEIGHT });
const pressAt = (x: number, y: number) => {
  fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, ...at(x, y) });
  fireEvent.pointerUp(surface(), { pointerId: 1, ...at(x, y) });
};
const openBlock = () =>
  fireEvent.click(screen.getByRole("button", { name: /Edit text: first line/ }));
const blockBox = () => screen.getByRole("textbox", { name: "Text of the block" });
const newBox = () => screen.getByRole("textbox", { name: "New text" });
const side = (which: "left" | "right") => screen.getByTestId(`pdf-box-side-${which}`);
const dragSide = (which: "left" | "right", x: number) => {
  fireEvent.pointerDown(side(which), { button: 0, pointerId: 2, ...at(0.5, 0.1) });
  fireEvent.pointerMove(side(which), { pointerId: 2, ...at(x, 0.1) });
  fireEvent.pointerUp(side(which), { pointerId: 2, ...at(x, 0.1) });
};
const keep = (box: HTMLElement) => fireEvent.keyDown(box, { key: "Enter" });
const sent = (apply: Mock<PdfDoc["applyChecked"]>) =>
  apply.mock.calls[0]?.[0] as Record<string, unknown>;

// ---- a press outside an open box ----

test("a_press_outside_a_block_box_keeps_the_typed_text_and_opens_no_other_box", async () => {
  const apply = await tool();
  openBlock();
  fireEvent.change(blockBox(), { target: { value: "new words" } });
  pressAt(0.7, 0.8);
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(apply).toHaveBeenCalledTimes(1);
  expect(sent(apply)).toMatchObject({ op: "editText", block: 0, text: "new words" });
});

test("a_press_outside_a_box_with_nothing_changed_only_closes_it_and_the_next_press_opens_a_box", async () => {
  const apply = await tool();
  openBlock();
  pressAt(0.7, 0.8);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  pressAt(0.7, 0.8);
  expect(newBox()).toBeInTheDocument();
});

test("a_press_outside_the_box_of_new_text_puts_the_text_on_the_page_and_opens_no_other_box", async () => {
  const apply = await tool();
  pressAt(0.3, 0.7);
  fireEvent.change(newBox(), { target: { value: "Hello" } });
  pressAt(0.2, 0.9);
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(apply).toHaveBeenCalledTimes(1);
  expect(sent(apply)).toMatchObject({ op: "addText", text: "Hello" });
});

test("a_press_outside_an_empty_box_of_new_text_adds_nothing_and_opens_no_other_box", async () => {
  const apply = await tool();
  pressAt(0.3, 0.7);
  pressAt(0.2, 0.9);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

test("a_press_in_the_box_does_not_leave_it", async () => {
  const apply = await tool();
  openBlock();
  fireEvent.change(blockBox(), { target: { value: "new words" } });
  fireEvent.pointerDown(blockBox(), { button: 0, pointerId: 1 });
  fireEvent.pointerDown(side("right"), { button: 0, pointerId: 1 });
  expect(blockBox()).toBeInTheDocument();
  expect(apply).not.toHaveBeenCalled();
});

test("a_press_outside_that_the_engine_refuses_keeps_the_box_and_says_why", async () => {
  const apply = await tool();
  apply.mockResolvedValue({
    status: "failed",
    error: { kind: "NoGlyphForCharacter", message: "U+1F600", path: null, details: null },
  });
  openBlock();
  fireEvent.change(blockBox(), { target: { value: "x" } });
  pressAt(0.7, 0.8);
  expect(await screen.findByRole("alert")).toHaveTextContent(/U\+1F600/);
  expect(blockBox()).toHaveValue("x");
});

// ---- Escape ----

test("escape_ends_a_drag_that_sets_a_width_and_no_box_opens", async () => {
  await tool();
  fireEvent.pointerDown(surface(), { button: 0, pointerId: 1, ...at(0.3, 0.7) });
  fireEvent.pointerMove(surface(), { pointerId: 1, ...at(0.5, 0.7) });
  expect(screen.getByTestId("pdf-new-text-drag")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByTestId("pdf-new-text-drag")).toBeNull();
  fireEvent.pointerUp(surface(), { pointerId: 1, ...at(0.5, 0.7) });
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("escape_puts_the_refusal_away", async () => {
  await tool();
  fireEvent.click(screen.getByRole("button", { name: /Text that cannot be edited: Title/ }));
  expect(screen.getByRole("dialog", { name: "Text that cannot be edited" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

// ---- the two sides of a box ----

test("the_right_side_of_the_box_of_new_text_sets_its_width", async () => {
  const apply = await tool();
  pressAt(0.2, 0.7);
  dragSide("right", 0.8);
  fireEvent.change(newBox(), { target: { value: "Hi" } });
  keep(newBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply) as { at: number[]; width: number };
  expect(op.at[0]!).toBeCloseTo(0.2);
  expect(op.width).toBeCloseTo(0.6);
});

test("the_left_side_of_the_box_of_new_text_moves_its_left_edge_and_keeps_the_right", async () => {
  const apply = await tool();
  pressAt(0.3, 0.7);
  // The box runs to the column's right edge, 0.6.
  dragSide("left", 0.1);
  fireEvent.change(newBox(), { target: { value: "Hi" } });
  keep(newBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply) as { at: number[]; width: number };
  expect(op.at[0]!).toBeCloseTo(0.1);
  expect(op.at[1]!).toBeCloseTo(0.7);
  expect(op.width).toBeCloseTo(0.5);
});

test("a_side_cannot_be_dragged_past_the_other_nor_off_the_page", async () => {
  const apply = await tool();
  pressAt(0.3, 0.7);
  dragSide("right", 0.1);
  dragSide("left", 1.4);
  fireEvent.change(newBox(), { target: { value: "Hi" } });
  keep(newBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply) as { at: number[]; width: number };
  // The least width is 36 pt of a 500 pt page.
  expect(op.width).toBeGreaterThanOrEqual(0.072 - 1e-9);
  expect(op.at[0]! + op.width).toBeLessThanOrEqual(1 + 1e-9);
});

test("the_right_side_of_the_box_of_new_text_takes_a_width_of_the_page_near_it", async () => {
  const apply = await tool();
  pressAt(0.2, 0.7);
  dragSide("right", 0.596);
  fireEvent.change(newBox(), { target: { value: "Hi" } });
  keep(newBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply) as { at: number[]; width: number };
  expect(op.at[0]! + op.width).toBeCloseTo(0.6);
});

test("a_side_with_the_focus_moves_with_the_arrow_keys", async () => {
  const apply = await tool();
  pressAt(0.2, 0.7);
  fireEvent.keyDown(side("right"), { key: "ArrowRight" });
  fireEvent.keyDown(side("right"), { key: "ArrowRight", shiftKey: true });
  fireEvent.keyDown(side("left"), { key: "ArrowLeft" });
  fireEvent.change(newBox(), { target: { value: "Hi" } });
  keep(newBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply) as { at: number[]; width: number };
  expect(op.at[0]!).toBeCloseTo(0.195);
  expect(op.at[0]! + op.width).toBeCloseTo(0.6 + 0.005 + 0.02);
});

test("the_right_side_of_a_block_box_sends_a_width_from_the_blocks_own_left_edge", async () => {
  const apply = await tool();
  openBlock();
  dragSide("right", 0.8);
  fireEvent.change(blockBox(), { target: { value: "first line, longer" } });
  keep(blockBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply);
  expect(op).toMatchObject({ op: "editText", block: 0, revision: 5, text: "first line, longer" });
  expect(op).not.toHaveProperty("left");
  expect(op.width as number).toBeCloseTo(0.7);
});

test("the_left_side_of_a_block_box_sends_the_left_edge_and_the_width_to_the_same_right_edge", async () => {
  const apply = await tool();
  openBlock();
  dragSide("left", 0.05);
  fireEvent.change(blockBox(), { target: { value: "first line!" } });
  keep(blockBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const op = sent(apply);
  expect(op.left as number).toBeCloseTo(0.05);
  expect(op.width as number).toBeCloseTo(0.55);
});

test("a_block_box_that_was_widened_is_a_change_though_the_text_is_as_it_was", async () => {
  const apply = await tool();
  openBlock();
  dragSide("right", 0.9);
  keep(blockBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(sent(apply)).toMatchObject({ op: "editText", text: "first line" });
  expect(sent(apply).width as number).toBeCloseTo(0.8);
});

test("a_block_box_whose_sides_were_not_moved_sends_neither_left_nor_width", async () => {
  const apply = await tool();
  openBlock();
  fireEvent.change(blockBox(), { target: { value: "other" } });
  keep(blockBox());
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(sent(apply)).toEqual({
    op: "editText",
    page: 0,
    block: 0,
    revision: 5,
    text: "other",
  });
});

test("a_block_box_dragged_and_put_back_is_no_change", async () => {
  const apply = await tool();
  openBlock();
  dragSide("right", 0.9);
  dragSide("right", 0.6);
  keep(blockBox());
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(apply).not.toHaveBeenCalled();
});
