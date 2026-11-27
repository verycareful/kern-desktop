// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import {
  ALLOWED_SIDES,
  toolsForm,
  DEFAULT_PANELS,
  arrangePanels,
  movePanel,
  toggleCollapsed,
} from "./panel-placement";

test("defaults_put_thumbnails_left_and_tools_on_top", () => {
  expect(arrangePanels(DEFAULT_PANELS)).toEqual({
    top: ["tools"],
    left: ["thumbnails"],
    right: [],
    bottom: [],
  });
  expect(DEFAULT_PANELS.thumbnails.collapsed).toBe(false);
  expect(DEFAULT_PANELS.tools.collapsed).toBe(false);
});

test("the_tools_may_sit_on_every_side_and_the_thumbnails_on_every_side_but_the_top", () => {
  expect(ALLOWED_SIDES.tools).toEqual(["top", "left", "right", "bottom"]);
  expect(ALLOWED_SIDES.thumbnails).toEqual(["left", "right", "bottom"]);
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

test("a_collapsed_tools_panel_keeps_its_side_when_it_moves_to_the_top", () => {
  const folded = toggleCollapsed(movePanel(DEFAULT_PANELS, "tools", "left"), "tools");
  const moved = movePanel(folded, "tools", "top");
  expect(moved.tools).toEqual({ side: "top", collapsed: true });
  expect(arrangePanels(moved).top).toEqual(["tools"]);
});

test("moving_a_panel_leaves_the_other_and_its_collapsed_state_alone", () => {
  const folded = toggleCollapsed(DEFAULT_PANELS, "thumbnails");
  const moved = movePanel(folded, "thumbnails", "right");
  expect(moved.thumbnails).toEqual({ side: "right", collapsed: true });
  expect(moved.tools).toEqual(DEFAULT_PANELS.tools);
});

test("moving_the_thumbnails_to_the_top_is_refused", () => {
  expect(() => movePanel(DEFAULT_PANELS, "thumbnails", "top")).toThrow(/thumbnails/i);
});

test("the_tools_are_a_bar_on_the_top_and_the_bottom_and_a_rail_or_names_on_a_side", () => {
  expect(toolsForm("top", false)).toBe("bar");
  expect(toolsForm("bottom", false)).toBe("bar");
  expect(toolsForm("top", true)).toBe("bar");
  expect(toolsForm("left", false)).toBe("named");
  expect(toolsForm("right", false)).toBe("named");
  expect(toolsForm("left", true)).toBe("rail");
  expect(toolsForm("right", true)).toBe("rail");
});
