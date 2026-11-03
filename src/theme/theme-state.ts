// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { ThemeState } from "./useTheme";

// The theme the window applied last (useTheme.ts), for what shows it rather
// than applies it: Settings names the tokens that fell back to Kern's own for
// failing WCAG AA, and the theme sources that could not be read.

export const useThemeState = create<ThemeState>()(() => ({
  theme: null,
  error: null,
  problems: [],
}));
