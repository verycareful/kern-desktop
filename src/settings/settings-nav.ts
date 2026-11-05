// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";

// The category the Settings window was asked to show (open_settings with a section: the logo in
// the places strip asks for About). The window takes the request and clears it, so a later ask
// for the same category is seen again.

interface SettingsNavState {
  /** The category asked for, as the backend handed it, or null when none is waiting. */
  section: string | null;
  show(section: string): void;
  /** The window showed the category. */
  taken(): void;
}

export const useSettingsNav = create<SettingsNavState>()((set) => ({
  section: null,
  show: (section) => set({ section }),
  taken: () => set({ section: null }),
}));
