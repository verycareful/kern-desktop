// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { WireError } from "../ipc";
import { logError } from "./error-log";
import { errorText } from "./error-text";

// What an editor window says when a file could not be opened from its folder tree: one message at
// a time, in the middle of the editor area (OpenError.tsx). Each open replaces the message, and an
// open that succeeds clears it, as a folder view's banner does.

interface OpenErrorState {
  /** One line per file that failed in the last open; empty when nothing is shown. */
  lines: string[];
  show(lines: readonly string[]): void;
  dismiss(): void;
}

export const useOpenError = create<OpenErrorState>()((set) => ({
  lines: [],
  show: (lines) => set({ lines: [...lines] }),
  dismiss: () => set({ lines: [] }),
}));

/** Shows the failures of opening `name`, replacing what was shown; no failures clears it. */
export function showOpenErrors(name: string, errors: readonly WireError[]): void {
  const lines = errors.map((e) => `${name} was not opened: ${errorText(e)}`);
  useOpenError.getState().show(lines);
  lines.forEach((line) => logError("open", line));
}
