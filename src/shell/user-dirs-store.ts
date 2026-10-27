// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { toWireError, userDirs, type WireError, type WireUserDirs } from "../ipc";

// Home and the user's folders (xdg-user-dirs) change rarely, and the places
// strip is built again each time the window switches between layouts, so they
// are looked up once and kept, and read again when the window regains focus (a folder created or removed meanwhile). A failed lookup is not kept: the next call
// asks again, and a failed re-read leaves the folders shown with the error beside them.

interface UserDirsState {
  dirs: WireUserDirs | null;
  error: WireError | null;
  /** The folders; asks the backend only when none are kept (a call in flight is shared). */
  load(): Promise<WireUserDirs>;
  /** Asks the backend again, keeping the folders shown until the answer; calls share one lookup. */
  refresh(): Promise<WireUserDirs>;
  reset(): void;
}

let inflight: Promise<WireUserDirs> | null = null;

export const useUserDirs = create<UserDirsState>()((set, get) => ({
  dirs: null,
  error: null,
  load() {
    const kept = get().dirs;
    return kept ? Promise.resolve(kept) : get().refresh();
  },
  refresh() {
    inflight ??= userDirs().then(
      (dirs) => {
        inflight = null;
        set({ dirs, error: null });
        return dirs;
      },
      (e: unknown) => {
        inflight = null;
        const error = toWireError(e);
        set({ error });
        throw error;
      }
    );
    return inflight;
  },
  reset() {
    inflight = null;
    set({ dirs: null, error: null });
  },
}));
