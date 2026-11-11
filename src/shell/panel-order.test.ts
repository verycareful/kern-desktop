// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { Panel } from "../ipc";
import {
  DEFAULT_EDITOR_PANEL_ORDER,
  DEFAULT_PANEL_ORDER,
  canMovePanel,
  columnOf,
  editorSide,
  gridColumns,
  gridStyle,
  movePanel,
  opposite,
  overlaySide,
  sideOfFolder,
} from "./panel-order";

const ALL: Panel[][] = [
  ["places", "folder", "pinned"],
  ["places", "pinned", "folder"],
  ["folder", "places", "pinned"],
  ["folder", "pinned", "places"],
  ["pinned", "places", "folder"],
  ["pinned", "folder", "places"],
];

test("the_defaults_are_the_layout_before_the_setting_existed", () => {
  expect(DEFAULT_PANEL_ORDER).toEqual(["places", "folder", "pinned"]);
  expect(DEFAULT_EDITOR_PANEL_ORDER).toEqual(["places", "pinned"]);
});

test("moving_a_panel_swaps_it_with_its_neighbour", () => {
  expect(movePanel(["places", "folder", "pinned"], "folder", 1)).toEqual([
    "places",
    "pinned",
    "folder",
  ]);
  expect(movePanel(["places", "folder", "pinned"], "pinned", -1)).toEqual([
    "places",
    "pinned",
    "folder",
  ]);
  expect(movePanel(["places", "pinned"], "places", 1)).toEqual(["pinned", "places"]);
});

test("moving_past_an_end_changes_nothing_and_never_changes_the_input", () => {
  const order: Panel[] = ["places", "folder", "pinned"];
  expect(movePanel(order, "places", -1)).toEqual(order);
  expect(movePanel(order, "pinned", 1)).toEqual(order);
  expect(movePanel(order, "places", -1)).not.toBe(order);
  expect(order).toEqual(["places", "folder", "pinned"]);
  // A panel the order does not hold is not moved.
  expect(movePanel(["places", "pinned"], "folder", 1)).toEqual(["places", "pinned"]);
});

test("a_panel_can_move_unless_it_is_at_that_end", () => {
  const order: Panel[] = ["places", "folder", "pinned"];
  expect(canMovePanel(order, "places", -1)).toBe(false);
  expect(canMovePanel(order, "places", 1)).toBe(true);
  expect(canMovePanel(order, "folder", -1)).toBe(true);
  expect(canMovePanel(order, "folder", 1)).toBe(true);
  expect(canMovePanel(order, "pinned", 1)).toBe(false);
  expect(canMovePanel(["places", "pinned"], "folder", 1)).toBe(false);
});

test("every_order_is_reached_from_the_default_by_moves_and_keeps_each_panel_once", () => {
  for (const order of ALL) {
    expect([...order].sort()).toEqual(["folder", "pinned", "places"]);
    for (const panel of order) {
      for (const by of [-1, 1] as const) {
        expect([...movePanel(order, panel, by)].sort()).toEqual(["folder", "pinned", "places"]);
      }
    }
  }
});

test("a_panel_has_the_grid_column_of_its_place_in_the_order", () => {
  const order: Panel[] = ["pinned", "folder", "places"];
  expect(columnOf(order, "pinned")).toBe(1);
  expect(columnOf(order, "folder")).toBe(2);
  expect(columnOf(order, "places")).toBe(3);
});

test("the_grid_sizes_each_column_by_its_panel", () => {
  expect(gridColumns(DEFAULT_PANEL_ORDER)).toBe(
    "var(--shell-places-width) minmax(0, 1fr) var(--shell-right-width)"
  );
  expect(gridColumns(["pinned", "places", "folder"])).toBe(
    "var(--shell-right-width) var(--shell-places-width) minmax(0, 1fr)"
  );
  expect(gridStyle(["folder", "pinned", "places"])).toEqual({
    "--shell-columns": "minmax(0, 1fr) var(--shell-right-width) var(--shell-places-width)",
    "--col-places": "3",
    "--col-folder": "1",
    "--col-pinned": "2",
  });
});

test("a_file_manager_panel_is_on_the_side_of_the_folder_area_it_is_ordered_to", () => {
  expect(sideOfFolder(["places", "folder", "pinned"], "places")).toBe("left");
  expect(sideOfFolder(["places", "folder", "pinned"], "pinned")).toBe("right");
  expect(sideOfFolder(["pinned", "folder", "places"], "places")).toBe("right");
  expect(sideOfFolder(["pinned", "folder", "places"], "pinned")).toBe("left");
  // Both before the folder area, or both after it.
  expect(sideOfFolder(["places", "pinned", "folder"], "pinned")).toBe("left");
  expect(sideOfFolder(["folder", "places", "pinned"], "places")).toBe("right");
});

test("over_a_document_the_two_panels_never_share_an_edge", () => {
  for (const order of ALL) {
    expect(overlaySide(order, "places")).toBe(opposite(overlaySide(order, "pinned")));
  }
  expect(overlaySide(["places", "folder", "pinned"], "places")).toBe("left");
  expect(overlaySide(["places", "folder", "pinned"], "pinned")).toBe("right");
  expect(overlaySide(["pinned", "places", "folder"], "pinned")).toBe("left");
  expect(overlaySide(["folder", "pinned", "places"], "places")).toBe("right");
});

test("the_editor_layout_puts_the_first_panel_left_of_the_editor_and_the_second_right", () => {
  expect(editorSide(["places", "pinned"], "places")).toBe("left");
  expect(editorSide(["places", "pinned"], "pinned")).toBe("right");
  expect(editorSide(["pinned", "places"], "places")).toBe("right");
  expect(editorSide(["pinned", "places"], "pinned")).toBe("left");
});
