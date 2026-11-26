// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfAnnotation, PdfPageText, Rect } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn(), pdfLinks: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { dropPageText } from "./page-text";
import { usePdfSelection } from "./pdf-selection";
import { usePdfTool } from "./pdf-tool";
import { testDoc } from "./test-doc";
import { TextLayer } from "./TextLayer";

const TAB = "tab-1";
const HANDLE = 3;
const SIZE = 1000;
const W = 0.02;
const ID = { object: 7, generation: 0 };

// "hello" at x 0.1 to 0.2, y 0.1 to 0.12; the layer is 1000 by 1000.
const glyphs: Rect[] = Array.from("hello").map((_, i) => [
  0.1 + i * W,
  0.1,
  0.1 + (i + 1) * W,
  0.12,
]);
const wire: PdfPageText = {
  revision: 1,
  lines: [{ block: 0, text: "hello", wrapped: false, rect: [0.1, 0.1, 0.2, 0.12], glyphs }],
  blocks: [],
  tagged: false,
};
const highlight: PdfAnnotation = {
  id: ID,
  kind: "Highlight",
  subtype: null,
  drawn_by_library: true,
  rect: [0.1, 0.1, 0.2, 0.12],
  quads: [[0.1, 0.1, 0.2, 0.12]],
  strokes: [],
  contents: null,
  author: null,
  colour: [1, 1, 0],
  opacity: null,
  line_width: null,
  flags: 4,
};
const ink: PdfAnnotation = {
  ...highlight,
  id: { object: 8, generation: 0 },
  kind: "Ink",
  rect: [0.5, 0.5, 0.9, 0.5],
  quads: [],
  strokes: [
    [
      [0.5, 0.5],
      [0.9, 0.5],
    ],
  ],
};
const px = (f: number) => f * SIZE;
const middle = (i: number) => ({ clientX: px(0.1 + (i + 0.5) * W), clientY: px(0.11) });

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  usePdfSelection.setState({ byTab: {}, searches: {} });
  usePdfTool.setState({ byTab: {}, listed: { [TAB]: { 0: [highlight, ink] } } });
  ipc.pdfText.mockResolvedValue(wire);
  ipc.pdfLinks.mockResolvedValue([]);
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function layer() {
  render(
    <TextLayer tabId={TAB} doc={testDoc({ handle: HANDLE, pages: 1 })} page={0} visible current />
  );
  await screen.findByText("hello");
  return screen.getByTestId("pdf-text-0");
}

const picked = () => usePdfTool.getState().byTab[TAB]?.picked ?? null;

test("a_click_on_text_that_is_highlighted_picks_the_highlight", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(2) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(2) });
  expect(picked()).toEqual({ page: 0, id: ID });
  // The click did not leave text selected.
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
});

test("a_drag_across_a_highlight_still_selects_the_text_under_it", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(0) });
  fireEvent.pointerMove(el, { pointerId: 1, ...middle(4) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(4) });
  expect(usePdfSelection.getState().byTab[TAB]).toMatchObject({
    from: { line: 0, unit: 0 },
    to: { line: 0, unit: 4 },
  });
  expect(picked()).toBeNull();
});

test("a_click_on_an_ink_line_off_the_text_picks_it_and_a_click_on_nothing_puts_it_down", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: px(0.7), clientY: px(0.502) });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: px(0.7), clientY: px(0.502) });
  expect(picked()).toEqual({ page: 0, id: ink.id });

  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: px(0.7), clientY: px(0.8) });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: px(0.7), clientY: px(0.8) });
  expect(picked()).toBeNull();
});

test("selecting_text_puts_down_a_picked_annotation", async () => {
  const el = await layer();
  act(() => usePdfTool.getState().pick(TAB, { page: 0, id: ink.id! }));
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(0) });
  expect(picked()).toBeNull();
});

test("note_in_the_selection_menu_starts_a_note_on_the_selected_text_and_not_a_note_at_a_point", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(0) });
  fireEvent.pointerMove(el, { pointerId: 1, ...middle(4) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(4) });
  fireEvent.click(await screen.findByRole("button", { name: "Note" }));
  await waitFor(() => expect(usePdfTool.getState().byTab[TAB]?.draft).not.toBeNull());
  expect(usePdfTool.getState().byTab[TAB]?.draft).toMatchObject({
    kind: "markup",
    page: 0,
    rects: [[expect.closeTo(0.1), 0.1, expect.closeTo(0.2), 0.12]],
  });
  // The text was let go, as it is for a highlight.
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
});
