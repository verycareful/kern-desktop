// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { PdfSearchMatch } from "../ipc";
import { stepHit, type HitRef, type PageHits } from "./find";

// The find bar of each PDF tab: what is asked, what was found, and which match is the current
// one. The search itself runs in `usePdfFind`; the pages draw the matches from here and the
// actions (Find, Find next, Find previous) reach the bar through here.

export interface FindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  hits: PageHits;
  current: HitRef | null;
  /** The search is still reading pages. */
  searching: boolean;
  /** Why the search stopped, in words. */
  error: string | null;
  /** Grows when the bar is asked for again while open, so its field takes the focus. */
  focus: number;
}

const FRESH: FindState = {
  open: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  hits: {},
  current: null,
  searching: false,
  error: null,
  focus: 0,
};

interface PdfFindState {
  byTab: Record<string, FindState>;
  /** Opens the bar of the tab, with `query` in its field when given. */
  open(tabId: string, query?: string): void;
  /** Closes the bar and forgets what it found; the question stays for the next time. */
  close(tabId: string): void;
  setQuery(tabId: string, query: string): void;
  setCaseSensitive(tabId: string, on: boolean): void;
  setWholeWord(tabId: string, on: boolean): void;
  /** A search starts: nothing found yet. */
  begin(tabId: string): void;
  /** What the search found on a page; the first match found becomes the current one. */
  report(tabId: string, page: number, matches: PdfSearchMatch[]): void;
  /** The search is over, or stopped with `error`. */
  finish(tabId: string, error: string | null): void;
  /** Forgets what was found, and the current match. */
  reset(tabId: string): void;
  /** Makes the next or the previous match the current one. */
  step(tabId: string, direction: 1 | -1): void;
  forget(tabId: string): void;
}

const patch = (state: PdfFindState, tabId: string, change: Partial<FindState>) => ({
  byTab: { ...state.byTab, [tabId]: { ...(state.byTab[tabId] ?? FRESH), ...change } },
});

export const usePdfFind = create<PdfFindState>()((set) => ({
  byTab: {},
  open: (tabId, query) =>
    set((s) => {
      const was = s.byTab[tabId] ?? FRESH;
      return patch(s, tabId, {
        open: true,
        focus: was.focus + 1,
        ...(query === undefined ? {} : { query }),
      });
    }),
  close: (tabId) =>
    set((s) =>
      patch(s, tabId, { open: false, hits: {}, current: null, searching: false, error: null })
    ),
  setQuery: (tabId, query) => set((s) => patch(s, tabId, { query })),
  setCaseSensitive: (tabId, caseSensitive) => set((s) => patch(s, tabId, { caseSensitive })),
  setWholeWord: (tabId, wholeWord) => set((s) => patch(s, tabId, { wholeWord })),
  begin: (tabId) =>
    set((s) => patch(s, tabId, { hits: {}, current: null, searching: true, error: null })),
  report: (tabId, page, matches) =>
    set((s) => {
      if (matches.length === 0) return s;
      const was = s.byTab[tabId] ?? FRESH;
      return patch(s, tabId, {
        hits: { ...was.hits, [page]: matches },
        current: was.current ?? { page, index: 0 },
      });
    }),
  finish: (tabId, error) => set((s) => patch(s, tabId, { searching: false, error })),
  reset: (tabId) =>
    set((s) => {
      const was = s.byTab[tabId];
      if (
        !was ||
        (was.current === null &&
          was.searching === false &&
          was.error === null &&
          Object.keys(was.hits).length === 0)
      )
        return s;
      return patch(s, tabId, { hits: {}, current: null, searching: false, error: null });
    }),
  step: (tabId, direction) =>
    set((s) => {
      const was = s.byTab[tabId];
      if (!was) return s;
      const next = stepHit(was.hits, was.current, direction);
      return next ? patch(s, tabId, { current: next }) : s;
    }),
  forget: (tabId) =>
    set((s) => {
      if (!(tabId in s.byTab)) return s;
      const rest = { ...s.byTab };
      delete rest[tabId];
      return { byTab: rest };
    }),
}));
