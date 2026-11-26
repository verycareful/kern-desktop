// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pdfCancelJob, pdfSearch, toWireError, type PdfSearchMatch } from "../ipc";
import type { PdfDoc } from "./usePdfDoc";

// Find in a PDF: the document is searched one page at a time, so the first matches show at once
// and a new search stops the old between two pages.

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  /** The page to begin at, counted from 0; the search goes on to the last page and then from the first. */
  from?: number;
}

/** One match: where it stands on its page, and the page. */
export interface HitRef {
  /** Counted from 0. */
  page: number;
  /** Position among the matches of the page, from 0. */
  index: number;
}

/** The matches found so far, by page (a page with none is absent). */
export type PageHits = Record<number, PdfSearchMatch[]>;

// The searches in flight: a cancelled one stops before its next page, because the engine knows a
// job only while a call of it is running.
const running = new Set<number>();
const stopped = new Set<number>();

const isCancelled = (e: unknown) => toWireError(e).kind === "Cancelled";

/**
 * Searches `doc` for `query`, calling `onPage` with the matches of each page as it is read (an
 * empty list for a page with none). An empty query reads nothing. Resolves when every page is read
 * or the job is cancelled with `cancelFind`; rejects with the engine's error otherwise.
 */
export async function findAll(
  doc: PdfDoc,
  query: string,
  opts: FindOptions,
  onPage: (page: number, matches: PdfSearchMatch[]) => void,
  job: number
): Promise<void> {
  const handle = doc.handle;
  if (handle === undefined) throw new Error("the PDF is not open");
  if (query.trim() === "") return;
  const pages = doc.pages;
  const from = Math.min(Math.max(0, opts.from ?? 0), Math.max(0, pages - 1));
  running.add(job);
  try {
    for (let i = 0; i < pages; i++) {
      if (stopped.has(job)) return;
      const page = (from + i) % pages;
      let matches: PdfSearchMatch[];
      try {
        matches = await pdfSearch(handle, page, query, opts.caseSensitive, opts.wholeWord, job);
      } catch (e) {
        if (isCancelled(e) || stopped.has(job)) return;
        throw e;
      }
      if (stopped.has(job)) return;
      onPage(page, matches);
    }
  } finally {
    running.delete(job);
    stopped.delete(job);
  }
}

/** Stops the search of `job`: the page it is on and every page after. Nothing if it is over. */
export async function cancelFind(job: number): Promise<void> {
  if (!running.has(job)) return;
  stopped.add(job);
  await pdfCancelJob(job).catch(() => undefined);
}

/** Every match of `hits` in the order of the document. */
export function orderedHits(hits: PageHits): HitRef[] {
  return Object.keys(hits)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((page) => (hits[page] ?? []).map((_, index) => ({ page, index })));
}

/** How many matches there are. */
export function countHits(hits: PageHits): number {
  return Object.values(hits).reduce((n, list) => n + list.length, 0);
}

/**
 * The match after (`1`) or before (`-1`) `current`, going round from the last to the first and
 * from the first to the last. With no current match, the first (or the last, going back).
 */
export function stepHit(hits: PageHits, current: HitRef | null, direction: 1 | -1): HitRef | null {
  const all = orderedHits(hits);
  if (all.length === 0) return null;
  const at = current
    ? all.findIndex((h) => h.page === current.page && h.index === current.index)
    : -1;
  if (at < 0) return direction === 1 ? all[0]! : all[all.length - 1]!;
  return all[(at + direction + all.length) % all.length]!;
}

/** The position of `current` among the matches, from 1; 0 when it is none of them. */
export function positionOf(hits: PageHits, current: HitRef | null): number {
  if (!current) return 0;
  return (
    orderedHits(hits).findIndex((h) => h.page === current.page && h.index === current.index) + 1
  );
}
