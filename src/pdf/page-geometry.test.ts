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
  layoutBoxes,
  rowAtOffset,
  pageSizes,
  scaleOf,
  snapBox,
  stepZoom,
  type PageSize,
} from "./page-geometry";
import { layoutRows } from "./view-layout";

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
  const boxes = layoutBoxes([size(100, 200), size(50, 100)], layoutRows({ kind: "scroll" }, 2), 2);
  expect(boxes.pages).toEqual([
    { left: 0, top: PAGE_MARGIN, width: 200, height: 400 },
    { left: 50, top: PAGE_MARGIN + 400 + PAGE_GAP, width: 100, height: 200 },
  ]);
  expect(boxes.rows).toEqual([
    { top: PAGE_MARGIN, height: 400, pages: [0] },
    { top: PAGE_MARGIN + 400 + PAGE_GAP, height: 200, pages: [1] },
  ]);
  expect(boxes.width).toBe(200);
  expect(boxes.total).toBe(PAGE_MARGIN + 400 + PAGE_GAP + 200 + PAGE_MARGIN);
});

test("a_spread_puts_two_pages_side_by_side_in_cells_of_the_widest_page", () => {
  const boxes = layoutBoxes(
    [size(100, 200), size(50, 100), size(100, 200)],
    layoutRows({ kind: "spread" }, 3),
    1
  );
  expect(boxes.width).toBe(2 * 100 + PAGE_GAP);
  expect(boxes.pages[0]).toEqual({ left: 0, top: PAGE_MARGIN, width: 100, height: 200 });
  // Centred in its cell and in the row's height.
  expect(boxes.pages[1]).toEqual({
    left: 100 + PAGE_GAP + 25,
    top: PAGE_MARGIN + 50,
    width: 50,
    height: 100,
  });
  // The last row's lone page keeps the first column.
  expect(boxes.pages[2]).toEqual({
    left: 0,
    top: PAGE_MARGIN + 200 + PAGE_GAP,
    width: 100,
    height: 200,
  });
  expect(boxes.rows.map((r) => r.pages)).toEqual([[0, 1], [2]]);
  expect(boxes.total).toBe(PAGE_MARGIN + 200 + PAGE_GAP + 200 + PAGE_MARGIN);
});

test("no_rows_is_an_empty_block_with_only_its_margins", () => {
  const boxes = layoutBoxes([], [], 1);
  expect(boxes).toEqual({ pages: [], rows: [], width: 0, total: 2 * PAGE_MARGIN });
});

test("a_fit_leaves_room_for_the_gaps_between_the_pages_of_a_row", () => {
  const sizes = [size(100, 100)];
  const view = 2 * PAGE_MARGIN + PAGE_GAP + 400;
  expect(fitScale(sizes, view, 2)).toBe(2);
  expect(scaleOf({ fit: true }, sizes, view, 2)).toBe(2);
  expect(scaleOf({ fit: false, factor: 2 }, sizes, view, 2)).toBeCloseTo(2 * CSS_PX_PER_PT);
});

test("the_row_at_an_offset_is_the_one_above_in_a_gap_and_the_first_above_the_top", () => {
  const rows = [{ top: 16 }, { top: 100 }, { top: 200 }];
  expect(rowAtOffset(rows, 0)).toBe(0);
  expect(rowAtOffset(rows, 99)).toBe(0);
  expect(rowAtOffset(rows, 100)).toBe(1);
  expect(rowAtOffset(rows, 5000)).toBe(2);
  expect(rowAtOffset([], 10)).toBe(0);
});

test("a_page_box_stands_on_whole_device_pixels_and_is_as_big_as_the_picture_drawn_in_it", () => {
  const size: PageSize = { widthPt: 595.28, heightPt: 841.89, rotate: 0 };
  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const scale of [0.3333, 0.5, 1.1337]) {
      const box = snapBox(
        { left: 12.34, top: 56.78, width: size.widthPt * scale, height: size.heightPt * scale },
        size,
        dpr
      );
      for (const edge of [box.left, box.top, box.width, box.height]) {
        expect(Math.abs(edge * dpr - Math.round(edge * dpr))).toBeLessThan(1e-9);
      }
      // The picture is the box's width in device pixels and the height the engine draws it at.
      const widthPx = Math.round(box.width * dpr);
      expect(Math.round(box.height * dpr)).toBe(
        Math.round((widthPx * size.heightPt) / size.widthPt)
      );
      expect(Math.abs(box.width - size.widthPt * scale)).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
    }
  }
});

test("a_box_of_a_device_that_reports_no_pixel_ratio_is_snapped_to_css_pixels", () => {
  const size: PageSize = { widthPt: 100, heightPt: 200, rotate: 0 };
  expect(snapBox({ left: 1.4, top: 2.6, width: 50.4, height: 100.8 }, size, 0)).toEqual({
    left: 1,
    top: 3,
    width: 50,
    height: 100,
  });
});
