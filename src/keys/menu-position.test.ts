// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { clampToViewport, submenuPosition } from "./menu-position";

test("clamp_keeps_the_menu_inside_the_viewport", () => {
  const size = { w: 200, h: 100 };
  const view = { w: 800, h: 600 };
  expect(clampToViewport(10, 10, size, view)).toEqual({ x: 10, y: 10 });
  expect(clampToViewport(700, 10, size, view)).toEqual({ x: 600, y: 10 });
  expect(clampToViewport(10, 560, size, view)).toEqual({ x: 10, y: 500 });
  expect(clampToViewport(-5, -5, size, view)).toEqual({ x: 0, y: 0 });
});

describe("submenuPosition", () => {
  const view = { w: 800, h: 600 };
  const size = { w: 200, h: 100 };

  test("opens_to_the_right_of_the_row_at_the_row_top", () => {
    expect(submenuPosition({ left: 100, right: 300, top: 50 }, size, view)).toEqual({
      x: 300,
      y: 50,
    });
  });

  test("flips_to_the_left_of_the_row_when_the_right_has_no_room", () => {
    expect(submenuPosition({ left: 500, right: 700, top: 50 }, size, view)).toEqual({
      x: 300,
      y: 50,
    });
  });

  test("moves_up_to_fit_above_the_bottom_edge", () => {
    expect(submenuPosition({ left: 100, right: 300, top: 550 }, size, view)).toEqual({
      x: 300,
      y: 500,
    });
  });

  test("never_leaves_the_left_edge", () => {
    expect(submenuPosition({ left: 50, right: 790, top: 0 }, size, view).x).toBe(0);
  });
});
