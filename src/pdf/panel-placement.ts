// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PanelPlacement, PanelSide, PdfPanelId, PdfPanels } from "../ipc";

export type PanelId = PdfPanelId;
export type Side = PanelSide;
export type { PanelPlacement };

/** The panels in the order they stack when they share a side. */
export const PANEL_ORDER: readonly PanelId[] = ["thumbnails", "tools"];

export const SIDES: readonly Side[] = ["left", "right", "bottom"];

export const PANEL_TITLES: Record<PanelId, string> = {
  thumbnails: "Thumbnails",
  tools: "Tools",
};

export const SIDE_TITLES: Record<Side, string> = {
  left: "Left",
  right: "Right",
  bottom: "Bottom",
};

export const DEFAULT_PANELS: PdfPanels = {
  thumbnails: { side: "left", collapsed: false },
  tools: { side: "right", collapsed: false },
};

/** The panels on each side, in the order they stack there. A collapsed panel keeps its side. */
export function arrangePanels(panels: PdfPanels): Record<Side, PanelId[]> {
  const arranged: Record<Side, PanelId[]> = { left: [], right: [], bottom: [] };
  for (const id of PANEL_ORDER) arranged[panels[id].side].push(id);
  return arranged;
}

/** `panels` with `id` moved to `side`; its collapsed state stays. */
export function movePanel(panels: PdfPanels, id: PanelId, side: Side): PdfPanels {
  return { ...panels, [id]: { ...panels[id], side } };
}

/** `panels` with `id` folded to its icons, or opened again. */
export function toggleCollapsed(panels: PdfPanels, id: PanelId): PdfPanels {
  return { ...panels, [id]: { ...panels[id], collapsed: !panels[id].collapsed } };
}
