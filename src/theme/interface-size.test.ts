// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { DEFAULT_INTERFACE_SIZE, INTERFACE_SIZES, zoomFactor } from "./interface-size";

// The sizes are 80, 90, 100, 110 and 125 percent, 90 by default.
test("the_sizes_and_the_default_are_the_ruled_ones", () => {
  expect([...INTERFACE_SIZES]).toEqual([80, 90, 100, 110, 125]);
  expect(DEFAULT_INTERFACE_SIZE).toBe(90);
});

test("the_zoom_factor_is_the_percentage_as_a_fraction", () => {
  expect(zoomFactor(90)).toBeCloseTo(0.9, 10);
  expect(zoomFactor(125)).toBe(1.25);
});
