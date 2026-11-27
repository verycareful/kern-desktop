// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { displayPath } from "../ipc";
import { baseName } from "../ops/labels";
import { progressText } from "./page-files";
import type { JobView } from "./usePageJob";

/** Files listed by name before the rest are counted. */
const NAMES_SHOWN = 5;

// What a page-file dialog shows once its call has started: the progress line, the files it wrote,
// or why it did not write. The form is the dialog's own while the job is idle.
export function JobStatus(props: { view: JobView }) {
  const { view } = props;
  if (view.phase === "idle") return null;
  if (view.phase === "running") {
    return (
      <p role="status" className="kern-modal-text" data-testid="pdf-job-progress">
        {view.cancelling
          ? "Cancelling…"
          : view.progress
            ? progressText(view.progress)
            : "Starting…"}
      </p>
    );
  }
  if (view.phase === "failed") {
    return (
      <p role="alert" className="kern-modal-error" data-testid="pdf-job-failed">
        {view.cancelled
          ? "Cancelled. No file was written."
          : `Nothing was written. ${view.message}`}
      </p>
    );
  }
  const shown = view.paths.slice(0, NAMES_SHOWN);
  return (
    <div role="status" className="kern-modal-text" data-testid="pdf-job-done">
      <p>{view.paths.length === 1 ? "Wrote 1 file:" : `Wrote ${view.paths.length} files:`}</p>
      <ul className="kern-pdf-job-files">
        {shown.map((p) => (
          <li key={displayPath(p)} title={displayPath(p)}>
            {baseName(p)}
          </li>
        ))}
        {view.paths.length > shown.length && <li>and {view.paths.length - shown.length} more</li>}
      </ul>
    </div>
  );
}
