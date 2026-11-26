// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pdfText } from "../ipc";
import { pageText, type PageText } from "./text-lines";
import type { PdfDoc } from "./usePdfDoc";

/** The pages whose text is kept: a page's text is some kilobytes, so the cache holds a few megabytes. */
export const PAGE_TEXT_CAP = 64;

// The text of the pages read so far, keyed by document, the revision the page last changed at and
// the page, so a page no edit touched is read once and an edit to a page reads that page again.
// A read in flight is kept as its promise, so two askers share one request; a failed read is not
// kept, so the next ask tries again. The least recently used page leaves first.
const cache = new Map<string, Promise<PageText>>();

/** The text of page `page` (from 0) of `doc`, as the text layer and the selection use it. */
export function loadPageText(doc: PdfDoc, page: number): Promise<PageText> {
  const handle = doc.handle;
  if (handle === undefined) return Promise.reject(new Error("the PDF is not open"));
  const key = `${handle}:${doc.pageRevisions[page] ?? 0}:${page}`;
  const kept = cache.get(key);
  if (kept) {
    cache.delete(key);
    cache.set(key, kept);
    return kept;
  }
  const read = pdfText(handle, page).then(pageText);
  cache.set(key, read);
  read.catch(() => {
    if (cache.get(key) === read) cache.delete(key);
  });
  while (cache.size > PAGE_TEXT_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return read;
}

/** Forgets every page of a document (tests, and a document that is closed). */
export function dropPageText(handle: number): void {
  for (const key of cache.keys()) if (key.startsWith(`${handle}:`)) cache.delete(key);
}
