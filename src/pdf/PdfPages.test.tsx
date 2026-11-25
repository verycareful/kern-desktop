// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfPageInfo } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfPageInfo: vi.fn(),
  pdfRenderSize: vi.fn(),
  pdfRender: vi.fn(),
  pdfCancelJob: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useViewSettings } from "../files/view-settings";
import { PAGE_GAP, PAGE_MARGIN, CSS_PX_PER_PT } from "./page-geometry";
import { PdfPages } from "./PdfPages";
import { pdfController } from "./pdf-controller";
import { usePdfView } from "./pdf-view";
import { usePageSizes } from "./usePageSizes";
import { testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

// jsdom does no layout: the view is given a size, the observers are driven by hand.
const VIEW = { width: 632, height: 700 };
let intersections: {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  targets: Set<Element>;
}[] = [];

class FakeIntersectionObserver {
  private record;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.record = { callback, options, targets: new Set<Element>() };
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

class FakeResizeObserver {
  constructor(_callback: () => void) {}
  observe() {}
  disconnect() {}
}

const info = (width_pt: number, height_pt: number): PdfPageInfo => ({
  width_pt,
  height_pt,
  rotate: 0,
  crop_box: [0, 0, width_pt, height_pt],
});

const doc = (over: Partial<PdfDoc> = {}): PdfDoc => testDoc(over);

beforeEach(() => {
  vi.clearAllMocks();
  intersections = [];
  usePdfView.setState({ byTab: {} });
  useViewSettings.setState({ pdfLayout: "scroll", pdfGridAcross: 4 });
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(VIEW.width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(VIEW.height);
  ipc.pdfPageInfo.mockResolvedValue(info(600, 800));
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

// The pages are given their sizes by the viewer that holds them, as `usePageSizes` reads them.
function Pages(props: { doc: PdfDoc }) {
  const { handle, pages, revision } = props.doc;
  const { sizes, readAt, error } = usePageSizes(handle, pages, revision);
  return (
    <PdfPages tabId="t1" doc={props.doc} active sizes={sizes} sizesAt={readAt} sizeError={error} />
  );
}

const pages = async (over: Partial<PdfDoc> = {}) => {
  const view = render(<Pages doc={doc(over)} />);
  await screen.findByTestId("pdf-pages");
  return view;
};

const zoomOf = () => Number(screen.getByTestId("pdf-pages").dataset.zoom);
const scrollTo = (top: number) => {
  const el = screen.getByTestId("pdf-scroll");
  el.scrollTop = top;
  fireEvent.scroll(el);
  return el;
};
const near = (...which: number[]) => {
  const io = intersections[intersections.length - 1];
  if (!io) throw new Error("no observer");
  const boxes = [...io.targets];
  act(() =>
    io.callback(
      boxes.map((target) => ({
        target,
        isIntersecting: which.includes(Number((target as HTMLElement).dataset.page)),
      })) as IntersectionObserverEntry[],
      {} as IntersectionObserver
    )
  );
};

test("every_page_is_a_box_of_its_own_size_before_any_is_drawn", async () => {
  ipc.pdfPageInfo.mockImplementation(async (_h, page: number) => info(600, 800 + page * 100));
  await pages();
  const second = screen.getByRole("group", { name: "Page 2" });
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  expect(second.style.width).toBe(`${600 * scale}px`);
  expect(second.style.height).toBe(`${900 * scale}px`);
  expect(second.style.top).toBe(`${PAGE_MARGIN + 800 * scale + PAGE_GAP}px`);
  expect(ipc.pdfRender).not.toHaveBeenCalled();
});

test("the_default_zoom_fits_the_width", async () => {
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  expect(zoomOf()).toBeCloseTo(scale / CSS_PX_PER_PT, 10);
  expect(usePdfView.getState().byTab["t1"]?.zoom).toBeCloseTo(scale / CSS_PX_PER_PT, 10);
});

test("only_the_pages_near_the_view_are_drawn", async () => {
  await pages();
  near(0, 1);
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(2));
  expect(ipc.pdfRender.mock.calls.map((c) => c[1]).sort()).toEqual([0, 1]);

  near(1);
  await waitFor(() => expect(ipc.pdfCancelJob).not.toHaveBeenCalled());
  expect(screen.getByTestId("pdf-page-0").querySelector("canvas")).toBeNull();
  expect(screen.getByTestId("pdf-page-1").querySelector("canvas")).not.toBeNull();
});

test("the_observer_looks_one_screen_beyond_the_view", async () => {
  await pages();
  expect(intersections[intersections.length - 1]?.options?.rootMargin).toBe(`${VIEW.height}px 0px`);
});

test("zoom_in_and_out_step_by_a_quarter_and_stop_at_the_ends", async () => {
  await pages();
  const controller = pdfController("t1");
  act(() => controller?.zoomIn());
  const first = zoomOf();
  expect(first % 0.25).toBeCloseTo(0, 10);
  act(() => controller?.zoomIn());
  expect(zoomOf()).toBeCloseTo(first + 0.25, 10);
  for (let i = 0; i < 30; i += 1) act(() => controller?.zoomIn());
  expect(zoomOf()).toBe(5);
  for (let i = 0; i < 40; i += 1) act(() => controller?.zoomOut());
  expect(zoomOf()).toBe(0.25);
});

test("zoom_in_from_a_fit_lands_on_the_next_step_above_it", async () => {
  await pages();
  const fit = zoomOf();
  act(() => pdfController("t1")?.zoomIn());
  expect(zoomOf()).toBe(Math.floor(fit / 0.25 + 1e-9) * 0.25 + 0.25);
});

test("fit_width_returns_to_the_fit_from_any_zoom", async () => {
  await pages();
  const fit = zoomOf();
  act(() => pdfController("t1")?.zoomIn());
  act(() => pdfController("t1")?.zoomIn());
  act(() => pdfController("t1")?.zoomFit());
  expect(zoomOf()).toBeCloseTo(fit, 10);
});

test("ctrl_and_the_wheel_zoom_and_the_wheel_alone_scrolls", async () => {
  await pages();
  const scroll = screen.getByTestId("pdf-scroll");
  const fit = zoomOf();

  const plain = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
  scroll.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(false);
  expect(zoomOf()).toBe(fit);

  const up = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true });
  act(() => void scroll.dispatchEvent(up));
  expect(up.defaultPrevented).toBe(true);
  expect(zoomOf()).toBeGreaterThan(fit);

  const before = zoomOf();
  act(
    () =>
      void scroll.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, cancelable: true })
      )
  );
  expect(zoomOf()).toBeLessThan(before);
});

test("small_wheel_turns_add_up_to_a_step", async () => {
  await pages();
  const scroll = screen.getByTestId("pdf-scroll");
  const fit = zoomOf();
  for (let i = 0; i < 3; i += 1) {
    act(
      () =>
        void scroll.dispatchEvent(
          new WheelEvent("wheel", { deltaY: -30, ctrlKey: true, cancelable: true })
        )
    );
  }
  expect(zoomOf()).toBe(fit);
  act(
    () =>
      void scroll.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -30, ctrlKey: true, cancelable: true })
      )
  );
  expect(zoomOf()).toBeGreaterThan(fit);
});

test("the_page_counter_follows_the_scroll", async () => {
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  const pageHeight = 800 * scale;
  scrollTo(PAGE_MARGIN + 2 * (pageHeight + PAGE_GAP) + 1);
  expect(usePdfView.getState().byTab["t1"]).toMatchObject({ page: 2, pages: 4 });
  scrollTo(0);
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(0);
});

test("go_to_page_scrolls_to_the_top_of_that_page", async () => {
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  act(() => pdfController("t1")?.askGoToPage());
  const field = await screen.findByRole("textbox", { name: /^Page \(1 to/ });
  fireEvent.change(field, { target: { value: "3" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBeCloseTo(
    PAGE_MARGIN + 2 * (800 * scale + PAGE_GAP),
    6
  );
  expect(usePdfView.getState().byTab["t1"]).toMatchObject({ page: 2, goTo: false });
  expect(screen.queryByTestId("go-to-page")).toBeNull();
});

test("go_to_page_refuses_a_page_the_file_does_not_have_and_stays_open", async () => {
  await pages();
  act(() => pdfController("t1")?.askGoToPage());
  const field = await screen.findByRole("textbox", { name: /^Page \(1 to/ });
  fireEvent.change(field, { target: { value: "5" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.getByRole("alert")).toHaveTextContent("This file has pages 1 to 4.");
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBe(0);
  expect(usePdfView.getState().byTab["t1"]?.goTo).toBe(true);
});

test("a_zoom_keeps_the_page_in_view_where_it_was", async () => {
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  const height = 800 * scale;
  scrollTo(PAGE_MARGIN + 2 * (height + PAGE_GAP) + height / 2);
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(2);
  act(() => pdfController("t1")?.zoomIn());
  const after = Number(screen.getByTestId("pdf-pages").dataset.zoom) * CSS_PX_PER_PT;
  const h = 800 * after;
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBeCloseTo(
    PAGE_MARGIN + 2 * (h + PAGE_GAP) + h / 2,
    4
  );
});

test("a_document_at_the_top_stays_at_the_top_when_zoomed", async () => {
  await pages();
  act(() => pdfController("t1")?.zoomIn());
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBe(0);
});

test("the_actions_reach_the_viewer_only_while_it_is_mounted", async () => {
  const { unmount } = await pages();
  expect(pdfController("t1")).toBeDefined();
  unmount();
  expect(pdfController("t1")).toBeUndefined();
  expect(usePdfView.getState().byTab["t1"]).toBeUndefined();
});

test("a_failed_measure_is_said_and_not_left_as_a_blank_view", async () => {
  ipc.pdfPageInfo.mockRejectedValue({
    kind: "UnknownHandle",
    message: "no such document",
    path: null,
    details: null,
  });
  render(<Pages doc={doc()} />);
  expect(await screen.findByTestId("pdf-sizes-failed")).toHaveTextContent(
    "UnknownHandle: no such document"
  );
});

test("a_page_wider_than_the_view_is_scrolled_sideways_not_cut", async () => {
  await pages();
  for (let i = 0; i < 6; i += 1) act(() => pdfController("t1")?.zoomIn());
  const content = screen.getByTestId("pdf-pages");
  expect(parseFloat(content.style.width)).toBeGreaterThan(VIEW.width);
});

// A layout is a setting that every PDF follows: the tests set it as the settings store would.
const setLayout = (pdfLayout: "scroll" | "single" | "spread" | "grid", pdfGridAcross = 4) =>
  act(() => useViewSettings.setState({ pdfLayout, pdfGridAcross }));

test("a_spread_sets_two_pages_side_by_side_and_fits_the_pair_to_the_view", async () => {
  useViewSettings.setState({ pdfLayout: "spread" });
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN - PAGE_GAP) / (2 * 600);
  const first = screen.getByRole("group", { name: "Page 1" });
  const second = screen.getByRole("group", { name: "Page 2" });
  const third = screen.getByRole("group", { name: "Page 3" });
  expect(parseFloat(first.style.width)).toBeCloseTo(600 * scale, 6);
  expect(first.style.top).toBe(second.style.top);
  expect(parseFloat(second.style.left) - parseFloat(first.style.left)).toBeCloseTo(
    600 * scale + PAGE_GAP,
    6
  );
  expect(parseFloat(third.style.top)).toBeCloseTo(PAGE_MARGIN + 800 * scale + PAGE_GAP, 6);
  expect(third.style.left).toBe(first.style.left);
});

test("a_grid_sets_the_pages_in_rows_of_its_columns", async () => {
  useViewSettings.setState({ pdfLayout: "grid", pdfGridAcross: 3 });
  await pages({ pages: 5 });
  const scale = (VIEW.width - 2 * PAGE_MARGIN - 2 * PAGE_GAP) / (3 * 600);
  const tops = [1, 2, 3, 4, 5].map((n) =>
    parseFloat(screen.getByRole("group", { name: `Page ${n}` }).style.top)
  );
  expect(tops[0]).toBeCloseTo(tops[2] ?? NaN, 6);
  expect(tops[3]).toBeCloseTo(PAGE_MARGIN + 800 * scale + PAGE_GAP, 6);
  expect(tops[4]).toBeCloseTo(tops[3] ?? NaN, 6);
});

test("switching_layout_keeps_the_current_page_in_view", async () => {
  await pages({ pages: 6 });
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  scrollTo(PAGE_MARGIN + 2 * (800 * scale + PAGE_GAP) + 5);
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(2);

  setLayout("spread");
  const spreadScale = (VIEW.width - 2 * PAGE_MARGIN - PAGE_GAP) / (2 * 600);
  // Page 3 (index 2) opens the second row.
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBeCloseTo(
    PAGE_MARGIN + 800 * spreadScale + PAGE_GAP,
    4
  );
  fireEvent.scroll(screen.getByTestId("pdf-scroll"));
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(2);

  setLayout("grid", 3);
  // Page 3 is the last of the first row of three: the row is in view and the page is kept.
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBeCloseTo(PAGE_MARGIN, 4);
  fireEvent.scroll(screen.getByTestId("pdf-scroll"));
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(2);

  setLayout("scroll");
  const back = Number(screen.getByTestId("pdf-pages").dataset.zoom) * CSS_PX_PER_PT;
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBeCloseTo(
    PAGE_MARGIN + 2 * (800 * back + PAGE_GAP),
    4
  );
});

test("a_document_at_the_top_stays_at_the_top_when_the_layout_changes", async () => {
  await pages();
  setLayout("spread");
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBe(0);
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(0);
});

test("single_shows_one_page_and_the_keys_step_through_the_document", async () => {
  useViewSettings.setState({ pdfLayout: "single" });
  await pages();
  const scroll = screen.getByTestId("pdf-scroll");
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.getByRole("group", { name: "Page 1" })).toBeInTheDocument();

  fireEvent.keyDown(scroll, { key: "PageDown" });
  expect(screen.getByRole("group", { name: "Page 2" })).toBeInTheDocument();
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(1);
  fireEvent.keyDown(scroll, { key: "ArrowRight" });
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(2);
  fireEvent.keyDown(scroll, { key: "ArrowLeft" });
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(1);
  fireEvent.keyDown(scroll, { key: "PageUp" });
  fireEvent.keyDown(scroll, { key: "PageUp" });
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(0);
  for (let i = 0; i < 9; i += 1) fireEvent.keyDown(scroll, { key: "PageDown" });
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(3);
  expect(screen.getByRole("group", { name: "Page 4" })).toBeInTheDocument();
});

test("a_step_in_single_starts_the_new_page_at_its_top", async () => {
  useViewSettings.setState({ pdfLayout: "single" });
  await pages();
  const scroll = screen.getByTestId("pdf-scroll");
  scroll.scrollTop = 300;
  fireEvent.scroll(scroll);
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(0);
  fireEvent.keyDown(scroll, { key: "PageDown" });
  expect(scroll.scrollTop).toBe(0);
});

test("the_step_keys_do_nothing_outside_single_and_with_a_modifier_held", async () => {
  await pages();
  const scroll = screen.getByTestId("pdf-scroll");
  const stay = new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true });
  scroll.dispatchEvent(stay);
  expect(stay.defaultPrevented).toBe(false);
  setLayout("single");
  fireEvent.keyDown(scroll, { key: "ArrowRight", ctrlKey: true });
  fireEvent.keyDown(scroll, { key: "ArrowRight", altKey: true });
  expect(usePdfView.getState().byTab["t1"]?.page ?? 0).toBe(0);
});

test("switching_to_single_shows_the_page_that_was_in_view", async () => {
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN) / 600;
  scrollTo(PAGE_MARGIN + 2 * (800 * scale + PAGE_GAP) + 5);
  setLayout("single");
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.getByRole("group", { name: "Page 3" })).toBeInTheDocument();
  setLayout("scroll");
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(2);
  expect(screen.getAllByRole("group")).toHaveLength(4);
});

test("go_to_page_in_single_shows_that_page", async () => {
  useViewSettings.setState({ pdfLayout: "single" });
  await pages();
  act(() => pdfController("t1")?.askGoToPage());
  const field = await screen.findByRole("textbox", { name: /^Page \(1 to/ });
  fireEvent.change(field, { target: { value: "4" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.getByRole("group", { name: "Page 4" })).toBeInTheDocument();
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(3);
});

test("go_to_page_in_a_spread_scrolls_to_the_row_that_holds_the_page", async () => {
  useViewSettings.setState({ pdfLayout: "spread" });
  await pages();
  const scale = (VIEW.width - 2 * PAGE_MARGIN - PAGE_GAP) / (2 * 600);
  act(() => pdfController("t1")?.askGoToPage());
  const field = await screen.findByRole("textbox", { name: /^Page \(1 to/ });
  fireEvent.change(field, { target: { value: "4" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(screen.getByTestId("pdf-scroll").scrollTop).toBeCloseTo(
    PAGE_MARGIN + 800 * scale + PAGE_GAP,
    4
  );
  expect(usePdfView.getState().byTab["t1"]?.page).toBe(3);
});

test("rotate_turns_the_page_in_view_or_every_page_through_the_controller", async () => {
  ipc.pdfPageInfo.mockImplementation(async () => info(600, 800));
  const apply = vi.fn(() => Promise.resolve());
  await pages({ apply });
  act(() => usePdfView.getState().patch("t1", { page: 2 }));
  pdfController("t1")?.rotate(90, "page");
  expect(apply).toHaveBeenLastCalledWith({ op: "rotate", pages: [2], degrees: 90 });
  pdfController("t1")?.rotate(270, "page");
  expect(apply).toHaveBeenLastCalledWith({ op: "rotate", pages: [2], degrees: 270 });
  pdfController("t1")?.rotate(180, "all");
  expect(apply).toHaveBeenLastCalledWith({ op: "rotate", pages: [0, 1, 2, 3], degrees: 180 });
});

test("the_controller_answers_for_the_document_as_it_is_now", async () => {
  ipc.pdfPageInfo.mockImplementation(async () => info(600, 800));
  const { rerender } = await pages({ canUndo: false, canRedo: false });
  expect(pdfController("t1")?.canEdit()).toBe(true);
  expect(pdfController("t1")?.canUndo()).toBe(false);
  rerender(<Pages doc={doc({ canUndo: true, canRedo: true })} />);
  expect(pdfController("t1")?.canUndo()).toBe(true);
  expect(pdfController("t1")?.canRedo()).toBe(true);
  // A document another place holds can be neither changed nor undone here.
  rerender(<Pages doc={doc({ canUndo: true, canRedo: true, canEdit: false })} />);
  expect(pdfController("t1")?.canEdit()).toBe(false);
  expect(pdfController("t1")?.canUndo()).toBe(false);
  expect(pdfController("t1")?.canRedo()).toBe(false);
});

test("undo_and_redo_go_to_the_document", async () => {
  ipc.pdfPageInfo.mockImplementation(async () => info(600, 800));
  const undo = vi.fn(() => Promise.resolve());
  const redo = vi.fn(() => Promise.resolve());
  await pages({ undo, redo, canUndo: true, canRedo: true });
  pdfController("t1")?.undo();
  pdfController("t1")?.redo();
  expect(undo).toHaveBeenCalledTimes(1);
  expect(redo).toHaveBeenCalledTimes(1);
});
