// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { LineEnding } from "../ipc";

// What the status bar shows for a document tab (design D6.2): the cursor
// position, the encoding and the line ending. The editor publishes them here,
// keyed by tab id, the way the folder view publishes its counts
// (files/folder-status.ts), so a cursor move re-renders the status bar and not
// the editor. The dirty dot comes from the tab itself (DocTab.dirty).
export interface DocStatus {
  /** 1-based line of the cursor. */
  line: number;
  /** 1-based column of the cursor, counted in characters (a code point is one). */
  col: number;
  bom: boolean;
  ending: LineEnding;
}

interface DocStatusState {
  byTab: Record<string, DocStatus>;
  /** Merges `patch` into the tab's status; a tab with none yet starts at Ln 1, Col 1, UTF-8, LF. */
  patch(tabId: string, patch: Partial<DocStatus>): void;
  clear(tabId: string): void;
}

const START: DocStatus = { line: 1, col: 1, bom: false, ending: "lf" };

export const useDocStatus = create<DocStatusState>()((set) => ({
  byTab: {},
  patch: (tabId, patch) =>
    set((s) => {
      const old = s.byTab[tabId] ?? START;
      const next = { ...old, ...patch };
      if (
        s.byTab[tabId] &&
        old.line === next.line &&
        old.col === next.col &&
        old.bom === next.bom &&
        old.ending === next.ending
      ) {
        return s;
      }
      return { byTab: { ...s.byTab, [tabId]: next } };
    }),
  clear: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));

/** "UTF-8" or "UTF-8 with BOM" (Unicode Standard 23.8 calls U+FEFF at the start a byte order mark). */
export const encodingText = (bom: boolean): string => (bom ? "UTF-8 with BOM" : "UTF-8");

export const endingText = (ending: LineEnding): string => (ending === "crlf" ? "CRLF" : "LF");

/**
 * The 1-based column of offset `head` in the line that starts at `from`:
 * UTF-16 units up to the cursor, less one for every surrogate pair, so a
 * character outside the Basic Multilingual Plane counts once.
 */
export function columnOf(lineText: string, head: number, from: number): number {
  const end = head - from;
  let n = end;
  for (let i = 1; i < end; i++) {
    const lo = lineText.charCodeAt(i);
    if (lo >= 0xdc00 && lo <= 0xdfff) {
      const hi = lineText.charCodeAt(i - 1);
      if (hi >= 0xd800 && hi <= 0xdbff) n--;
    }
  }
  return n + 1;
}
