// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireEntry } from "../ipc";
import { applyPermutation, prepareSortInput, sortPermutation } from "./sort-core";

export type { SortBy, SortDir } from "./sort-core";
import type { SortBy, SortDir } from "./sort-core";

/**
 * The entries in display order, on the calling thread (see sort-core.ts for
 * the order; sort-async.ts for the worker used with large folders). `locale`
 * is for tests; leave it out to use the environment's. Does not change
 * `entries`.
 */
export function sortEntries(
  entries: readonly WireEntry[],
  by: SortBy,
  dir: SortDir,
  locale?: string
): WireEntry[] {
  return applyPermutation(entries, sortPermutation(prepareSortInput(entries, by), by, dir, locale));
}
