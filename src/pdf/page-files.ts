// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pdfCancelJob, pdfJobProgress } from "../ipc";
import { nextJobId } from "./jobs";

// A long call on files, not on the open document: Merge, Extract and Split. The call carries a job
// number, and while it runs the engine is asked how far it has come; the same number cancels it.

/** How often the engine is asked how far a job has come. */
const POLL_MS = 250;

export interface JobProgress {
  done: number;
  /** 0 until the engine knows it. */
  total: number;
  stage: string;
}

export interface FileJob<T> {
  job: number;
  /** The call's own answer or failure; polling has stopped when it settles. */
  result: Promise<T>;
  /** Asks the engine to stop the job; the call then fails with `Cancelled`. Never rejects. */
  cancel(): Promise<void>;
}

/**
 * Starts `start` with a job number of its own and reports its progress to `onProgress` until it
 * settles. A poll that fails is skipped (progress is only for show), and a job the engine does not
 * run yet reports nothing.
 */
export function startJob<T>(
  start: (job: number) => Promise<T>,
  onProgress: (progress: JobProgress) => void,
  opts: { intervalMs?: number } = {}
): FileJob<T> {
  const job = nextJobId();
  let live = true;
  const timer = setInterval(() => {
    pdfJobProgress(job).then(
      (p) => {
        if (live && p.running) onProgress({ done: p.done, total: p.total, stage: p.stage });
      },
      () => undefined
    );
  }, opts.intervalMs ?? POLL_MS);
  const result = start(job).finally(() => {
    live = false;
    clearInterval(timer);
  });
  return {
    job,
    result,
    cancel: () =>
      pdfCancelJob(job).then(
        () => undefined,
        () => undefined
      ),
  };
}

/** What the progress line says. */
export function progressText(p: JobProgress): string {
  const stage = p.stage === "" ? "Working" : p.stage;
  return p.total > 0
    ? `${stage} ${p.done} of ${p.total}`
    : p.stage === ""
      ? "Working…"
      : `${stage}…`;
}

/**
 * Why the file on disk cannot stand for the open document, or null when it can. Merge, Extract and
 * Split read the file, so a change not yet saved, or a file that is not the one opened, would be
 * silently missing from what they write.
 */
export function whyNotTheFile(doc: {
  modified: boolean;
  externalChange: "none" | "changed" | "gone";
}): string | null {
  if (doc.modified) {
    return "This PDF has changes that are not saved. This works from the file on disk, which does not have them yet. Save the PDF first.";
  }
  if (doc.externalChange === "changed") {
    return "The file on disk was changed by another program and is not the one shown here. Reload it or save this one under another name first.";
  }
  if (doc.externalChange === "gone") {
    return "The file shown here is no longer on the disk. Save this PDF under another name first.";
  }
  return null;
}
