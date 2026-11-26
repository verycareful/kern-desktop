// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  displayPath,
  openPaths,
  parent,
  pathKey,
  pdfMerge,
  pickPdfs,
  pickSavePdf,
  toWireError,
  type PdfSource,
  type WirePath,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { Modal } from "../ops/Modal";
import { JobStatus } from "./JobStatus";
import { whyNotTheFile } from "./page-files";
import { usePageJob } from "./usePageJob";
import type { PdfDoc } from "./usePdfDoc";

// Merge: the PDFs of a list, in the order shown, joined into one new file. The open PDF starts the
// list; it can be taken out, moved, and others added. Like Extract and Split it reads files on
// disk, so a PDF with changes not yet saved is refused while it is in the list, and it writes only
// a new file: a name that exists is refused by the engine and nothing is written.

function stemOf(path: WirePath): string {
  const name = baseName(path);
  return name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
}

/** The list with the entry at `from` moved to `to`; the same list when either is outside it. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  if (item === undefined || to < 0 || to > copy.length) return [...list];
  copy.splice(to, 0, item);
  return copy;
}

export function MergeDialog(props: { doc: PdfDoc; onClose(): void }) {
  const { doc, onClose } = props;
  const own = useMemo(() => doc.fileSource(), [doc]);
  const [sources, setSources] = useState<PdfSource[]>(() => [doc.fileSource()]);
  const [target, setTarget] = useState<WirePath | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const job = usePageJob();
  const addButton = useRef<HTMLButtonElement>(null);
  const busy = job.view.phase === "running";
  const idle = job.view.phase === "idle" || job.view.phase === "failed";

  const ownKey = pathKey(own.path);
  const usesOwn = sources.some((s) => pathKey(s.path) === ownKey);
  const fileProblem = usesOwn ? whyNotTheFile(doc) : null;
  const ready = sources.length >= 2 && target !== null && fileProblem === null;
  const folder = parent(own.path) ?? undefined;

  const say = (e: unknown) => setProblem(errorText(toWireError(e)));

  const add = async () => {
    setProblem(null);
    try {
      const picked = await pickPdfs("Choose the PDFs to merge", folder);
      if (picked && picked.length > 0)
        setSources((s) => [...s, ...picked.map((path) => ({ path }))]);
    } catch (e) {
      say(e);
    }
  };
  const choose = async () => {
    setProblem(null);
    try {
      const picked = await pickSavePdf(
        "Save the merged PDF as",
        folder,
        `${stemOf(own.path)} (merged).pdf`
      );
      if (picked) setTarget(picked);
    } catch (e) {
      say(e);
    }
  };
  const run = () => {
    if (!ready || target === null) return;
    const out = target;
    const list = sources;
    job.start((n) => pdfMerge(list, out, n));
  };
  const openResult = async () => {
    const first = job.view.phase === "done" ? job.view.paths[0] : undefined;
    if (!first) return;
    try {
      const out = await openPaths([first], "inside");
      const failed = out.find((o) => o.error);
      if (failed?.error) setProblem(errorText(failed.error));
      else onClose();
    } catch (e) {
      say(e);
    }
  };

  return (
    <Modal
      role="dialog"
      label="Merge PDFs"
      initialFocus={addButton}
      onEscape={() => !busy && onClose()}
      testId="pdf-merge-dialog"
    >
      <h2 className="kern-modal-title">Merge PDFs</h2>
      {idle && (
        <>
          <p className="kern-modal-text">
            Joins the PDFs below, in this order, into one new PDF. The files themselves are not
            changed.
          </p>
          <ol className="kern-pdf-merge-list" aria-label="PDFs to merge">
            {sources.map((s, i) => (
              <li key={`${pathKey(s.path)}#${i}`} className="kern-pdf-merge-row">
                <span className="kern-pdf-job-path" title={displayPath(s.path)}>
                  {baseName(s.path)}
                  {pathKey(s.path) === ownKey ? " (this PDF)" : ""}
                </span>
                <button
                  type="button"
                  className="kern-icon-button"
                  aria-label={`Move ${baseName(s.path)} up`}
                  disabled={i === 0}
                  onClick={() => setSources((l) => moved(l, i, i - 1))}
                >
                  <ArrowUp size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="kern-icon-button"
                  aria-label={`Move ${baseName(s.path)} down`}
                  disabled={i === sources.length - 1}
                  onClick={() => setSources((l) => moved(l, i, i + 1))}
                >
                  <ArrowDown size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="kern-icon-button"
                  aria-label={`Take ${baseName(s.path)} out`}
                  onClick={() => setSources((l) => l.filter((_, k) => k !== i))}
                >
                  <X size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          <div className="kern-pdf-job-target">
            <button
              ref={addButton}
              type="button"
              className="kern-button"
              onClick={() => void add()}
            >
              Add PDFs…
            </button>
            {sources.length < 2 && (
              <span className="kern-pdf-job-note">Merge needs at least two PDFs.</span>
            )}
          </div>
          <div className="kern-pdf-job-target">
            <button type="button" className="kern-button" onClick={() => void choose()}>
              Choose the new file…
            </button>
            <span className="kern-pdf-job-path" data-testid="pdf-job-target">
              {target ? displayPath(target) : "Nothing chosen yet"}
            </span>
          </div>
          <p className="kern-modal-text kern-pdf-job-note">
            A file that already exists is never replaced. Choose a name that is free.
          </p>
          {fileProblem && (
            <p role="alert" className="kern-modal-error" data-testid="pdf-job-blocked">
              {fileProblem}
            </p>
          )}
        </>
      )}
      <JobStatus view={job.view} />
      {problem && (
        <p role="alert" className="kern-modal-error">
          {problem}
        </p>
      )}
      <div className="kern-modal-actions">
        {idle && (
          <button type="button" className="kern-button" disabled={!ready} onClick={run}>
            Merge
          </button>
        )}
        {job.view.phase === "done" && (
          <button type="button" className="kern-button" onClick={() => void openResult()}>
            Open it
          </button>
        )}
        {busy ? (
          <button
            type="button"
            className="kern-button"
            disabled={job.view.phase === "running" && job.view.cancelling}
            onClick={job.cancel}
          >
            Cancel
          </button>
        ) : (
          <button type="button" className="kern-button" onClick={onClose}>
            {job.view.phase === "done" ? "Close" : "Cancel"}
          </button>
        )}
      </div>
    </Modal>
  );
}
