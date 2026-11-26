// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { boxChange, moveLeft, moveRight } from "./box-sides";

const MIN = 0.072;

test("the_left_side_stops_at_the_page_and_at_the_least_width_short_of_the_right_side", () => {
  const sides = { left: 0.3, right: 0.6 };
  expect(moveLeft(sides, -0.2, MIN)).toEqual({ left: 0, right: 0.6 });
  expect(moveLeft(sides, 0.9, MIN).left).toBeCloseTo(0.6 - MIN);
  expect(moveLeft(sides, 0.4, MIN)).toEqual({ left: 0.4, right: 0.6 });
});

test("the_right_side_stops_at_the_page_and_at_the_least_width_past_the_left_side", () => {
  const sides = { left: 0.3, right: 0.6 };
  expect(moveRight(sides, 1.4, MIN)).toEqual({ left: 0.3, right: 1 });
  expect(moveRight(sides, 0.1, MIN).right).toBeCloseTo(0.3 + MIN);
  expect(moveRight(sides, 0.7, MIN)).toEqual({ left: 0.3, right: 0.7 });
});

test("a_box_too_near_the_right_edge_for_the_least_width_ends_at_the_page", () => {
  expect(moveRight({ left: 0.97, right: 1 }, 0.98, MIN)).toEqual({ left: 0.97, right: 1 });
});

test("a_box_that_was_not_moved_tells_the_engine_nothing", () => {
  const was = { left: 0.1, right: 0.6 };
  expect(boxChange(was, { ...was })).toEqual({});
  expect(boxChange(was, { left: 0.1 + 1e-9, right: 0.6 })).toEqual({});
});

test("a_moved_right_side_alone_is_a_width_from_the_blocks_own_left_edge", () => {
  const change = boxChange({ left: 0.1, right: 0.6 }, { left: 0.1, right: 0.8 });
  expect(change).toEqual({ width: expect.closeTo(0.7) });
});

test("a_moved_left_side_is_a_left_and_the_width_to_the_right_edge", () => {
  const change = boxChange({ left: 0.1, right: 0.6 }, { left: 0.05, right: 0.6 });
  expect(change).toEqual({ left: 0.05, width: expect.closeTo(0.55) });
  const both = boxChange({ left: 0.1, right: 0.6 }, { left: 0.2, right: 0.9 });
  expect(both).toEqual({ left: 0.2, width: expect.closeTo(0.7) });
});
