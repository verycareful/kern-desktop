// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfLink, PdfPageText, Rect } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn(), pdfLinks: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { dropPageText } from "./page-text";
import { registerPdf } from "./pdf-controller";
import { usePdfFind } from "./pdf-find";
import { useLinkPrompt } from "./pdf-link-prompt";
import { usePdfSelection } from "./pdf-selection";
import { testController, testDoc } from "./test-doc";
import { TextLayer } from "./TextLayer";

const TAB = "tab-1";
const HANDLE = 3;
const SIZE = 1000;
const W = 0.02;

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
// A link over "hello" and one in empty space.
const overText: PdfLink = { rects: [[0.1, 0.1, 0.2, 0.12]], uri: "https://example.org/a" };
const overNothing: PdfLink = { rects: [[0.5, 0.5, 0.7, 0.6]], page: 2 };
const px = (f: number) => f * SIZE;
const middle = (i: number) => ({ clientX: px(0.1 + (i + 0.5) * W), clientY: px(0.11) });

const goToPage = vi.fn();
let off: () => void = () => undefined;

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  usePdfSelection.setState({ byTab: {}, searches: {} });
  usePdfFind.setState({ byTab: {} });
  useLinkPrompt.setState({ byTab: {} });
  ipc.pdfText.mockResolvedValue(wire);
  ipc.pdfLinks.mockResolvedValue([overText, overNothing]);
  off = registerPdf(TAB, testController({ goToPage }));
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
  off();
  cleanup();
  vi.restoreAllMocks();
});

async function layer(pages = 4) {
  render(
    <TextLayer tabId={TAB} doc={testDoc({ handle: HANDLE, pages })} page={0} visible current />
  );
  await screen.findByText("hello");
  await screen.findAllByTestId("pdf-link");
  return screen.getByTestId("pdf-text-0");
}

test("a_link_of_the_page_is_a_box_over_it", async () => {
  await layer();
  const boxes = screen.getAllByTestId("pdf-link");
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toHaveAttribute("aria-label", "Link to https://example.org/a");
  expect(boxes[1]).toHaveAttribute("aria-label", "Go to page 3");
  expect(ipc.pdfLinks).toHaveBeenCalledWith(HANDLE, 0);
});

test("a_click_on_a_page_link_shows_that_page", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: px(0.6), clientY: px(0.55) });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: px(0.6), clientY: px(0.55) });
  expect(goToPage).toHaveBeenCalledWith(2);
});

test("a_click_on_a_web_link_asks_first_and_opens_nothing", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(2) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(2) });
  expect(useLinkPrompt.getState().byTab[TAB]).toBe("https://example.org/a");
  expect(goToPage).not.toHaveBeenCalled();
});

test("a_drag_over_a_link_selects_the_text_and_follows_nothing", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(0) });
  fireEvent.pointerMove(el, { pointerId: 1, ...middle(3) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(3) });
  expect(usePdfSelection.getState().byTab[TAB]).toMatchObject({ page: 0 });
  expect(useLinkPrompt.getState().byTab[TAB]).toBeUndefined();
});

test("a_press_on_a_link_let_go_far_from_it_follows_nothing", async () => {
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: px(0.6), clientY: px(0.55) });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: px(0.9), clientY: px(0.9) });
  expect(goToPage).not.toHaveBeenCalled();
});

test("the_key_follows_a_link_and_the_pointer_click_of_its_box_does_not_follow_twice", async () => {
  await layer();
  const box = screen.getAllByTestId("pdf-link")[1] as HTMLElement;
  // detail 0 is a key press; a click of the pointer has detail 1 and is the layer's.
  fireEvent.click(box, { detail: 1 });
  expect(goToPage).not.toHaveBeenCalled();
  fireEvent.click(box, { detail: 0 });
  expect(goToPage).toHaveBeenCalledTimes(1);
  expect(goToPage).toHaveBeenCalledWith(2);
});

test("a_link_to_a_file_or_to_a_page_the_document_lacks_says_so_and_goes_nowhere", async () => {
  ipc.pdfLinks.mockResolvedValue([
    { rects: [[0.1, 0.1, 0.2, 0.12]], uri: "file:///etc/passwd" },
    { rects: [[0.5, 0.5, 0.7, 0.6]], page: 40 },
  ]);
  const notify = vi.spyOn(useOps.getState(), "notify");
  const el = await layer();
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(2) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(2) });
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: px(0.6), clientY: px(0.55) });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: px(0.6), clientY: px(0.55) });
  expect(notify).toHaveBeenCalledTimes(2);
  expect(goToPage).not.toHaveBeenCalled();
  expect(useLinkPrompt.getState().byTab[TAB]).toBeUndefined();
});

test("a_page_whose_links_cannot_be_read_still_selects_its_text", async () => {
  ipc.pdfLinks.mockRejectedValue({ kind: "Panic", message: "stopped", path: null, details: null });
  render(
    <TextLayer tabId={TAB} doc={testDoc({ handle: HANDLE, pages: 1 })} page={0} visible current />
  );
  await screen.findByText("hello");
  expect(screen.queryAllByTestId("pdf-link")).toHaveLength(0);
  const el = screen.getByTestId("pdf-text-0");
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, ...middle(0) });
  fireEvent.pointerMove(el, { pointerId: 1, ...middle(2) });
  fireEvent.pointerUp(el, { pointerId: 1, ...middle(2) });
  expect(usePdfSelection.getState().byTab[TAB]).toBeDefined();
});

test("the_matches_of_find_are_boxed_and_the_current_one_stands_out", async () => {
  await layer();
  act(() => {
    usePdfFind.getState().open(TAB, "he");
    usePdfFind.getState().begin(TAB);
    usePdfFind.getState().report(TAB, 0, [
      { rects: [[0.1, 0.1, 0.14, 0.12]] },
      {
        rects: [
          [0.3, 0.3, 0.34, 0.32],
          [0.1, 0.34, 0.14, 0.36],
        ],
      },
    ]);
    usePdfFind.getState().report(TAB, 1, [{ rects: [[0.1, 0.1, 0.14, 0.12]] }]);
  });
  expect(screen.getAllByTestId("pdf-hit")).toHaveLength(2);
  expect(screen.getAllByTestId("pdf-hit-current")).toHaveLength(1);
  act(() => usePdfFind.getState().step(TAB, 1));
  // The second match has two boxes (it runs over a line break); the matches of another page are not drawn here.
  expect(screen.getAllByTestId("pdf-hit")).toHaveLength(1);
  expect(screen.getAllByTestId("pdf-hit-current")).toHaveLength(2);
  act(() => usePdfFind.getState().close(TAB));
  expect(screen.queryAllByTestId("pdf-hit")).toHaveLength(0);
});
