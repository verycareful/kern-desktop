// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useCallback, useEffect, useRef, useState } from "react";
import { toWireError, type WirePath } from "../ipc";
import { errorText } from "../ops/error-text";
import { startJob, type FileJob, type JobProgress } from "./page-files";

// The one long call of a page-file dialog (Merge, Extract or Split) and how far it has come. The
// dialog shows the form while idle, the progress line with Cancel while running, and the files
// written or the reason it failed afterwards.

export type JobView =
  | { phase: "idle" }
  | { phase: "running"; progress: JobProgress | null; cancelling: boolean }
  | { phase: "done"; paths: WirePath[] }
  | { phase: "failed"; message: string; cancelled: boolean };

export interface PageJob {
  view: JobView;
  /** Runs `call` with a job number; the files it answers are what was written. */
  start(call: (job: number) => Promise<WirePath | WirePath[]>): void;
  /** Asks the running call to stop; it then ends as failed with `cancelled` set. */
  cancel(): void;
  /** Back to the form. */
  reset(): void;
}

export function usePageJob(): PageJob {
  const [view, setView] = useState<JobView>({ phase: "idle" });
  const running = useRef<FileJob<unknown> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // A dialog that goes while its call runs stops the call.
      void running.current?.cancel();
    };
  }, []);

  const start = useCallback((call: (job: number) => Promise<WirePath | WirePath[]>) => {
    if (running.current) return;
    setView({ phase: "running", progress: null, cancelling: false });
    const job = startJob(call, (progress) => {
      if (alive.current) setView((v) => (v.phase === "running" ? { ...v, progress } : v));
    });
    running.current = job;
    job.result.then(
      (answer) => {
        running.current = null;
        if (!alive.current) return;
        setView({ phase: "done", paths: Array.isArray(answer) ? answer : [answer] });
      },
      (e: unknown) => {
        running.current = null;
        if (!alive.current) return;
        const err = toWireError(e);
        setView({ phase: "failed", message: errorText(err), cancelled: err.kind === "Cancelled" });
      }
    );
  }, []);

  const cancel = useCallback(() => {
    const job = running.current;
    if (!job) return;
    setView((v) => (v.phase === "running" ? { ...v, cancelling: true } : v));
    void job.cancel();
  }, []);

  const reset = useCallback(() => {
    if (!running.current) setView({ phase: "idle" });
  }, []);

  return { view, start, cancel, reset };
}
