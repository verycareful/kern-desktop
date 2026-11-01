// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import {
  EVENT_STORE_ERROR,
  on,
  storeErrorsTake,
  toWireError,
  type CorruptReport,
  type WireError,
} from "../ipc";

// The backend hands each report of an unreadable store file (settings.json,
// pins.json, recents.json; store_cmds.rs) over once, through store_errors_take,
// and announces new ones with kern://store-error. They are kept here, all of
// them, so that every part of the window that shows one (Pinned and Recent for
// pins.json and recents.json, the settings view for settings.json) reads the
// same list and a take by one never hides a report from another.

interface StoreErrorsState {
  reports: CorruptReport[];
  /** Why the reports could not be read, if the last take failed. */
  error: WireError | null;
  /** Follows kern://store-error and takes what is queued; the returned function stops following. */
  follow(): Promise<() => void>;
  /** Takes what the backend has queued. A call made while a take runs is answered by one more take after it. */
  take(): Promise<void>;
  reset(): void;
}

let taking: Promise<void> | null = null;
let again = false;
let followers = 0;
let off: (() => void) | null = null;

export const useStoreErrors = create<StoreErrorsState>()((set, get) => ({
  reports: [],
  error: null,
  async follow() {
    followers++;
    if (followers === 1) {
      try {
        const unlisten = await on(EVENT_STORE_ERROR, () => void get().take());
        // The last follower may have stopped while the subscription was made.
        if (followers > 0) off = unlisten;
        else unlisten();
      } catch (e) {
        set({ error: toWireError(e) });
      }
    }
    await get().take();
    return () => {
      followers--;
      if (followers === 0) {
        off?.();
        off = null;
      }
    };
  },
  take() {
    if (taking) {
      again = true;
      return taking;
    }
    taking = (async () => {
      try {
        do {
          again = false;
          const taken = await storeErrorsTake();
          // A report taken is kept before anything else, so none is lost.
          set((s) => ({ reports: [...s.reports, ...taken], error: null }));
        } while (again);
      } catch (e) {
        set({ error: toWireError(e) });
      } finally {
        taking = null;
      }
    })();
    return taking;
  },
  reset() {
    taking = null;
    again = false;
    followers = 0;
    off?.();
    off = null;
    set({ reports: [], error: null });
  },
}));
