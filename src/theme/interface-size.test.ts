// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import {
  DEFAULT_INTERFACE_SIZE,
  INTERFACE_SIZES,
  stepInterfaceSize,
  zoomFactor,
} from "./interface-size";

// Design 7.2 and the maintainer's ruling: 80, 90, 100, 110 and 125 percent, 90 by default.
test("the_sizes_and_the_default_are_the_ruled_ones", () => {
  expect([...INTERFACE_SIZES]).toEqual([80, 90, 100, 110, 125]);
  expect(DEFAULT_INTERFACE_SIZE).toBe(90);
});

test("stepping_moves_one_size_and_clamps_at_the_ends", () => {
  expect(stepInterfaceSize(90, 1)).toBe(100);
  expect(stepInterfaceSize(90, -1)).toBe(80);
  expect(stepInterfaceSize(110, 1)).toBe(125);
  expect(stepInterfaceSize(125, 1)).toBe(125);
  expect(stepInterfaceSize(80, -1)).toBe(80);
});

test("a_value_between_sizes_steps_to_the_next_one_in_that_direction", () => {
  expect(stepInterfaceSize(95, 1)).toBe(100);
  expect(stepInterfaceSize(95, -1)).toBe(90);
  expect(stepInterfaceSize(500, -1)).toBe(125);
  expect(stepInterfaceSize(1, 1)).toBe(80);
});

test("the_zoom_factor_is_the_percentage_as_a_fraction", () => {
  expect(zoomFactor(90)).toBeCloseTo(0.9, 10);
  expect(zoomFactor(125)).toBe(1.25);
});
