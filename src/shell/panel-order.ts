// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Panel } from "../ipc";

// Where the panels sit. The file manager has three columns (places, folder area, Pinned and
// Recent) in the order `panel_order` gives; the editor layout has two panels around the editor,
// in the order `editor_panel_order` gives (the first is on the editor's left, the second on its
// right). Both orders are settings (store.rs Settings); this file turns an order into the
// positions the layout needs, and the Settings row moves a panel within one.

/** The file manager's columns, left to right, before the user reorders them. */
export const DEFAULT_PANEL_ORDER: Panel[] = ["places", "folder", "pinned"];

/** The editor layout's two panels, left to right around the editor. */
export const DEFAULT_EDITOR_PANEL_ORDER: Panel[] = ["places", "pinned"];

/** The edge of the window or of the editor a panel is on. */
export type Side = "left" | "right";

/** Moves `panel` one place towards the start (-1) or the end (1); the order stays as it is at an end. */
export function movePanel(order: readonly Panel[], panel: Panel, by: -1 | 1): Panel[] {
  const from = order.indexOf(panel);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next[from] = order[to] as Panel;
  next[to] = panel;
  return next;
}

/** Whether `panel` can move one place in direction `by`. */
export function canMovePanel(order: readonly Panel[], panel: Panel, by: -1 | 1): boolean {
  const to = order.indexOf(panel) + by;
  return order.includes(panel) && to >= 0 && to < order.length;
}

/** The grid column (counted from 1) of `panel` in the file manager. */
export function columnOf(order: readonly Panel[], panel: Panel): number {
  return order.indexOf(panel) + 1;
}

/** The width of each file manager column: the strip and Pinned and Recent are sized, the folder area takes the rest. */
const COLUMN_WIDTH: Record<Panel, string> = {
  places: "var(--shell-places-width)",
  folder: "minmax(0, 1fr)",
  pinned: "var(--shell-right-width)",
};

/** The file manager's `grid-template-columns` for `order`. */
export function gridColumns(order: readonly Panel[]): string {
  return order.map((p) => COLUMN_WIDTH[p]).join(" ");
}

/**
 * The CSS custom properties of the file manager grid for `order`: the template and the column of
 * each panel (the folder area's column also holds the tab row).
 */
export function gridStyle(order: readonly Panel[]): Record<string, string> {
  return {
    "--shell-columns": gridColumns(order),
    "--col-places": String(columnOf(order, "places")),
    "--col-folder": String(columnOf(order, "folder")),
    "--col-pinned": String(columnOf(order, "pinned")),
  };
}

/** The side of the folder area a file manager panel is on. */
export function sideOfFolder(order: readonly Panel[], panel: "places" | "pinned"): Side {
  return order.indexOf(panel) < order.indexOf("folder") ? "left" : "right";
}

/**
 * The edge of the window the file manager's panel slides in from over a document. The two never
 * share an edge, so the one that comes first in the order is on the left: with the folder area
 * first or in the middle they keep their sides from the grid, and with both on one side of the
 * folder area they split by their own order.
 */
export function overlaySide(order: readonly Panel[], panel: "places" | "pinned"): Side {
  const other = panel === "places" ? "pinned" : "places";
  return order.indexOf(panel) < order.indexOf(other) ? "left" : "right";
}

/** The side of the editor a panel of the editor layout is on. */
export function editorSide(order: readonly Panel[], panel: "places" | "pinned"): Side {
  return order.indexOf(panel) === 0 ? "left" : "right";
}

/** The other side. */
export const opposite = (side: Side): Side => (side === "left" ? "right" : "left");
