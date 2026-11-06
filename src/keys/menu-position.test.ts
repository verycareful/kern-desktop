// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { clampToViewport } from "./menu-position";

test("clamp_keeps_the_menu_inside_the_viewport", () => {
  const size = { w: 200, h: 100 };
  const view = { w: 800, h: 600 };
  expect(clampToViewport(10, 10, size, view)).toEqual({ x: 10, y: 10 });
  expect(clampToViewport(700, 10, size, view)).toEqual({ x: 600, y: 10 });
  expect(clampToViewport(10, 560, size, view)).toEqual({ x: 10, y: 500 });
  expect(clampToViewport(-5, -5, size, view)).toEqual({ x: 0, y: 0 });
});
