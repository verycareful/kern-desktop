// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { DEFAULT_PANELS, arrangePanels, movePanel, toggleCollapsed } from "./panel-placement";

test("defaults_put_thumbnails_left_and_tools_right", () => {
  expect(arrangePanels(DEFAULT_PANELS)).toEqual({
    left: ["thumbnails"],
    right: ["tools"],
    bottom: [],
  });
  expect(DEFAULT_PANELS.thumbnails.collapsed).toBe(false);
  expect(DEFAULT_PANELS.tools.collapsed).toBe(false);
});

test("both_panels_on_one_side_stack_thumbnails_first", () => {
  for (const side of ["left", "right", "bottom"] as const) {
    const both = movePanel(movePanel(DEFAULT_PANELS, "tools", side), "thumbnails", side);
    expect(arrangePanels(both)[side]).toEqual(["thumbnails", "tools"]);
  }
});

test("a_collapsed_panel_keeps_its_side", () => {
  const folded = toggleCollapsed(movePanel(DEFAULT_PANELS, "tools", "bottom"), "tools");
  expect(folded.tools).toEqual({ side: "bottom", collapsed: true });
  expect(arrangePanels(folded).bottom).toEqual(["tools"]);
  expect(toggleCollapsed(folded, "tools").tools.collapsed).toBe(false);
});

test("moving_a_panel_leaves_the_other_and_its_collapsed_state_alone", () => {
  const folded = toggleCollapsed(DEFAULT_PANELS, "thumbnails");
  const moved = movePanel(folded, "thumbnails", "right");
  expect(moved.thumbnails).toEqual({ side: "right", collapsed: true });
  expect(moved.tools).toEqual(DEFAULT_PANELS.tools);
});
