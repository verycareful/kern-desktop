// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { layoutBeforeGrid, noteLayout } from "./layout-before-grid";

test("the_layout_the_grid_replaced_is_remembered_and_the_grid_never_is", () => {
  noteLayout("scroll");
  expect(layoutBeforeGrid()).toBe("scroll");
  noteLayout("spread");
  noteLayout("grid");
  expect(layoutBeforeGrid()).toBe("spread");
  // The same layout again, or a change that is not a move into the grid, keeps it.
  noteLayout("grid");
  expect(layoutBeforeGrid()).toBe("spread");
  noteLayout("single");
  expect(layoutBeforeGrid()).toBe("spread");
  noteLayout("grid");
  expect(layoutBeforeGrid()).toBe("single");
});
