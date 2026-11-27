// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PanelPlacement, PanelSide, PdfPanelId, PdfPanels } from "../ipc";

export type PanelId = PdfPanelId;
export type Side = PanelSide;
export type { PanelPlacement };

/** The panels in the order they stack when they share a side. */
export const PANEL_ORDER: readonly PanelId[] = ["thumbnails", "tools"];

/** The sides a panel may sit on: the thumbnails never sit on top, the tools may sit on any side. */
export const ALLOWED_SIDES: Record<PanelId, readonly Side[]> = {
  thumbnails: ["left", "right", "bottom"],
  tools: ["top", "left", "right", "bottom"],
};

export const PANEL_TITLES: Record<PanelId, string> = {
  thumbnails: "Thumbnails",
  tools: "Tools",
};

export const SIDE_TITLES: Record<Side, string> = {
  top: "Top",
  left: "Left",
  right: "Right",
  bottom: "Bottom",
};

export const DEFAULT_PANELS: PdfPanels = {
  thumbnails: { side: "left", collapsed: false },
  tools: { side: "top", collapsed: false },
};

/** The panels on each side, in the order they stack there. A collapsed panel keeps its side. */
export function arrangePanels(panels: PdfPanels): Record<Side, PanelId[]> {
  const arranged: Record<Side, PanelId[]> = { top: [], left: [], right: [], bottom: [] };
  for (const id of PANEL_ORDER) arranged[panels[id].side].push(id);
  return arranged;
}

/** How the tools are drawn: icons in a row on the top or the bottom, icons in a column on a side
 * when folded, and every tool with its name on a side otherwise. */
export type ToolsForm = "bar" | "rail" | "named";

export function toolsForm(side: Side, collapsed: boolean): ToolsForm {
  if (side === "top" || side === "bottom") return "bar";
  return collapsed ? "rail" : "named";
}

/** `panels` with `id` moved to `side`; its collapsed state stays. A side the panel does not allow throws. */
export function movePanel(panels: PdfPanels, id: PanelId, side: Side): PdfPanels {
  if (!ALLOWED_SIDES[id].includes(side)) {
    throw new Error(`the ${PANEL_TITLES[id]} panel cannot sit on the ${side}`);
  }
  return { ...panels, [id]: { ...panels[id], side } };
}

/** `panels` with `id` folded to its icons, or opened again. */
export function toggleCollapsed(panels: PdfPanels, id: PanelId): PdfPanels {
  return { ...panels, [id]: { ...panels[id], collapsed: !panels[id].collapsed } };
}
