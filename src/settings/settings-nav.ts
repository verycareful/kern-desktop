// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// Which section of Settings to bring into view when Settings next shows:
// the logo in the places strip asks for About. Settings takes the request
// and clears it, so a later visit opens where the user left it.

export type SettingsSection = "about";

interface SettingsNavState {
  /** The section asked for, or null when none is waiting. */
  section: SettingsSection | null;
  show(section: SettingsSection): void;
  /** Settings brought the section into view. */
  taken(): void;
}

export const useSettingsNav = create<SettingsNavState>()((set) => ({
  section: null,
  show: (section) => set({ section }),
  taken: () => set({ section: null }),
}));
