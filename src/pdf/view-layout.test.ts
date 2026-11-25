// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import {
  GRID_ACROSS_DEFAULT,
  GRID_ACROSS_MAX,
  GRID_ACROSS_MIN,
  acrossOf,
  clampAcross,
  layoutOf,
  layoutRows,
  rowOfPage,
} from "./view-layout";

test("scroll_gives_one_page_per_row", () => {
  expect(layoutRows({ kind: "scroll" }, 3)).toEqual([[0], [1], [2]]);
  expect(layoutRows({ kind: "single" }, 3)).toEqual([[0], [1], [2]]);
});

test("spread_pairs_pages_two_by_two_and_the_last_may_be_alone", () => {
  expect(layoutRows({ kind: "spread" }, 4)).toEqual([
    [0, 1],
    [2, 3],
  ]);
  expect(layoutRows({ kind: "spread" }, 5)).toEqual([[0, 1], [2, 3], [4]]);
});

test("grid_fills_rows_of_across", () => {
  expect(layoutRows({ kind: "grid", across: 3 }, 7)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  expect(layoutRows({ kind: "grid", across: 4 }, 4)).toEqual([[0, 1, 2, 3]]);
});

test("zero_pages_gives_no_rows", () => {
  for (const layout of [
    { kind: "scroll" },
    { kind: "single" },
    { kind: "spread" },
    { kind: "grid", across: 4 },
  ] as const) {
    expect(layoutRows(layout, 0)).toEqual([]);
  }
});

test("across_is_clamped_to_1_to_12", () => {
  expect(GRID_ACROSS_MIN).toBe(1);
  expect(GRID_ACROSS_MAX).toBe(12);
  expect(GRID_ACROSS_DEFAULT).toBe(4);
  expect(clampAcross(0)).toBe(1);
  expect(clampAcross(-3)).toBe(1);
  expect(clampAcross(99)).toBe(12);
  expect(clampAcross(5.9)).toBe(5);
  expect(clampAcross(Number.NaN)).toBe(GRID_ACROSS_DEFAULT);
  expect(layoutRows({ kind: "grid", across: 99 }, 13)[0]).toHaveLength(12);
  expect(layoutRows({ kind: "grid", across: 0 }, 3)).toEqual([[0], [1], [2]]);
});

test("across_is_the_pages_a_row_holds", () => {
  expect(acrossOf({ kind: "scroll" })).toBe(1);
  expect(acrossOf({ kind: "single" })).toBe(1);
  expect(acrossOf({ kind: "spread" })).toBe(2);
  expect(acrossOf({ kind: "grid", across: 6 })).toBe(6);
  expect(acrossOf({ kind: "grid", across: 50 })).toBe(12);
});

test("the_layout_is_built_from_its_stored_name_and_the_grid_columns", () => {
  expect(layoutOf("scroll", 4)).toEqual({ kind: "scroll" });
  expect(layoutOf("single", 4)).toEqual({ kind: "single" });
  expect(layoutOf("spread", 4)).toEqual({ kind: "spread" });
  expect(layoutOf("grid", 7)).toEqual({ kind: "grid", across: 7 });
});

test("the_row_of_a_page_is_the_row_that_holds_it", () => {
  const rows = layoutRows({ kind: "grid", across: 3 }, 7);
  expect(rowOfPage(rows, 0)).toBe(0);
  expect(rowOfPage(rows, 4)).toBe(1);
  expect(rowOfPage(rows, 6)).toBe(2);
  expect(rowOfPage(rows, 99)).toBe(0);
  expect(rowOfPage([], 0)).toBe(0);
});
