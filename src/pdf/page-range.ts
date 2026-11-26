// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// The pages a person types for Extract and Split: `1-3,5,7-9`, numbered from 1 as the page counter
// shows them. The grammar is the engine's own (kernkraft-pdf `parse_ranges`), so what is accepted
// here is what the engine accepts: pages and ranges split by commas, blanks ignored, empty items
// skipped, a number written in ASCII digits only. A page that does not exist, a range that runs
// backwards and a text with no pages at all are refused with the reason, never clamped.

/** A run of pages, counted from 1, both ends included. */
export interface PageSpan {
  start: number;
  end: number;
}

export type RangeParse =
  | {
      ok: true;
      /** The ranges as the engine reads them: no blanks, no empty items. */ spec: string;
      ranges: PageSpan[];
    }
  | { ok: false; error: string };

/** The largest number the engine reads as a page (an unsigned 32-bit integer). */
const MAX_PAGE_NUMBER = 4_294_967_295;

const refuse = (error: string): RangeParse => ({ ok: false, error });

/** `text` as a page number: one or more ASCII digits that fit 32 bits; null otherwise. */
function pageNumber(text: string): number | null {
  if (!/^[0-9]+$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_PAGE_NUMBER ? n : null;
}

/** Reads `text` against a document of `pages` pages. */
export function parseRanges(text: string, pages: number): RangeParse {
  const tokens = text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length === 0) return refuse("Write the pages, for example 1-3,5.");
  if (pages < 1) return refuse("This PDF has no pages.");
  const ranges: PageSpan[] = [];
  for (const token of tokens) {
    const dash = token.indexOf("-");
    const [a, b] =
      dash < 0 ? [token, token] : [token.slice(0, dash).trim(), token.slice(dash + 1).trim()];
    const start = pageNumber(a);
    const end = pageNumber(b);
    if (start === null || end === null)
      return refuse(`${token} is not a page or a range of pages.`);
    for (const page of [start, end]) {
      if (page < 1 || page > pages) {
        return refuse(`Page ${page} does not exist. Pages run from 1 to ${pages}.`);
      }
    }
    if (start > end) return refuse(`${token} runs backwards. Write it as ${end}-${start}.`);
    ranges.push({ start, end });
  }
  return { ok: true, spec: tokens.map(compact).join(","), ranges };
}

/** A token without blanks around its dash. */
function compact(token: string): string {
  return token.replace(/\s+/g, "");
}

/** The pages of the ranges counted from 0, in the order written. */
export function pagesOf(ranges: readonly PageSpan[]): number[] {
  const out: number[] = [];
  for (const { start, end } of ranges) {
    for (let page = start; page <= end; page++) out.push(page - 1);
  }
  return out;
}

/**
 * Extract keeps each page once, in the order given: a page listed twice (or in two overlapping
 * ranges) is refused by the engine, so it is refused here with its number.
 */
export function refuseRepeatedPages(ranges: readonly PageSpan[]): string | null {
  const seen = new Set<number>();
  for (const page of pagesOf(ranges)) {
    if (seen.has(page)) return `Page ${page + 1} is listed twice.`;
    seen.add(page);
  }
  return null;
}

/** What a range is called in a file name: `5` for a single page, `1-3` for a run. */
export function rangeFileKeys(ranges: readonly PageSpan[]): string[] {
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`));
}

/**
 * Split writes one file per range, named after its pages, so two ranges with the same first and
 * last page would write the same file; the engine refuses them. Overlapping ranges are fine.
 */
export function refuseRepeatedRanges(ranges: readonly PageSpan[]): string | null {
  const seen = new Set<string>();
  for (const key of rangeFileKeys(ranges)) {
    if (seen.has(key)) {
      return key.includes("-")
        ? `${key} is listed twice, so two files would have the same name.`
        : `Page ${key} is listed twice, so two files would have the same name.`;
    }
    seen.add(key);
  }
  return null;
}

/** `pages` (from 0, any order) as the text a person would type: `1-3,5`, from 1, runs joined. */
export function formatRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] ?? 0) + 1) j++;
    const first = (sorted[i] ?? 0) + 1;
    const last = (sorted[j] ?? 0) + 1;
    parts.push(first === last ? `${first}` : `${first}-${last}`);
    i = j + 1;
  }
  return parts.join(",");
}
