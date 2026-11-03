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

// The settings the Settings tab shows and changes, as stored (settings.json,
// store.rs). It reads them once and then follows kern://settings-changed, so
// a change made in another window shows here. A change goes through
// settings_set, which answers with the settings as stored; one that touches
// the theme (mode, accent, density, the Follow system switches) is then
// handed to the theme with theme_set_prefs, which re-themes every window. A
// change that fails is said, never dropped. Changes can overlap (a slider
// sends one per step), so only the answer to the latest one is shown: an
// earlier answer arriving late would put the control back.

/** The store file the settings are kept in (store.rs). */
export const SETTINGS_FILE = "settings.json";

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
  /** Why changes made elsewhere are not followed, for as long as they are not. */
  listenError: WireError | null;
  /** The last change that failed, in words, until the next one succeeds. */
  problem: string | null;
  /** Reads the settings and follows their changes; the returned function stops following. */
  follow(): Promise<() => void>;
  /** Reads the settings again, without following anything more. */
  reload(): Promise<void>;
  /** Stores `patch` (`what` names it for a failure); true when it was stored and applied. */
  change(patch: SettingsPatch, what: string): Promise<boolean>;
  reset(): void;
}

const initial = { settings: null, loadError: null, listenError: null, problem: null };

/** Counts changes, so the answer to an earlier one is known for what it is. */
let changes = 0;

export const useSettings = create<SettingsState>()((set, get) => ({
  ...initial,
  async follow() {
    let off: (() => void) | null = null;
    try {
      off = await on(EVENT_SETTINGS_CHANGED, (settings) => set({ settings }));
      set({ listenError: null });
    } catch (e) {
      set({ listenError: toWireError(e) });
    }
    await get().reload();
    return () => off?.();
  },
  async reload() {
    try {
      set({ settings: await settingsGet(), loadError: null });
    } catch (e) {
      set({ loadError: toWireError(e) });
    }
  },
  async change(patch, what) {
    const mine = ++changes;
    let stored: Settings;
    try {
      stored = await settingsSet(patch);
    } catch (e) {
      set({ problem: `${what} was not saved: ${errorText(toWireError(e))}` });
      return false;
    }
    if (mine === changes) set({ settings: stored });
    set({ problem: null });
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
    changes = 0;
    set(initial);
  },
}));
