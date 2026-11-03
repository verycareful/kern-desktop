// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { WireEntry } from "../ipc";

// The entry of the folder tree a right-click or the Menu key opened the tree's menu on. The
// actions of that menu (keys/actions.ts, "tree" actions) are aimed at it, as the volume actions
// are aimed at the volume whose menu is open.
interface TreeMenuState {
  current: WireEntry | null;
  setCurrent(entry: WireEntry | null): void;
}

export const useTreeMenu = create<TreeMenuState>()((set) => ({
  current: null,
  setCurrent: (current) => set({ current }),
}));
