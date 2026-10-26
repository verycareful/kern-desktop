// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { bandIndices } from "./band";

test("list_band_covers_the_rows_it_touches", () => {
  const layout = { kind: "list", rowHeight: 40, count: 10 } as const;
  // Rows span [0,40) [40,80) [80,120): a band from y=30 to y=85 touches rows 0, 1 and 2.
  expect(bandIndices(layout, { left: 0, top: 30, right: 10, bottom: 85 })).toEqual([0, 1, 2]);
  // A band that ends exactly on a row boundary does not touch the next row.
  expect(bandIndices(layout, { left: 0, top: 0, right: 10, bottom: 40 })).toEqual([0]);
  // Clamped to the list, in either direction of drag.
  expect(bandIndices(layout, { left: 0, top: 350, right: 5, bottom: 900 })).toEqual([8, 9]);
  expect(bandIndices(layout, { left: 0, top: 500, right: 5, bottom: 600 })).toEqual([]);
});

test("grid_band_covers_the_cards_it_touches", () => {
  // 3 columns of 100 px cards, 10 px gap and 10 px padding; cards 110 px tall, so a row
  // takes 120 px with its gap.
  const layout = {
    kind: "grid",
    count: 7,
    columns: 3,
    cardWidth: 100,
    gap: 10,
    padding: 10,
    cardHeight: 110,
    rowHeight: 120,
  } as const;
  // Card (row 0, col 1) is x 120..220, y 0..110.
  expect(bandIndices(layout, { left: 130, top: 10, right: 140, bottom: 20 })).toEqual([1]);
  // Across the gap between col 0 (10..110) and col 1 (120..220): both.
  expect(bandIndices(layout, { left: 100, top: 10, right: 130, bottom: 20 })).toEqual([0, 1]);
  // Only the gap itself: nothing.
  expect(bandIndices(layout, { left: 112, top: 10, right: 118, bottom: 20 })).toEqual([]);
  // Only the gap between rows 0 (0..110) and 1 (120..230): nothing.
  expect(bandIndices(layout, { left: 10, top: 112, right: 300, bottom: 118 })).toEqual([]);
  // Three rows, the last row has one card.
  expect(bandIndices(layout, { left: 0, top: 100, right: 400, bottom: 300 })).toEqual([
    0, 1, 2, 3, 4, 5, 6,
  ]);
  expect(bandIndices(layout, { left: 0, top: 250, right: 400, bottom: 300 })).toEqual([6]);
});
