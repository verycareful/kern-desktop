// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { CARD, columnsFor } from "./grid-layout";

test("columns_fill_the_width_and_never_drop_below_one", () => {
  const needed = (n: number) => 2 * CARD.padding + n * CARD.width + (n - 1) * CARD.gap;
  expect(columnsFor(needed(3))).toBe(3);
  expect(columnsFor(needed(3) - 1)).toBe(2);
  expect(columnsFor(needed(5) + 40)).toBe(5);
  expect(columnsFor(50)).toBe(1);
  expect(columnsFor(0)).toBe(1);
});
