// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  EVENT_SETTINGS_CHANGED,
  on,
  settingsGet,
  settingsSet,
  themeSetPrefs,
  THEME_DENSITY,
  toWireError,
  type Follow,
  type Settings,
  type SettingsPatch,
  type WireError,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { NEEDS_RESTART } from "./restart-fields";

// The settings the Settings window shows, and the changes made in it that are not saved yet.
//
// `stored` is settings.json as Kern last read it: read once, then followed through
// kern://settings-changed, so a change made elsewhere (Ctrl+H, the view buttons, another Kern
// window) shows here. `draft` holds only the fields changed in this window, each different from
// its stored value; a field changed back to what is stored leaves the draft. What the window shows
// is the stored settings with the draft over them, so a field not changed here keeps following
// the store.
//
// Save sends the draft, and only the draft, in one settings_set, which answers with the settings
// as stored; when a theme field is among them (mode, accent, the Follow system switches) they are
// then handed to the theme with theme_set_prefs, which re-themes every window. While a save is
// out, what it sends is shown and a change made meanwhile is measured against it; a save that
// fails puts what it sent back into the draft, under any change made since, and says why. A saved change to a field that applies only at start
// (restart-fields.ts) makes Restart to apply show.

/** The store file the settings are kept in (store.rs). */
export const SETTINGS_FILE = "settings.json";

/** The settings fields the theme is resolved with. */
const THEME_FIELDS: readonly (keyof SettingsPatch)[] = ["theme_mode", "accent", "follow"];

interface DraftState {
  stored: Settings | null;
  draft: SettingsPatch;
  /** Why the settings could not be read, until they are. */
  loadError: WireError | null;
  /** Why changes made elsewhere are not followed, for as long as they are not. */
  listenError: WireError | null;
  /** The last save that failed, in words, until the next one succeeds. */
  problem: string | null;
  saving: boolean;
  /** What the save that is out sends, until it is answered. */
  sending: SettingsPatch | null;
  /** A saved change applies only once Kern starts again. */
  restartNeeded: boolean;
  /** Reads the settings and follows their changes; the returned function stops following. */
  follow(): Promise<() => void>;
  /** Reads the settings again, without following anything more. */
  reload(): Promise<void>;
  /** Changes what the window shows; nothing is stored until `save`. */
  edit(patch: SettingsPatch): void;
  /** Drops every change not saved. */
  revert(): void;
  /** Stores the draft; true when it was stored and applied (or there was nothing to store). */
  save(): Promise<boolean>;
  /** Settles once no save is out. */
  settled(): Promise<void>;
  reset(): void;
}

const initial = {
  stored: null,
  draft: {},
  loadError: null,
  listenError: null,
  problem: null,
  saving: false,
  sending: null,
  restartNeeded: false,
};

/** The save that is out, if any. */
let inFlight: Promise<boolean> | null = null;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** `draft` with every field that equals its stored value taken out. */
function normalized(draft: SettingsPatch, stored: Settings | null): SettingsPatch {
  if (!stored) return draft;
  const out: SettingsPatch = {};
  for (const [key, value] of Object.entries(draft) as [keyof SettingsPatch, unknown][]) {
    if (key === "follow") {
      const follow = Object.fromEntries(
        Object.entries(value as Partial<Follow>).filter(
          ([k, v]) => v !== stored.follow[k as keyof Follow]
        )
      );
      if (Object.keys(follow).length > 0) out.follow = follow;
    } else if (!same(value, stored[key])) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** `settings` with `patch` over them. */
const patched = (settings: Settings, patch: SettingsPatch): Settings => ({
  ...settings,
  ...patch,
  follow: { ...settings.follow, ...patch.follow },
});

/**
 * What the draft is measured against: the stored settings, and while a save is out what it
 * sends, which is what the store will hold once it answers.
 */
function base(s: { stored: Settings | null; sending: SettingsPatch | null }): Settings | null {
  if (!s.stored) return null;
  return s.sending ? patched(s.stored, s.sending) : s.stored;
}

/** What the window shows: the stored settings with the save being sent and the draft over them. */
export function shown(s: {
  stored: Settings | null;
  sending: SettingsPatch | null;
  draft: SettingsPatch;
}): Settings | null {
  const under = base(s);
  return under && patched(under, s.draft);
}

/** Whether the window holds a change not saved. */
export const isDirty = (s: { draft: SettingsPatch }): boolean => Object.keys(s.draft).length > 0;

export const useSettingsDraft = create<DraftState>()((set, get) => ({
  ...initial,
  async follow() {
    let off: (() => void) | null = null;
    try {
      off = await on(EVENT_SETTINGS_CHANGED, (stored) =>
        set((s) => ({ stored, draft: normalized(s.draft, base({ ...s, stored })) }))
      );
      set({ listenError: null });
    } catch (e) {
      set({ listenError: toWireError(e) });
    }
    await get().reload();
    return () => off?.();
  },
  async reload() {
    try {
      const stored = await settingsGet();
      set((s) => ({
        stored,
        draft: normalized(s.draft, base({ ...s, stored })),
        loadError: null,
      }));
    } catch (e) {
      set({ loadError: toWireError(e) });
    }
  },
  edit(patch) {
    set((s) => {
      const merged: SettingsPatch = { ...s.draft, ...patch };
      if (patch.follow) merged.follow = { ...s.draft.follow, ...patch.follow };
      return { draft: normalized(merged, base(s)) };
    });
  },
  revert() {
    set({ draft: {}, problem: null });
  },
  save() {
    if (get().saving) return Promise.resolve(false);
    if (!isDirty(get())) return Promise.resolve(true);
    const run = store(get().draft);
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  },
  async settled() {
    await inFlight;
  },
  reset() {
    inFlight = null;
    set(initial);
  },
}));

/** Stores `draft` and hands any theme field of it to the theme; see `save`. */
async function store(draft: SettingsPatch): Promise<boolean> {
  const set = useSettingsDraft.setState;
  // What is sent leaves the draft: a change made while the save is out is measured against it.
  set({ saving: true, sending: draft, draft: {} });
  let stored: Settings;
  try {
    stored = await settingsSet(draft);
  } catch (e) {
    // Not stored: what was sent is a change again, under any made since.
    set((s) => ({
      saving: false,
      sending: null,
      draft: normalized(
        { ...draft, ...s.draft, follow: { ...draft.follow, ...s.draft.follow } },
        s.stored
      ),
      problem: `The settings were not saved: ${errorText(toWireError(e))}`,
    }));
    return false;
  }
  const restart = NEEDS_RESTART.some((f) => f in draft);
  set((s) => ({
    stored,
    sending: null,
    draft: normalized(s.draft, stored),
    saving: false,
    problem: null,
    restartNeeded: s.restartNeeded || restart,
  }));
  if (!THEME_FIELDS.some((f) => f in draft)) return true;
  try {
    await themeSetPrefs(stored.follow, {
      mode: stored.theme_mode,
      accent: stored.accent,
      density: THEME_DENSITY,
    });
    return true;
  } catch (e) {
    set({
      problem: `The settings were saved, but the theme could not be changed to them: ${errorText(toWireError(e))}`,
    });
    return false;
  }
}
