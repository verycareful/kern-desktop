// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireEntry } from "../ipc";
import { fileType, isFolder } from "./file-type";

// The one implementation of the display order, run on the main thread for small
// folders and in a Web Worker (sort.worker.ts) for large ones. It works on
// plain arrays, not entries, so a worker needs only what the comparison reads.

export type SortBy = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

/** What the comparison reads, as flat arrays (the typed ones are transferred to the worker). */
export interface SortInput {
  names: string[];
  /** 1 for a folder or a link to one. */
  folder: Uint8Array;
  /** Present for sort by size. */
  len: Float64Array;
  /** Present for sort by modified; -Infinity for an unknown time (counts as the oldest). */
  modified: Float64Array;
  /** Present for sort by type. */
  types: string[];
}

export function prepareSortInput(entries: readonly WireEntry[], by: SortBy): SortInput {
  const n = entries.length;
  const names = new Array<string>(n);
  const folder = new Uint8Array(n);
  const len = new Float64Array(by === "size" ? n : 0);
  const modified = new Float64Array(by === "modified" ? n : 0);
  const types = by === "type" ? new Array<string>(n) : [];
  for (let i = 0; i < n; i++) {
    const e = entries[i]!;
    names[i] = e.name;
    folder[i] = isFolder(e) ? 1 : 0;
    if (by === "size") len[i] = e.len;
    else if (by === "modified") modified[i] = e.modified_ms ?? -Infinity;
    else if (by === "type") types[i] = fileType(e).mono.toLowerCase();
  }
  return { names, folder, len, modified, types };
}

const collators = new Map<string, Intl.Collator>();

// Natural, locale-aware order: "file2" before "file10", "e" and its accented
// form together. Always the collator itself, so the order is exactly the
// platform's in every locale; `locale` undefined is the environment's.
function collatorFor(locale: string | undefined): Intl.Collator {
  const key = locale ?? "";
  let c = collators.get(key);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true });
    collators.set(key, c);
  }
  return c;
}

/**
 * The indices of the entries in display order: folders first, then the rest,
 * each group ordered by `by` (`dir` flips that order, not the folders-first
 * rule). Ties fall back to the collator's name order, ascending, then to the
 * code-unit order of the names, then to the input order. Folders have no size
 * of their own, so by size they stay in name order.
 */
export function sortPermutation(
  input: SortInput,
  by: SortBy,
  dir: SortDir,
  locale?: string
): Uint32Array {
  const { names, folder, len, modified, types } = input;
  const collator = collatorFor(locale);
  const sign = dir === "asc" ? 1 : -1;
  const byName = (i: number, j: number): number => {
    const a = names[i]!;
    const b = names[j]!;
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0) || i - j;
  };
  const perm = new Uint32Array(names.length);
  for (let i = 0; i < perm.length; i++) perm[i] = i;
  perm.sort((i, j) => {
    if (folder[i] !== folder[j]) return folder[i] ? -1 : 1;
    switch (by) {
      case "name": {
        const a = names[i]!;
        const b = names[j]!;
        return sign * (collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)) || i - j;
      }
      case "size":
        return folder[i] ? byName(i, j) : sign * (len[i]! - len[j]!) || byName(i, j);
      case "modified":
        return sign * (modified[i]! - modified[j]! || 0) || byName(i, j);
      case "type": {
        const a = types[i]!;
        const b = types[j]!;
        return (a < b ? -sign : a > b ? sign : 0) || byName(i, j);
      }
    }
  });
  return perm;
}

export function applyPermutation<T>(items: readonly T[], perm: Uint32Array): T[] {
  const out = new Array<T>(perm.length);
  for (let k = 0; k < perm.length; k++) out[k] = items[perm[k]!]!;
  return out;
}
