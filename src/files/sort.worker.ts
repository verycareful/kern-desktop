// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { sortPermutation, type SortBy, type SortDir, type SortInput } from "./sort-core";

// The sorting worker: receives what the comparison reads, answers with the
// index permutation (its buffer transferred, not copied).
interface Request {
  id: number;
  input: SortInput;
  by: SortBy;
  dir: SortDir;
  locale?: string;
}

const scope = self as unknown as {
  onmessage: ((e: { data: Request }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data }) => {
  try {
    const perm = sortPermutation(data.input, data.by, data.dir, data.locale);
    scope.postMessage({ id: data.id, perm }, [perm.buffer]);
  } catch (e) {
    scope.postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) });
  }
};
