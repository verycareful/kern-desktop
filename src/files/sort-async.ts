// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireError, WireEntry } from "../ipc";
import { applyPermutation, prepareSortInput, type SortBy, type SortDir } from "./sort-core";
import { sortEntries } from "./sort";

/**
 * Folders with more entries than this are sorted in a Web Worker. At or below
 * it a synchronous collator sort costs a few milliseconds (about 5 ms for 5000
 * names measured with the non-ASCII mix of the tests), less than a frame, so a
 * worker round trip would only add latency.
 */
export const SORT_IN_WORKER_ABOVE = 5000;

export interface Sorter {
  /** Resolves with the entries in display order; rejects with a WireError of kind "Sort". */
  sort(entries: readonly WireEntry[], by: SortBy, dir: SortDir): Promise<WireEntry[]>;
  /** Ends the worker; what was waiting is rejected. A later sort starts a new one. */
  dispose(): void;
}

// Vite bundles the worker as its own file served from the app's origin, which
// the CSP's script-src 'self' covers (worker-src falls back to it).
const defaultWorker = () =>
  new Worker(new URL("./sort.worker.ts", import.meta.url), { type: "module" });

const sortError = (message: string): WireError => ({
  kind: "Sort",
  message,
  path: null,
  details: null,
});

interface Waiting {
  entries: readonly WireEntry[];
  resolve(sorted: WireEntry[]): void;
  reject(e: WireError): void;
}

export function createSorter(makeWorker: () => Worker = defaultWorker): Sorter {
  let worker: Worker | null = null;
  let nextId = 0;
  const waiting = new Map<number, Waiting>();

  const failAll = (message: string) => {
    const w = worker;
    worker = null;
    w?.terminate();
    const all = [...waiting.values()];
    waiting.clear();
    for (const p of all) p.reject(sortError(message));
  };

  const start = (): Worker => {
    const w = makeWorker();
    w.addEventListener("message", (ev) => {
      const data = (ev as MessageEvent<{ id: number; perm?: Uint32Array; error?: string }>).data;
      const p = waiting.get(data.id);
      if (!p) return;
      waiting.delete(data.id);
      if (data.perm) p.resolve(applyPermutation(p.entries, data.perm));
      else p.reject(sortError(data.error ?? "the sorting worker failed"));
    });
    w.addEventListener("error", (ev) =>
      failAll(`the sorting worker failed: ${(ev as ErrorEvent).message || "unknown error"}`)
    );
    w.addEventListener("messageerror", () =>
      failAll("the sorting worker sent a reply that could not be read")
    );
    return w;
  };

  return {
    sort(entries, by, dir) {
      if (entries.length <= SORT_IN_WORKER_ABOVE) {
        return Promise.resolve(sortEntries(entries, by, dir));
      }
      return new Promise<WireEntry[]>((resolve, reject) => {
        try {
          worker ??= start();
          const id = ++nextId;
          waiting.set(id, { entries, resolve, reject });
          const input = prepareSortInput(entries, by);
          const transfer = [input.folder.buffer, input.len.buffer, input.modified.buffer];
          worker.postMessage({ id, input, by, dir }, transfer);
        } catch (e) {
          failAll(`the sorting worker could not be started: ${String(e)}`);
          reject(sortError(`the sorting worker could not be started: ${String(e)}`));
        }
      });
    },
    dispose() {
      failAll("the sort was cancelled");
    },
  };
}
