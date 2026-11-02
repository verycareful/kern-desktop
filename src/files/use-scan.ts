// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EVENT_SEARCH_HIT,
  on,
  toWireError,
  type OpId,
  type WireEntry,
  type WireError,
  type WireScanDone,
} from "../ipc";
import { runOp, type RunningOp } from "../ops/run-op";

// A walk that streams what it finds: name search and the Documents view
// (kernkraft-tauri search_cmds.rs). Each run has a key of its own; its hits
// arrive as kernkraft://search-hit batches carrying that key, and its end as
// op-done, after the last batch. The hits are kept in a list that only grows
// and the view is told how long it is, so a walk that finds a great many does
// not copy them all on every batch. A new run, and leaving the view, cancel
// the one before.

export type ScanPhase = "idle" | "running" | "done" | "failed";

export interface Scan {
  phase: ScanPhase;
  /** The hits so far, in the order found. Read it with `count`, which changes as it grows. */
  hits: readonly WireEntry[];
  count: number;
  /** How the walk ended, once it has. */
  done: WireScanDone | null;
  error: WireError | null;
  /** Starts a run with this start command, cancelling the one before. */
  start(begin: (key: string) => Promise<OpId>): void;
  /** Cancels the run and clears the hits. */
  stop(): void;
}

export function useScan(): Scan {
  const hits = useRef<WireEntry[]>([]);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [done, setDone] = useState<WireScanDone | null>(null);
  const [error, setError] = useState<WireError | null>(null);
  /** The run on show; anything from another is ignored. */
  const current = useRef<{ key: string; op: RunningOp | null; ended: boolean } | null>(null);

  const cancel = useCallback(() => {
    const run = current.current;
    current.current = null;
    // A walk nobody waits for is stopped. If the cancel fails the walk runs to its end,
    // which only reads, and its results go nowhere.
    if (run && !run.ended) run.op?.cancel().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    cancel();
    hits.current = [];
    setCount(0);
    setPhase("idle");
    setDone(null);
    setError(null);
  }, [cancel]);

  const start = useCallback(
    (begin: (key: string) => Promise<OpId>) => {
      stop();
      const key = crypto.randomUUID();
      const run = { key, op: null as RunningOp | null, ended: false };
      current.current = run;
      setPhase("running");
      const mine = () => current.current === run;
      void (async () => {
        let unlisten: (() => void) | null = null;
        try {
          unlisten = await on(EVENT_SEARCH_HIT, (h) => {
            if (h.key !== key || !mine()) return;
            hits.current.push(...h.entries);
            setCount(hits.current.length);
          });
          if (!mine()) return;
          run.op = runOp(
            () => begin(key),
            () => undefined
          );
          const end = await run.op.done;
          run.ended = true;
          if (!mine()) return;
          if (end.error) {
            setError(end.error);
            setPhase("failed");
          } else {
            setDone(end.scan);
            setPhase("done");
          }
        } catch (e) {
          run.ended = true;
          if (!mine()) return;
          setError(toWireError(e));
          setPhase("failed");
        } finally {
          unlisten?.();
        }
      })();
    },
    [stop]
  );

  useEffect(() => cancel, [cancel]);

  return { phase, hits: hits.current, count, done, error, start, stop };
}
