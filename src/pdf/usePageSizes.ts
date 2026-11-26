// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useRef, useState } from "react";
import { toWireError, type PdfHandle, type WireError } from "../ipc";
import { pageSizes, type PageSize } from "./page-geometry";

export interface PageSizes {
  /** The size of every page, null until they are read; the last answer stays while a new edit is read. */
  sizes: PageSize[] | null;
  /** The revision of the document the sizes were read at; -1 before they are read. */
  readAt: number;
  /** Why the sizes could not be read. */
  error: WireError | null;
}

interface Read {
  handle: PdfHandle;
  sizes: PageSize[];
  at: number;
}

/**
 * The pages of `before` that an edit since it was read has changed, as the document's own
 * revision of each page says; null when the read cannot be built on (another document, or a
 * different number of pages, which moves every page).
 */
export function pagesChangedSince(
  before: Read | null,
  handle: PdfHandle,
  pages: number,
  pageRevisions: readonly number[]
): number[] | null {
  if (!before || before.handle !== handle || before.sizes.length !== pages) return null;
  const changed: number[] = [];
  for (let page = 0; page < pages; page += 1) {
    if ((pageRevisions[page] ?? 0) > before.at) changed.push(page);
  }
  return changed;
}

// The size of every page of an open PDF, read once for the pages and the thumbnails beside them,
// and again when an edit changes the document. An edit asks the engine only for the pages it
// changed (an annotation or a text edit changes one page and leaves its size, a rotation changes
// the size of the pages it turned): the pages are drawn again once the sizes are current, so
// asking for all of them on each edit held every edit's picture back by the number of pages.
export function usePageSizes(
  handle: PdfHandle | undefined,
  pages: number,
  revision: number,
  pageRevisions: readonly number[]
): PageSizes {
  const [read, setRead] = useState<Read | null>(null);
  const [error, setError] = useState<WireError | null>(null);
  const latest = useRef({ read, pageRevisions });
  latest.current = { read, pageRevisions };
  useEffect(() => {
    if (handle === undefined) return;
    let stale = false;
    setError(null);
    const before = latest.current.read;
    const changed = pagesChangedSince(before, handle, pages, latest.current.pageRevisions);
    const done = (sizes: PageSize[]) => {
      if (!stale) setRead({ handle, sizes, at: revision });
    };
    const failed = (e: unknown) => {
      if (!stale) setError(toWireError(e));
    };
    if (before && changed) {
      if (changed.length === 0) {
        done(before.sizes);
      } else {
        pageSizes(handle, changed, () => stale).then((fresh) => {
          const sizes = [...before.sizes];
          changed.forEach((page, i) => {
            const size = fresh[i];
            if (size) sizes[page] = size;
          });
          done(sizes);
        }, failed);
      }
    } else {
      pageSizes(handle, pages, () => stale).then(done, failed);
    }
    return () => {
      stale = true;
    };
  }, [handle, pages, revision]);
  return {
    sizes: read && read.handle === handle ? read.sizes : null,
    readAt: read && read.handle === handle ? read.at : -1,
    error,
  };
}
