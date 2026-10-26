// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { activeTab, useTabs, type Tab } from "./tabs";

// Design 4.1 and 4.3: a folder tab shows both side panels. A document tab
// folds both to stubs; a stub slides its panel over the document, and the
// choice is forgotten when the active tab changes.
interface PanelsState {
  /** Slid in over the active document tab. Meaningless for a folder tab. */
  leftSlid: boolean;
  rightSlid: boolean;
  toggleLeft(): void;
  toggleRight(): void;
}

export const usePanelsStore = create<PanelsState>()((set) => ({
  leftSlid: false,
  rightSlid: false,
  toggleLeft: () => set((s) => ({ leftSlid: !s.leftSlid })),
  toggleRight: () => set((s) => ({ rightSlid: !s.rightSlid })),
}));

useTabs.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId) {
    usePanelsStore.setState({ leftSlid: false, rightSlid: false });
  }
});

export type PanelVisibility = { leftOpen: boolean; rightOpen: boolean };

/** Which panels are shown for the active tab. Pure, so actions can use it too. */
export function panelVisibility(
  tab: Tab | null,
  slid: Pick<PanelsState, "leftSlid" | "rightSlid">
): PanelVisibility {
  if (tab?.kind === "folder") return { leftOpen: true, rightOpen: true };
  return { leftOpen: slid.leftSlid, rightOpen: slid.rightSlid };
}

export function usePanels(): PanelVisibility & { toggleLeft(): void; toggleRight(): void } {
  const tab = useTabs((s) => activeTab(s));
  const { leftSlid, rightSlid, toggleLeft, toggleRight } = usePanelsStore();
  return { ...panelVisibility(tab, { leftSlid, rightSlid }), toggleLeft, toggleRight };
}
