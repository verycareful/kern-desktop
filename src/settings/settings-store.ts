// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  EVENT_SETTINGS_CHANGED,
  on,
  settingsGet,
  settingsSet,
  themeSetPrefs,
  toWireError,
  type Settings,
  type SettingsPatch,
  type WireError,
} from "../ipc";
import { errorText } from "../ops/error-text";

// The settings the Settings tab shows and changes (plan Task 28), as stored
// (settings.json, store.rs). It reads them once and then follows
// kern://settings-changed, so a change made in another window shows here. A
// change goes through settings_set, which answers with the settings as
// stored; one that touches the theme (mode, accent, density, the Follow
// system switches) is then handed to the theme with theme_set_prefs, which
// re-themes every window. A change that fails is said, never dropped.

/** The settings fields the theme is resolved with. */
const THEME_FIELDS: readonly (keyof SettingsPatch)[] = [
  "theme_mode",
  "accent",
  "density",
  "follow",
];

interface SettingsState {
  settings: Settings | null;
  /** Why the settings could not be read, until they are. */
  loadError: WireError | null;
  /** The last change that failed, in words, until the next one succeeds. */
  problem: string | null;
  /** Reads the settings and follows their changes; the returned function stops following. */
  follow(): Promise<() => void>;
  /** Stores `patch` (`what` names it for a failure); true when it was stored and applied. */
  change(patch: SettingsPatch, what: string): Promise<boolean>;
  reset(): void;
}

const initial = { settings: null, loadError: null, problem: null };

export const useSettings = create<SettingsState>()((set) => ({
  ...initial,
  async follow() {
    let off: (() => void) | null = null;
    try {
      off = await on(EVENT_SETTINGS_CHANGED, (settings) => set({ settings }));
    } catch (e) {
      set({
        problem: `Settings changed elsewhere will not show here: ${errorText(toWireError(e))}`,
      });
    }
    try {
      set({ settings: await settingsGet(), loadError: null });
    } catch (e) {
      set({ loadError: toWireError(e) });
    }
    return () => off?.();
  },
  async change(patch, what) {
    let stored: Settings;
    try {
      stored = await settingsSet(patch);
    } catch (e) {
      set({ problem: `${what} was not saved: ${errorText(toWireError(e))}` });
      return false;
    }
    set({ settings: stored, problem: null });
    if (!THEME_FIELDS.some((f) => f in patch)) return true;
    try {
      await themeSetPrefs(stored.follow, {
        mode: stored.theme_mode,
        accent: stored.accent,
        density: stored.density,
      });
      return true;
    } catch (e) {
      set({
        problem: `${what} was saved, but the theme could not be changed to it: ${errorText(toWireError(e))}`,
      });
      return false;
    }
  },
  reset() {
    set(initial);
  },
}));
