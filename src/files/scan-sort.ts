// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import { toWireError, type WireEntry, type WireError } from "../ipc";
import { FIRST_DIR } from "./folder-ui";
import type { SortBy, SortDir } from "./sort";
import { createSorter, type Sorter } from "./sort-async";

// How the results of a search or of the Library are ordered. They stream in the order found, and
// are sorted by a column only once the walk has ended: a list that is still growing cannot be
// put in order, and one that reshuffles under the pointer cannot be clicked.

export interface ScanSort {
  by: SortBy;
  dir: SortDir;
}

// The choice outlives the view, so a new walk (Look again, another query) keeps the order the
// user asked for. One slot per kind of result.
const remembered = new Map<string, ScanSort | null>();

/** The column the results are sorted by (null: the order found) and the way to change it. */
export function useScanSort(slot: string): { sort: ScanSort | null; choose(by: SortBy): void } {
  const [sort, setSort] = useState<ScanSort | null>(remembered.get(slot) ?? null);
  const choose = useCallback(
    (by: SortBy) =>
      setSort((cur) => {
        const next: ScanSort =
          cur?.by === by
            ? { by, dir: cur.dir === "asc" ? "desc" : "asc" }
            : { by, dir: FIRST_DIR[by] };
        remembered.set(slot, next);
        return next;
      }),
    [slot]
  );
  return { sort, choose };
}

/** Forgets every remembered order (tests). */
export function forgetScanSorts(): void {
  remembered.clear();
}

interface Sorted {
  source: readonly WireEntry[];
  count: number;
  sort: ScanSort;
  list: WireEntry[];
}

/**
 * `hits` in the order of `sort` once `sortable` (the walk has ended), else as found. A sort that
 * fails leaves the order found and says why in `error`.
 */
export function useSortedHits(
  hits: readonly WireEntry[],
  count: number,
  sort: ScanSort | null,
  sortable: boolean
): { list: readonly WireEntry[]; error: WireError | null } {
  const sorter = useRef<Sorter | null>(null);
  const [done, setDone] = useState<Sorted | null>(null);
  const [failed, setFailed] = useState<{ sort: ScanSort; error: WireError } | null>(null);
  const by = sort?.by;
  const dir = sort?.dir;

  useEffect(() => {
    if (!sortable || by === undefined || dir === undefined) return;
    let live = true;
    sorter.current ??= createSorter();
    const mine: ScanSort = { by, dir };
    sorter.current.sort(hits.slice(0, count), by, dir).then(
      (list) => {
        if (!live) return;
        setFailed(null);
        setDone({ source: hits, count, sort: mine, list });
      },
      (e: unknown) => live && setFailed({ sort: mine, error: toWireError(e) })
    );
    return () => {
      live = false;
    };
  }, [sortable, by, dir, hits, count]);
  useEffect(() => () => sorter.current?.dispose(), []);

  if (!sortable || !sort) return { list: hits, error: null };
  if (failed && failed.sort.by === sort.by && failed.sort.dir === sort.dir) {
    return { list: hits, error: failed.error };
  }
  const fresh =
    done &&
    done.source === hits &&
    done.count === count &&
    done.sort.by === sort.by &&
    done.sort.dir === sort.dir;
  return { list: fresh ? done.list : hits, error: null };
}
