// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireError } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfRenderSize: vi.fn(),
  pdfRender: vi.fn(),
  pdfCancelJob: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { PageCanvas } from "./PageCanvas";
import type { PageSize } from "./page-geometry";
import { testDoc } from "./test-doc";
import type { PdfDoc } from "./usePdfDoc";

const SIZE: PageSize = { widthPt: 100, heightPt: 200, rotate: 0 };
const doc = (over: Partial<PdfDoc> = {}): PdfDoc => testDoc({ handle: 5, pages: 3, ...over });

const putImageData = vi.fn();
const images: { width: number; height: number; length: number }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  images.length = 0;
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {
        images.push({ width, height, length: data.length });
      }
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    putImageData,
  } as unknown as CanvasRenderingContext2D);
  ipc.pdfRenderSize.mockImplementation(async (_h, _p, _r, widthPx: number) => ({
    width: widthPx,
    height: widthPx * 2,
    bytes: widthPx * widthPx * 8,
  }));
  ipc.pdfRender.mockImplementation(
    async (_h, _p, _r, widthPx: number) => new Uint8Array(widthPx * widthPx * 8)
  );
  ipc.pdfCancelJob.mockResolvedValue({ running: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

const canvas = (props: Partial<Parameters<typeof PageCanvas>[0]> = {}) => (
  <PageCanvas doc={doc()} page={2} size={SIZE} cssWidth={80} visible current {...props} />
);

test("renders_only_while_visible", async () => {
  const { rerender, container } = render(canvas({ visible: false }));
  expect(container.querySelector("canvas")).toBeNull();
  expect(ipc.pdfRender).not.toHaveBeenCalled();

  rerender(canvas({ visible: true }));
  await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
  expect(container.querySelector("canvas")).not.toBeNull();
  // The page is asked for with the page's own number, counted from 0, and the whole page.
  expect(ipc.pdfRender).toHaveBeenCalledWith(5, 2, [0, 0, 1, 1], 80, expect.any(Number));

  rerender(canvas({ visible: false }));
  expect(container.querySelector("canvas")).toBeNull();
});

test("the_picture_is_drawn_at_the_size_the_engine_gave", async () => {
  render(canvas());
  await waitFor(() => expect(putImageData).toHaveBeenCalled());
  expect(images).toEqual([{ width: 80, height: 160, length: 80 * 80 * 8 }]);
});

test("cancels_the_job_when_scrolled_away", async () => {
  ipc.pdfRender.mockImplementation(() => new Promise(() => undefined));
  const { rerender } = render(canvas());
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalled());
  const job = ipc.pdfRender.mock.calls[0]?.[4];

  rerender(canvas({ visible: false }));
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(job);
});

test("a_zoom_cancels_the_render_in_flight_and_draws_again", async () => {
  ipc.pdfRender.mockImplementationOnce(() => new Promise(() => undefined));
  const { rerender } = render(canvas());
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(1));
  const first = ipc.pdfRender.mock.calls[0]?.[4];

  rerender(canvas({ cssWidth: 160 }));
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(first);
  await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
  expect(ipc.pdfRender.mock.calls[1]?.[3]).toBe(160);
  expect(ipc.pdfRender.mock.calls[1]?.[4]).not.toBe(first);
});

test("a_finished_render_is_not_cancelled_when_the_page_leaves", async () => {
  const { rerender } = render(canvas());
  await waitFor(() => expect(putImageData).toHaveBeenCalled());
  rerender(canvas({ visible: false }));
  expect(ipc.pdfCancelJob).not.toHaveBeenCalled();
});

test("closing_the_tab_mid_render_raises_no_error", async () => {
  let fail: (e: unknown) => void = () => undefined;
  ipc.pdfRender.mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      })
  );
  const { unmount } = render(canvas());
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalled());
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  unmount();
  await act(async () => {
    fail(wireError("Cancelled"));
    await Promise.resolve();
  });
  process.off("unhandledRejection", unhandled);
  expect(unhandled).not.toHaveBeenCalled();
  expect(putImageData).not.toHaveBeenCalled();
});

test("a_picture_that_arrives_after_the_page_left_is_not_drawn", async () => {
  let finish: (bytes: Uint8Array) => void = () => undefined;
  ipc.pdfRender.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { rerender } = render(canvas());
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalled());
  rerender(canvas({ visible: false }));
  await act(async () => {
    finish(new Uint8Array(80 * 80 * 8));
    await Promise.resolve();
  });
  expect(putImageData).not.toHaveBeenCalled();
});

test("a_failure_on_a_live_page_is_said_on_the_page", async () => {
  ipc.pdfRender.mockRejectedValue(wireError("Panic", "the renderer stopped"));
  render(canvas());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Page 3 could not be drawn: Panic: the renderer stopped"
  );
});

test("a_picture_of_the_wrong_length_is_an_error_not_a_thrown_image_data", async () => {
  ipc.pdfRender.mockResolvedValue(new Uint8Array(10));
  render(canvas());
  expect(await screen.findByRole("alert")).toHaveTextContent("drew 10 bytes");
  expect(putImageData).not.toHaveBeenCalled();
});

test("a_page_over_the_limit_is_one_canvas_per_tile", async () => {
  const wide: PageSize = { widthPt: 2000, heightPt: 100, rotate: 0 };
  ipc.pdfRenderSize.mockImplementation(async (_h, _p, _r, widthPx: number) => ({
    width: widthPx,
    height: 1,
    bytes: widthPx * 4,
  }));
  ipc.pdfRender.mockImplementation(
    async (_h, _p, _r, widthPx: number) => new Uint8Array(widthPx * 4)
  );
  const { container } = render(canvas({ size: wide, cssWidth: 20000 }));
  await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(2));
  expect(container.querySelectorAll("canvas")).toHaveLength(2);
  const regions = ipc.pdfRender.mock.calls.map((call) => call[2]);
  expect(regions[0][0]).toBe(0);
  expect(regions[1][2]).toBe(1);
  for (const call of ipc.pdfRender.mock.calls) expect(call[3]).toBeLessThanOrEqual(16384);
});

test("a_canvas_the_webview_will_not_give_is_said", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  render(canvas());
  expect(await screen.findByRole("alert")).toHaveTextContent("no 2D canvas");
});

test("an_edit_to_another_page_does_not_draw_this_page_again", async () => {
  const { rerender } = render(canvas({ doc: doc({ pageRevisions: [0, 0, 0] }) }));
  await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
  // The document is at a new revision and page 1 changed at it; page 2 did not.
  rerender(canvas({ doc: doc({ revision: 1, pageRevisions: [0, 1, 0] }) }));
  await act(async () => undefined);
  expect(ipc.pdfRender).toHaveBeenCalledTimes(1);
});

test("an_edit_to_this_page_draws_it_again_and_cancels_the_picture_in_flight", async () => {
  let finish!: () => void;
  ipc.pdfRender.mockImplementationOnce(
    (_h, _p, _r, widthPx: number) =>
      new Promise<Uint8Array>((r) => (finish = () => r(new Uint8Array(widthPx * widthPx * 8))))
  );
  const { rerender } = render(canvas({ doc: doc({ pageRevisions: [0, 0, 0] }) }));
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(1));
  rerender(canvas({ doc: doc({ revision: 1, pageRevisions: [0, 0, 1] }) }));
  // The first picture is of the page as it was: it is cancelled, never painted, and the page is
  // asked for again.
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(2));
  expect(ipc.pdfCancelJob).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
  await act(async () => finish());
  expect(putImageData).toHaveBeenCalledTimes(1);
});

test("a_page_waits_for_its_sizes_before_it_is_drawn_again", async () => {
  const { rerender } = render(canvas({ doc: doc({ pageRevisions: [0, 0, 0] }) }));
  await waitFor(() => expect(putImageData).toHaveBeenCalledTimes(1));
  rerender(canvas({ doc: doc({ revision: 1, pageRevisions: [0, 0, 1] }), current: false }));
  await act(async () => undefined);
  expect(ipc.pdfRender).toHaveBeenCalledTimes(1);
  // The picture on show stays until the sizes of the edit are read.
  expect(document.querySelectorAll("canvas")).toHaveLength(1);
  rerender(canvas({ doc: doc({ revision: 1, pageRevisions: [0, 0, 1] }), current: true }));
  await waitFor(() => expect(ipc.pdfRender).toHaveBeenCalledTimes(2));
});
