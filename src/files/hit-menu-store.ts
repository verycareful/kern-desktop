// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { WireEntry } from "../ipc";

// What the menu of a search or Library hit was opened on. The actions of that menu
// (keys/actions.ts, "hit" actions) are aimed at it, as the tree's are aimed at the tree's entry.
// Opening belongs to the view the hits are shown in (a folder found by a search in a folder tab is
// shown in that tab), so the view hands its own open over with the hit.

export interface HitTarget {
  entry: WireEntry;
  /** Opens the hit as the view the hits are shown in opens one. */
  open(entry: WireEntry, newWindow: boolean): void;
  /** Asks which application opens the hit, in the view the hits are shown in. */
  openWith(entry: WireEntry): void;
}

interface HitMenuState {
  current: HitTarget | null;
  setCurrent(current: HitTarget | null): void;
}

export const useHitMenu = create<HitMenuState>()((set) => ({
  current: null,
  setCurrent: (current) => set({ current }),
}));
