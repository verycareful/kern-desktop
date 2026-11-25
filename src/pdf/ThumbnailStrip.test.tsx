// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  pdfRenderSize: vi.fn(),
  pdfRender: vi.fn(),
  pdfCancelJob: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

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
  const first = screen.getByRole("button", { name: "Page 1" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: "Page 2" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement as Element, { key: "End" });
  expect(screen.getByRole("button", { name: "Page 5" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
  expect(screen.getByRole("button", { name: "Page 5" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
  expect(first).toHaveFocus();
});

test("along_the_bottom_the_strip_is_a_row_and_the_side_arrows_move_focus", () => {
  strip({}, 5, true);
  expect(screen.getByTestId("pdf-thumbs")).toHaveClass("kern-pdf-thumbs-row");
  const first = screen.getByRole("button", { name: "Page 1" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(screen.getByRole("button", { name: "Page 2" })).toHaveFocus();
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
