// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
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

// The size of every page of an open PDF, read once for the pages and the thumbnails beside them,
// and again when an edit changes the document.
export function usePageSizes(
  handle: PdfHandle | undefined,
  pages: number,
  revision: number
): PageSizes {
  const [read, setRead] = useState<{ sizes: PageSize[]; at: number } | null>(null);
  const [error, setError] = useState<WireError | null>(null);
  useEffect(() => {
    if (handle === undefined) return;
    let stale = false;
    setError(null);
    pageSizes(handle, pages, () => stale).then(
      (sizes) => {
        if (!stale) setRead({ sizes, at: revision });
      },
      (e) => {
        if (!stale) setError(toWireError(e));
      }
    );
    return () => {
      stale = true;
    };
  }, [handle, pages, revision]);
  return { sizes: read?.sizes ?? null, readAt: read?.at ?? -1, error };
}
