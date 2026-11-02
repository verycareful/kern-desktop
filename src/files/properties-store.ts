// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { WirePath } from "../ipc";

// The items whose Properties are on show (design 5.1): asked for from a
// folder view (Alt+Enter, the menus) or by another program through
// FileManager1.ShowItemProperties (kern://properties). One dialog at a time;
// a new request replaces the one on show.
interface PropertiesState {
  paths: WirePath[] | null;
  show(paths: WirePath[]): void;
  close(): void;
}

export const useProperties = create<PropertiesState>()((set) => ({
  paths: null,
  show: (paths) => set({ paths: paths.length > 0 ? paths : null }),
  close: () => set({ paths: null }),
}));
