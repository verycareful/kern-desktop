// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn(), clipText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { dropPageText } from "./page-text";
import { usePdfSelection } from "./pdf-selection";
import { testDoc } from "./test-doc";
import { TextLayer } from "./TextLayer";

const TAB = "tab-1";
const HANDLE = 3;
const W = 0.02;
const SIZE = 1000;

// "hello" on a page, glyph `i` at x 0.1 + i * 0.02, y 0.1 to 0.12; the layer is 1000 by 1000.
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
const px = (fraction: number) => fraction * SIZE;
// The middle of glyph `i`.
const at = (i: number) => ({ clientX: px(0.1 + (i + 0.5) * W), clientY: px(0.11) });

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  usePdfSelection.setState({ byTab: {}, searches: {} });
  ipc.pdfText.mockResolvedValue(wire);
  ipc.clipText.mockResolvedValue(undefined);
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

async function layer(over: { visible?: boolean; pageRevisions?: number[] } = {}) {
  const doc = testDoc({ handle: HANDLE, pages: 1, pageRevisions: over.pageRevisions ?? [0] });
  const view = render(
    <TextLayer tabId={TAB} doc={doc} page={0} visible={over.visible ?? true} current />
  );
  return { doc, view, layer: screen.getByTestId("pdf-text-0") };
}

async function drag(el: HTMLElement, from: number, to: number) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...at(from) });
  fireEvent.pointerMove(el, { pointerId: 1, ...at(to) });
  fireEvent.pointerUp(el, { pointerId: 1, ...at(to) });
}

test("drag_selects_and_shows_the_menu_at_the_selection", async () => {
  const { layer: el } = await layer();
  await screen.findByText("hello");
  await drag(el, 1, 3);
  expect(usePdfSelection.getState().byTab[TAB]).toEqual({
    page: 0,
    from: { line: 0, unit: 1 },
    to: { line: 0, unit: 3 },
  });
  const boxes = screen.getAllByTestId("pdf-selection");
  expect(boxes).toHaveLength(1);
  expect(boxes[0]).toHaveStyle({ left: "12%", width: "6%" });
  // The menu stands at the end of the selection: its right edge, under its last line.
  const menu = screen.getByRole("toolbar", { name: "Selected text" });
  expect(menu).toHaveStyle({ left: "18%", top: "12%" });
  expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search for it" })).toBeInTheDocument();
});

test("the_menu_waits_for_the_pointer_to_be_let_go", async () => {
  const { layer: el } = await layer();
  await screen.findByText("hello");
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...at(1) });
  fireEvent.pointerMove(el, { pointerId: 1, ...at(3) });
  expect(screen.queryByRole("toolbar", { name: "Selected text" })).toBeNull();
  fireEvent.pointerUp(el, { pointerId: 1, ...at(3) });
  expect(screen.getByRole("toolbar", { name: "Selected text" })).toBeInTheDocument();
});

test("escape_clears_the_selection", async () => {
  const { layer: el } = await layer();
  await screen.findByText("hello");
  await drag(el, 0, 2);
  expect(usePdfSelection.getState().byTab[TAB]).toBeDefined();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
  expect(screen.queryByTestId("pdf-selection")).toBeNull();
  expect(screen.queryByRole("toolbar", { name: "Selected text" })).toBeNull();
});

test("a_click_selects_nothing_and_ends_a_selection", async () => {
  const { layer: el } = await layer();
  await screen.findByText("hello");
  await drag(el, 0, 2);
  // A press that does not travel is a click.
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...at(1) });
  fireEvent.pointerUp(el, { pointerId: 1, ...at(1) });
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
});

test("a_press_off_the_text_ends_a_selection_and_starts_none", async () => {
  const { layer: el } = await layer();
  await screen.findByText("hello");
  await drag(el, 0, 2);
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: px(0.8), clientY: px(0.8) });
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
  expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledTimes(1);
});

test("dragging_off_the_text_keeps_the_nearest_end", async () => {
  const { layer: el } = await layer();
  await screen.findByText("hello");
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...at(1) });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: px(0.9), clientY: px(0.9) });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: px(0.9), clientY: px(0.9) });
  expect(usePdfSelection.getState().byTab[TAB]?.to).toEqual({ line: 0, unit: 4 });
});

test("a_page_that_is_not_near_the_view_is_not_read", async () => {
  await layer({ visible: false });
  expect(ipc.pdfText).not.toHaveBeenCalled();
});

test("a_page_whose_text_cannot_be_read_says_so", async () => {
  ipc.pdfText.mockRejectedValue({ kind: "Panic", message: "the reader stopped" });
  await layer();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The text of page 1 could not be read: Panic: the reader stopped"
  );
});

test("an_edit_to_the_page_drops_its_selection_and_reads_the_text_again", async () => {
  const { view, doc } = await layer();
  await screen.findByText("hello");
  await drag(screen.getByTestId("pdf-text-0"), 0, 2);
  expect(ipc.pdfText).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.rerender(
      <TextLayer
        tabId={TAB}
        doc={{ ...doc, revision: 1, pageRevisions: [1] }}
        page={0}
        visible
        current
      />
    );
  });
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
  expect(ipc.pdfText).toHaveBeenCalledTimes(2);
});

test("the_selection_of_another_page_is_not_drawn_here", async () => {
  await layer();
  await screen.findByText("hello");
  act(() =>
    usePdfSelection.getState().select(TAB, {
      page: 2,
      from: { line: 0, unit: 0 },
      to: { line: 0, unit: 2 },
    })
  );
  expect(screen.queryByTestId("pdf-selection")).toBeNull();
  expect(screen.queryByRole("toolbar", { name: "Selected text" })).toBeNull();
});
