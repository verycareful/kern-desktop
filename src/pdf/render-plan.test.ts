// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { PageSize } from "./page-geometry";
import { MAX_BYTES, MAX_SIDE_PX, planRender } from "./render-plan";

const page = (widthPt: number, heightPt: number): PageSize => ({ widthPt, heightPt, rotate: 0 });
const LETTER = page(612, 792);

test("a_page_that_fits_is_one_tile", () => {
  const plan = planRender(LETTER, 800, 1);
  expect(plan.tiles).toEqual([{ region: [0, 0, 1, 1], widthPx: 800 }]);
  expect(plan.widthPx).toBe(800);
  expect(plan.clamped).toBe(false);
});

test("the_width_is_the_css_width_times_the_pixel_ratio_rounded", () => {
  expect(planRender(LETTER, 801.3, 1.5).widthPx).toBe(1202);
});

test("a_page_over_16384_px_is_tiled_and_no_tile_is_over_the_limit", () => {
  // 20000 wide and 1000 tall: 80 MB, so it is tiled and not clamped.
  const plan = planRender(page(2000, 100), 20000, 1);
  expect(plan.clamped).toBe(false);
  expect(plan.tiles.length).toBe(2);
  for (const tile of plan.tiles) expect(tile.widthPx).toBeLessThanOrEqual(MAX_SIDE_PX);
  expect(plan.tiles.reduce((sum, t) => sum + t.widthPx, 0)).toBe(plan.widthPx);
});

test("a_page_taller_than_the_limit_is_cut_into_rows", () => {
  const plan = planRender(page(100, 2000), 1000, 1);
  expect(plan.heightPx).toBe(20000);
  expect(plan.tiles.length).toBe(2);
  const heights = plan.tiles.map((t) => Math.round((t.region[3] - t.region[1]) * plan.heightPx));
  for (const h of heights) expect(h).toBeLessThanOrEqual(MAX_SIDE_PX);
});

test("the_total_bytes_stay_under_1_GiB_per_tile", () => {
  const plan = planRender(page(1000, 1000), 20000, 1);
  expect(plan.clamped).toBe(true);
  for (const tile of plan.tiles) {
    const heightPx = Math.round((tile.region[3] - tile.region[1]) * plan.heightPx);
    expect(tile.widthPx * heightPx * 4).toBeLessThanOrEqual(MAX_BYTES);
  }
  expect(plan.widthPx * plan.heightPx * 4).toBeLessThanOrEqual(MAX_BYTES);
});

test("a_tile_of_exactly_16384_by_16384_is_allowed", () => {
  const plan = planRender(page(100, 100), 16384, 1);
  expect(plan.clamped).toBe(false);
  expect(plan.tiles).toEqual([{ region: [0, 0, 1, 1], widthPx: 16384 }]);
});

test("a_page_past_1_GiB_in_all_is_drawn_narrower_not_dropped", () => {
  const plan = planRender(page(1000, 1000), 40000, 1);
  expect(plan.clamped).toBe(true);
  expect(plan.widthPx).toBeLessThan(40000);
  expect(plan.widthPx).toBeGreaterThan(16000);
  expect(plan.tiles.length).toBeGreaterThan(0);
});

test("tiles_cover_the_page_with_no_gap", () => {
  const plan = planRender(page(1000, 1000), 20000, 1);
  const area = plan.tiles.reduce(
    (sum, t) => sum + (t.region[2] - t.region[0]) * (t.region[3] - t.region[1]),
    0
  );
  expect(area).toBeCloseTo(1, 12);
  const lefts = new Set(plan.tiles.map((t) => t.region[0]));
  const rights = new Set(plan.tiles.map((t) => t.region[2]));
  expect(Math.min(...lefts)).toBe(0);
  expect(Math.max(...rights)).toBe(1);
  // Every inner edge is the edge of the next tile.
  for (const edge of rights) if (edge !== 1) expect(lefts.has(edge)).toBe(true);
  const tops = new Set(plan.tiles.map((t) => t.region[1]));
  const bottoms = new Set(plan.tiles.map((t) => t.region[3]));
  expect(Math.min(...tops)).toBe(0);
  expect(Math.max(...bottoms)).toBe(1);
  for (const edge of bottoms) if (edge !== 1) expect(tops.has(edge)).toBe(true);
});

test("a_tiny_width_still_draws_one_pixel", () => {
  expect(planRender(LETTER, 0.1, 1).widthPx).toBe(1);
});
