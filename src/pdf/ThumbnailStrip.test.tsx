// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  pdfRenderSize: vi.fn(),
  pdfRender: vi.fn(),
  pdfCancelJob: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useTabs } from "../store/tabs";
import { usePageSelection } from "./page-selection";
import { registerPdf, type PdfController } from "./pdf-controller";
import { usePdfView } from "./pdf-view";
import { ThumbnailStrip } from "./ThumbnailStrip";
import { THUMB_WIDTH, thumbCache } from "./thumb-cache";
import type { PageSize } from "./page-geometry";
import { testController, testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

let intersections: { callback: IntersectionObserverCallback; targets: Set<Element> }[] = [];
class FakeIntersectionObserver {
  private record;
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, targets: new Set<Element>() };
    intersections.push(this.record);
  }
  observe(el: Element) {
    this.record.targets.add(el);
  }
  unobserve(el: Element) {
    this.record.targets.delete(el);
  }
  disconnect() {
    this.record.targets.clear();
  }
}

const doc = (over: Partial<PdfDoc> = {}): PdfDoc => testDoc({ pages: 5, ...over });
const sizes = (n = 5): PageSize[] =>
  Array.from({ length: n }, () => ({ widthPt: 600, heightPt: 800, rotate: 0 }));

const controller = (goToPage = vi.fn()): PdfController => testController({ goToPage });

beforeEach(() => {
  vi.clearAllMocks();
  intersections = [];
  usePdfView.setState({ byTab: {} });
  usePageSelection.setState({ byTab: {} });
  thumbCache.dropDocument(3);
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  ipc.pdfRenderSize.mockImplementation(async (_h, _p, _r, widthPx: number) => ({
    width: widthPx,
    height: 2,
    bytes: widthPx * 8,
  }));
  ipc.pdfRender.mockImplementation(
    async (_h, _p, _r, widthPx: number) => new Uint8Array(widthPx * 8)
  );
  ipc.pdfCancelJob.mockResolvedValue({ running: true });
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const strip = (over: Partial<PdfDoc> = {}, n = 5, horizontal = false) =>
  render(
    <ThumbnailStrip
      tabId="t1"
      doc={doc(over)}
      sizes={sizes(n)}
      sizesAt={0}
      horizontal={horizontal}
    />
  );

// The strip's observer reports these pages as within reach.
const reach = (pages: number[], isIntersecting = true) => {
  const io = intersections[intersections.length - 1];
  if (!io) throw new Error("no observer");
  const boxes = [...io.targets];
  act(() =>
    io.callback(
      pages.map(
        (page) => ({ target: boxes[page], isIntersecting }) as unknown as IntersectionObserverEntry
      ),
      io as unknown as IntersectionObserver
    )
  );
};

test("clicking_a_thumbnail_scrolls_to_its_page", () => {
  const goToPage = vi.fn();
  const off = registerPdf("t1", controller(goToPage));
  strip();
  fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
  expect(goToPage).toHaveBeenCalledExactlyOnceWith(2);
  off();
});

test("renders_thumbnails_lazily_for_visible_items_only", async () => {
  strip({}, 40);
  expect(screen.getAllByRole("button")).toHaveLength(40);
  expect(ipc.pdfRender).not.toHaveBeenCalled();
  reach([0, 1]);
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(2));
  const drawn = ipc.pdfRender.mock.calls.map((c) => c[1]).sort();
  expect(drawn).toEqual([0, 1]);
  // The whole page, at the thumbnail's width.
  expect(ipc.pdfRender.mock.calls[0]?.[2]).toEqual([0, 0, 1, 1]);
  expect(ipc.pdfRender.mock.calls[0]?.[3]).toBe(THUMB_WIDTH);
  expect(document.querySelectorAll("canvas")).toHaveLength(2);
});

test("a_thumbnail_that_scrolls_away_mid_draw_is_cancelled_and_its_canvas_dropped", async () => {
  let release: (bytes: Uint8Array) => void = () => undefined;
  ipc.pdfRender.mockImplementation(() => new Promise<Uint8Array>((resolve) => (release = resolve)));
  strip();
  reach([0]);
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(1));
  const job = ipc.pdfRender.mock.calls[0]?.[4];
  reach([0], false);
  await waitFor(() => expect(ipc.pdfCancelJob).toHaveBeenCalledWith(job));
  expect(document.querySelectorAll("canvas")).toHaveLength(0);
  // The answer that arrives afterwards is not kept.
  await act(async () => release(new Uint8Array(THUMB_WIDTH * 8)));
  expect(thumbCache.size).toBe(0);
});

test("a_thumbnail_drawn_before_comes_from_the_cache_and_a_new_revision_of_the_page_draws_again", async () => {
  const { rerender } = strip();
  reach([1]);
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(thumbCache.size).toBe(1));
  reach([1], false);
  reach([1]);
  await act(async () => undefined);
  expect(ipc.pdfRender).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll("canvas")).toHaveLength(1);
  rerender(
    <ThumbnailStrip
      tabId="t1"
      doc={doc({ revision: 1, pageRevisions: [0, 1, 0, 0, 0] })}
      sizes={sizes()}
      sizesAt={1}
      horizontal={false}
    />
  );
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(2));
});

test("an_edit_to_one_page_draws_no_other_thumbnail_again", async () => {
  const { rerender } = strip();
  reach([0, 1, 2]);
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(3));
  rerender(
    <ThumbnailStrip
      tabId="t1"
      doc={doc({ revision: 1, pageRevisions: [0, 1, 0, 0, 0] })}
      sizes={sizes()}
      sizesAt={1}
      horizontal={false}
    />
  );
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(4));
  await act(async () => undefined);
  expect(ipc.pdfRender).toHaveBeenCalledTimes(4);
});

test("a_thumbnail_waits_for_the_sizes_of_the_edit_before_it_draws", async () => {
  const { rerender } = strip();
  reach([1]);
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(1));
  // The page changed at revision 1 and the sizes are still those of revision 0.
  rerender(
    <ThumbnailStrip
      tabId="t1"
      doc={doc({ revision: 1, pageRevisions: [0, 1, 0, 0, 0] })}
      sizes={sizes()}
      sizesAt={0}
      horizontal={false}
    />
  );
  await act(async () => undefined);
  expect(ipc.pdfRender).toHaveBeenCalledTimes(1);
  rerender(
    <ThumbnailStrip
      tabId="t1"
      doc={doc({ revision: 1, pageRevisions: [0, 1, 0, 0, 0] })}
      sizes={sizes()}
      sizesAt={1}
      horizontal={false}
    />
  );
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(2));
});

test("the_page_in_view_is_marked_and_is_the_one_tab_stop", () => {
  usePdfView.getState().patch("t1", { page: 2, pages: 5 });
  strip();
  const marked = screen.getByRole("button", { name: "Page 3" });
  expect(marked).toHaveAttribute("aria-current", "page");
  expect(marked).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("button", { name: "Page 1" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("tabindex", "-1");
  act(() => usePdfView.getState().patch("t1", { page: 4 }));
  expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page");
  expect(marked).not.toHaveAttribute("aria-current");
});

test("the_arrow_keys_move_focus_along_the_strip_and_stop_at_its_ends", () => {
  strip();
  const first = screen.getByRole("button", { name: /^Page 1(,|$)/ });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: /^Page 2(,|$)/ })).toHaveFocus();
  fireEvent.keyDown(document.activeElement as Element, { key: "End" });
  expect(screen.getByRole("button", { name: /^Page 5(,|$)/ })).toHaveFocus();
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: /^Page 5(,|$)/ })).toHaveFocus();
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  expect(first).toHaveFocus();
});

test("along_the_bottom_the_strip_is_a_row_and_the_side_arrows_move_focus", () => {
  strip({}, 5, true);
  expect(screen.getByTestId("pdf-thumbs")).toHaveClass("kern-pdf-thumbs-row");
  const first = screen.getByRole("button", { name: /^Page 1(,|$)/ });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: /^Page 2(,|$)/ })).toHaveFocus();
});

test("a_thumbnail_the_engine_could_not_draw_says_so", async () => {
  ipc.pdfRender.mockRejectedValue({
    kind: "Io",
    message: "no pixels",
    path: null,
    details: null,
  });
  strip();
  reach([0]);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not be drawn");
  expect(screen.getByRole("alert")).toHaveAttribute("title", "Io: no pixels");
});

test("a_thumbnail_is_as_tall_as_its_page_is_to_its_width", () => {
  render(
    <ThumbnailStrip
      tabId="t1"
      doc={doc()}
      sizes={[{ widthPt: 400, heightPt: 800, rotate: 0 }]}
      sizesAt={0}
      horizontal={false}
    />
  );
  const box = document.querySelector<HTMLElement>(".kern-pdf-thumb");
  expect(box?.style.width).toBe(`${THUMB_WIDTH}px`);
  expect(box?.style.height).toBe(`${THUMB_WIDTH * 2}px`);
});

test("a_strip_with_no_sizes_yet_shows_no_thumbnails", () => {
  render(<ThumbnailStrip tabId="t1" doc={doc()} sizes={null} sizesAt={0} horizontal={false} />);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

const chosen = () => usePageSelection.getState().byTab["t1"]?.pages ?? [];

test("a_plain_click_chooses_the_page_and_ctrl_and_shift_choose_more_without_moving_the_view", () => {
  const goToPage = vi.fn();
  const off = registerPdf("t1", controller(goToPage));
  strip();
  fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
  expect(chosen()).toEqual([1]);
  expect(goToPage).toHaveBeenCalledWith(1);
  goToPage.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Page 4" }), { ctrlKey: true });
  expect(chosen()).toEqual([1, 3]);
  fireEvent.click(screen.getByRole("button", { name: "Page 5" }), { shiftKey: true });
  expect(chosen()).toEqual([3, 4]);
  expect(goToPage).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Page 4, chosen" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  off();
});

test("an_arrow_moves_the_chosen_page_and_the_view_with_the_focus_so_one_thumbnail_is_marked", () => {
  const goToPage = vi.fn();
  const off = registerPdf("t1", controller(goToPage));
  strip();
  const first = screen.getByRole("button", { name: "Page 2" });
  fireEvent.click(first);
  goToPage.mockClear();
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: "Page 3, chosen" })).toHaveFocus();
  expect(chosen()).toEqual([2]);
  expect(goToPage).toHaveBeenCalledWith(2);
  fireEvent.keyDown(document.activeElement as Element, { key: "End" });
  expect(chosen()).toEqual([4]);
  expect(goToPage).toHaveBeenLastCalledWith(4);
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  expect(chosen()).toEqual([0]);
  expect(goToPage).toHaveBeenLastCalledWith(0);
  // At the end of the strip nothing moves, so nothing is chosen anew.
  goToPage.mockClear();
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
  expect(chosen()).toEqual([0]);
  expect(goToPage).not.toHaveBeenCalled();
  off();
});

test("shift_with_an_arrow_chooses_the_run_the_focus_travels", () => {
  strip();
  fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
  const first = screen.getByRole("button", { name: "Page 2, chosen" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true });
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown", shiftKey: true });
  expect(chosen()).toEqual([1, 2, 3]);
});

test("delete_removes_the_chosen_pages_through_the_controller", () => {
  const removeSelection = vi.fn();
  const off = registerPdf("t1", testController({ removeSelection }));
  strip();
  const button = screen.getByRole("button", { name: "Page 2" });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Delete" });
  expect(removeSelection).toHaveBeenCalledTimes(1);
  off();
});

function menuOn(page: number) {
  fireEvent.contextMenu(screen.getByRole("button", { name: new RegExp(`^Page ${page}(,|$)`) }));
  return screen.getByRole("menu");
}

test("the_context_menu_rotates_and_removes_the_selected_pages", () => {
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openDoc({ k: "Utf8", v: "/a/book.pdf" }, "pdf");
  const tabId = useTabs.getState().activeId as string;
  const rotate = vi.fn();
  const removeSelection = vi.fn();
  const off = registerPdf(tabId, testController({ rotate, removeSelection }));
  render(
    <ThumbnailStrip tabId={tabId} doc={doc()} sizes={sizes()} sizesAt={0} horizontal={false} />
  );
  fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Page 3" }), { ctrlKey: true });
  const menu = menuOn(3);
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Rotate chosen pages clockwise/ }));
  expect(rotate).toHaveBeenCalledWith(90, "selection");
  fireEvent.contextMenu(screen.getByRole("button", { name: "Page 3, chosen" }));
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: /Remove chosen pages/ })
  );
  expect(removeSelection).toHaveBeenCalledTimes(1);
  // The right click on a page that was chosen kept the choice of both pages.
  expect(usePageSelection.getState().byTab[tabId]?.pages).toEqual([1, 2]);
  off();
});

test("a_right_click_on_a_page_that_is_not_chosen_chooses_it_alone", () => {
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openDoc({ k: "Utf8", v: "/a/book.pdf" }, "pdf");
  const tabId = useTabs.getState().activeId as string;
  const off = registerPdf(tabId, testController());
  render(
    <ThumbnailStrip tabId={tabId} doc={doc()} sizes={sizes()} sizesAt={0} horizontal={false} />
  );
  fireEvent.click(screen.getByRole("button", { name: "Page 1" }));
  menuOn(4);
  expect(usePageSelection.getState().byTab[tabId]?.pages).toEqual([3]);
  off();
});

test("dragging_a_thumbnail_reorders_the_page_and_chooses_it_where_it_lands", async () => {
  const reorderPages = vi.fn(async () => undefined);
  strip({ reorderPages });
  const items = screen.getAllByRole("listitem");
  const box = screen.getByTestId("pdf-thumbs");
  const r = (l: number, t: number, w: number, h: number) =>
    ({
      left: l,
      top: t,
      right: l + w,
      bottom: t + h,
      width: w,
      height: h,
      x: l,
      y: t,
      toJSON: () => ({}),
    }) as DOMRect;
  box.getBoundingClientRect = () => r(0, 0, 130, 600);
  items.forEach((el, i) => {
    el.getBoundingClientRect = () => r(0, i * 110, 120, 100);
  });
  const button = screen.getByRole("button", { name: "Page 1" });
  fireEvent.pointerDown(button, { button: 0, clientX: 60, clientY: 50 });
  // Into the gap before the fourth page (the upper half of it).
  fireEvent.pointerMove(window, { clientX: 60, clientY: 340 });
  fireEvent.pointerUp(window, { clientX: 60, clientY: 340 });
  // Gap 3 after taking page 0 out of the way: page 0 ends at 2.
  expect(reorderPages).toHaveBeenCalledWith(0, 2);
  await waitFor(() => expect(chosen()).toEqual([2]));
});

test("a_drag_is_not_started_when_the_pages_cannot_be_changed", () => {
  const reorderPages = vi.fn(async () => undefined);
  strip({ reorderPages, canEdit: false });
  const button = screen.getByRole("button", { name: "Page 1" });
  fireEvent.pointerDown(button, { button: 0, clientX: 60, clientY: 50 });
  fireEvent.pointerMove(window, { clientX: 60, clientY: 340 });
  fireEvent.pointerUp(window, { clientX: 60, clientY: 340 });
  expect(reorderPages).not.toHaveBeenCalled();
});
