// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it } from "vitest";
import { gapAt, type PageBox } from "./page-drag";

// A column of three thumbnails, 100 tall, from the top.
const column: PageBox[] = [0, 1, 2].map((page) => ({
  page,
  left: 0,
  right: 80,
  top: page * 100,
  bottom: page * 100 + 90,
}));

// A grid, three across: pages 0 to 2 on the first row, 3 and 4 on the second.
const grid: PageBox[] = [0, 1, 2, 3, 4].map((page) => ({
  page,
  left: (page % 3) * 100,
  right: (page % 3) * 100 + 80,
  top: Math.floor(page / 3) * 120,
  bottom: Math.floor(page / 3) * 120 + 100,
}));

describe("gapAt", () => {
  it("in_a_column_the_upper_half_of_a_page_is_the_gap_before_it", () => {
    expect(gapAt({ x: 40, y: 10 }, column, "y")).toBe(0);
    expect(gapAt({ x: 40, y: 60 }, column, "y")).toBe(1);
    expect(gapAt({ x: 40, y: 120 }, column, "y")).toBe(1);
    expect(gapAt({ x: 40, y: 170 }, column, "y")).toBe(2);
  });

  it("below_the_last_page_is_the_gap_after_it", () => {
    expect(gapAt({ x: 40, y: 280 }, column, "y")).toBe(3);
    expect(gapAt({ x: 40, y: 900 }, column, "y")).toBe(3);
  });

  it("above_the_first_page_is_the_gap_before_it", () => {
    expect(gapAt({ x: 40, y: -50 }, column, "y")).toBe(0);
  });

  it("in_a_grid_the_left_half_of_a_page_is_the_gap_before_it", () => {
    expect(gapAt({ x: 110, y: 50 }, grid, "x")).toBe(1);
    expect(gapAt({ x: 170, y: 50 }, grid, "x")).toBe(2);
    expect(gapAt({ x: 10, y: 170 }, grid, "x")).toBe(3);
    expect(gapAt({ x: 190, y: 170 }, grid, "x")).toBe(5);
  });

  it("the_empty_cell_after_a_short_last_row_is_the_gap_after_its_last_page", () => {
    expect(gapAt({ x: 290, y: 170 }, grid, "x")).toBe(5);
  });

  it("no_boxes_is_no_gap", () => {
    expect(gapAt({ x: 0, y: 0 }, [], "y")).toBeNull();
  });
});
