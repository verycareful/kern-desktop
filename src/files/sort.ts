// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireEntry } from "../ipc";
import { fileType, isFolder } from "./file-type";

export type SortBy = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

// Natural, locale-aware order: "file2" before "file10", "e" and "é" together.
const collator = new Intl.Collator(undefined, { numeric: true });

function byName(a: WireEntry, b: WireEntry): number {
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

interface Row {
  e: WireEntry;
  folder: boolean;
  /** Type-column key, computed once per entry rather than once per comparison. */
  type: string;
}

/**
 * The entries in display order: folders first, then the rest, each group
 * ordered by `by` (`dir` flips that order, not the folders-first rule). Ties
 * fall back to the natural name order, ascending. Folders have no size of
 * their own, so by size they stay in name order. An unknown modification
 * time counts as the oldest. Does not change `entries`.
 */
export function sortEntries(entries: readonly WireEntry[], by: SortBy, dir: SortDir): WireEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  const rows: Row[] = entries.map((e) => ({
    e,
    folder: isFolder(e),
    type: by === "type" ? fileType(e).mono.toLowerCase() : "",
  }));
  const primary = (a: Row, b: Row): number => {
    switch (by) {
      case "name":
        return sign * byName(a.e, b.e);
      case "size":
        return a.folder ? 0 : sign * (a.e.len - b.e.len);
      case "modified":
        return sign * ((a.e.modified_ms ?? -Infinity) - (b.e.modified_ms ?? -Infinity) || 0);
      case "type":
        return a.type < b.type ? -sign : a.type > b.type ? sign : 0;
    }
  };
  rows.sort((a, b) => {
    if (a.folder !== b.folder) return a.folder ? -1 : 1;
    return primary(a, b) || (by === "name" ? 0 : byName(a.e, b.e));
  });
  return rows.map((r) => r.e);
}
