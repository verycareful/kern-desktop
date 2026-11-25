// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { PdfPageInfo } from "../ipc";

const ipc = vi.hoisted(() => ({ pdfPageInfo: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import {
  CSS_PX_PER_PT,
  PAGE_GAP,
  PAGE_MARGIN,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  factorOf,
  fitScale,
  pageAtOffset,
  pageBoxes,
  pageSizes,
  scaleOf,
  stepZoom,
  type PageSize,
} from "./page-geometry";

const size = (widthPt: number, heightPt: number): PageSize => ({ widthPt, heightPt, rotate: 0 });
const info = (width_pt: number, height_pt: number, rotate = 0): PdfPageInfo => ({
  width_pt,
  height_pt,
  rotate,
  crop_box: [0, 0, width_pt, height_pt],
});

beforeEach(() => vi.clearAllMocks());

test("a_rotated_page_is_measured_as_displayed_and_not_swapped_again", async () => {
  // The engine's width and height are the displayed ones: a page rotated 90 degrees comes
  // as 792 wide and 612 tall already.
  ipc.pdfPageInfo.mockResolvedValue(info(792, 612, 90));
  expect(await pageSizes(1, 1)).toEqual([{ widthPt: 792, heightPt: 612, rotate: 90 }]);
});

test("a_rotation_the_engine_gives_outside_0_to_270_is_taken_modulo_a_turn", async () => {
  ipc.pdfPageInfo.mockResolvedValueOnce(info(1, 1, 450)).mockResolvedValueOnce(info(1, 1, -90));
  const sizes = await pageSizes(1, 2);
  expect(sizes.map((s) => s.rotate)).toEqual([90, 270]);
});

test("the_sizes_are_read_in_page_order_from_page_0", async () => {
  ipc.pdfPageInfo.mockImplementation(async (_h: number, page: number) => info(100 + page, 200));
  const sizes = await pageSizes(7, 40);
  expect(sizes).toHaveLength(40);
  expect(sizes[39]?.widthPt).toBe(139);
  expect(ipc.pdfPageInfo).toHaveBeenNthCalledWith(1, 7, 0);
});

test("a_stale_read_stops_after_its_batch", async () => {
  ipc.pdfPageInfo.mockResolvedValue(info(1, 1));
  await pageSizes(1, 100, () => true);
  expect(ipc.pdfPageInfo.mock.calls.length).toBeLessThan(100);
});

test("a_failed_read_is_not_swallowed", async () => {
  ipc.pdfPageInfo.mockRejectedValue(new Error("gone"));
  await expect(pageSizes(1, 3)).rejects.toThrow("gone");
});

test("zoom_is_clamped_to_the_steps_of_the_text_editor", () => {
  expect(ZOOM_MIN).toBe(0.25);
  expect(ZOOM_MAX).toBe(5);
  expect(clampZoom(0.1)).toBe(0.25);
  expect(clampZoom(9)).toBe(5);
  expect(stepZoom(1, 1)).toBe(1.25);
  expect(stepZoom(1, -1)).toBe(0.75);
  expect(stepZoom(5, 1)).toBe(5);
  expect(stepZoom(0.25, -1)).toBe(0.25);
});

test("stepping_from_a_fit_between_two_steps_lands_on_the_next_step", () => {
  expect(stepZoom(0.87, 1)).toBe(1);
  expect(stepZoom(0.87, -1)).toBe(0.75);
  expect(stepZoom(1.0000000001, -1)).toBe(0.75);
});

test("fit_width_scales_the_widest_page_to_the_view_less_its_margins", () => {
  const sizes = [size(300, 400), size(600, 400)];
  expect(fitScale(sizes, 600 + 2 * PAGE_MARGIN)).toBe(1);
  expect(scaleOf({ fit: true }, sizes, 600 + 2 * PAGE_MARGIN)).toBe(1);
});

test("a_factor_zoom_is_the_printed_size_times_the_factor", () => {
  expect(scaleOf({ fit: false, factor: 2 }, [size(1, 1)], 1000)).toBeCloseTo(2 * CSS_PX_PER_PT);
  expect(factorOf(CSS_PX_PER_PT)).toBe(1);
});

test("the_boxes_stack_with_a_gap_and_a_margin", () => {
  const boxes = pageBoxes([size(100, 200), size(50, 100)], 2);
  expect(boxes.pages).toEqual([
    { top: PAGE_MARGIN, width: 200, height: 400 },
    { top: PAGE_MARGIN + 400 + PAGE_GAP, width: 100, height: 200 },
  ]);
  expect(boxes.total).toBe(PAGE_MARGIN + 400 + PAGE_GAP + 200 + PAGE_MARGIN);
});

test("the_page_at_an_offset_is_the_one_above_in_a_gap_and_the_first_above_the_top", () => {
  const pages = [{ top: 16 }, { top: 100 }, { top: 200 }];
  expect(pageAtOffset(pages, 0)).toBe(0);
  expect(pageAtOffset(pages, 99)).toBe(0);
  expect(pageAtOffset(pages, 100)).toBe(1);
  expect(pageAtOffset(pages, 5000)).toBe(2);
  expect(pageAtOffset([], 10)).toBe(0);
});
