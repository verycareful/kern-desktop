// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  displayPath,
  openPaths,
  parent,
  pdfExtract,
  pdfSplit,
  pickFolder,
  pickSavePdf,
  toWireError,
  type WirePath,
} from "../ipc";
import { errorText } from "../ops/error-text";
import { baseName } from "../ops/labels";
import { Modal } from "../ops/Modal";
import { JobStatus } from "./JobStatus";
import { whyNotTheFile } from "./page-files";
import { pagesOf, parseRanges, refuseRepeatedPages, refuseRepeatedRanges } from "./page-range";
import { usePageJob } from "./usePageJob";
import type { PdfDoc } from "./usePdfDoc";

// Extract (the pages as one new PDF) and Split (one new PDF for each range). Both read the file on
// disk, write only new files, and never replace one: kernkraft refuses a name that exists, and says
// so when the chooser offered it. The pages are typed as `1-3,5,7-9`, numbered as the page counter
// shows them, and checked here with the engine's own rules before anything is asked of it.

const TITLES = { extract: "Extract pages", split: "Split into files" } as const;

/** The stem of a file's name, for the name offered for the new file. */
function stemOf(path: WirePath): string {
  const name = baseName(path);
  return name.toLowerCase().endsWith(".pdf") ? name.slice(0, -4) : name;
}

export function RangeDialog(props: {
  mode: "extract" | "split";
  doc: PdfDoc;
  /** What the page field starts with. */
  initial: string;
  onClose(): void;
}) {
  const { mode, doc, onClose } = props;
  const source = useMemo(() => doc.fileSource(), [doc]);
  const [text, setText] = useState(props.initial);
  const [target, setTarget] = useState<WirePath | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const job = usePageJob();
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const busy = job.view.phase === "running";

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const parsed = useMemo(() => parseRanges(text, doc.pages), [text, doc.pages]);
  const repeat = parsed.ok
    ? mode === "extract"
      ? refuseRepeatedPages(parsed.ranges)
      : refuseRepeatedRanges(parsed.ranges)
    : null;
  const pagesProblem = !parsed.ok ? parsed.error : repeat;
  const fileProblem = whyNotTheFile(doc);
  const ready = parsed.ok && repeat === null && target !== null && fileProblem === null;

  const choose = async () => {
    setProblem(null);
    const folder = parent(source.path) ?? undefined;
    try {
      const picked =
        mode === "extract"
          ? await pickSavePdf(
              "Save the extracted pages as",
              folder,
              `${stemOf(source.path)} (extract).pdf`
            )
          : await pickFolder("Choose the folder for the new files", folder);
      if (picked) setTarget(picked);
    } catch (e) {
      setProblem(errorText(toWireError(e)));
    }
  };

  const run = () => {
    if (!parsed.ok || repeat !== null || target === null || fileProblem !== null) return;
    const out = target;
    const { ranges, spec } = parsed;
    job.start((n) =>
      mode === "extract"
        ? pdfExtract(source, pagesOf(ranges), out, n)
        : pdfSplit(source, spec, out, n)
    );
  };

  const finished = job.view.phase === "done";
  const written = job.view.phase === "done" ? job.view.paths : [];
  const openResult = async () => {
    const first = written[0];
    if (!first) return;
    try {
      const out = await openPaths([first], "inside");
      const failed = out.find((o) => o.error);
      if (failed?.error) setProblem(errorText(failed.error));
      else onClose();
    } catch (e) {
      setProblem(errorText(toWireError(e)));
    }
  };

  return (
    <Modal
      role="dialog"
      label={TITLES[mode]}
      initialFocus={field}
      onEscape={() => !busy && onClose()}
      testId={`pdf-${mode}-dialog`}
    >
      <h2 className="kern-modal-title">{TITLES[mode]}</h2>
      {job.view.phase === "idle" || job.view.phase === "failed" ? (
        <>
          <p className="kern-modal-text">
            {mode === "extract"
              ? `Makes a new PDF of the pages you name from ${baseName(source.path)}. The file shown is not changed.`
              : `Makes one new PDF for each range you name from ${baseName(source.path)}, named after it and its pages. The file shown is not changed.`}
          </p>
          <label htmlFor={`${id}-pages`} className="kern-modal-text">
            Pages of {doc.pages}
          </label>
          <input
            id={`${id}-pages`}
            ref={field}
            className="kern-modal-input"
            value={text}
            placeholder="1-3,5,7-9"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={pagesProblem !== null && text.trim() !== ""}
            aria-describedby={`${id}-pages-note`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) {
                e.preventDefault();
                run();
              }
            }}
          />
          <p id={`${id}-pages-note`} className="kern-modal-text kern-pdf-job-note" role="note">
            {text.trim() === "" ? "" : (pagesProblem ?? "")}
          </p>
          <div className="kern-pdf-job-target">
            <button type="button" className="kern-button" onClick={() => void choose()}>
              {mode === "extract" ? "Choose the new file…" : "Choose the folder…"}
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
      ) : null}
      <JobStatus view={job.view} />
      {problem && (
        <p role="alert" className="kern-modal-error">
          {problem}
        </p>
      )}
      <div className="kern-modal-actions">
        {(job.view.phase === "idle" || job.view.phase === "failed") && (
          <button type="button" className="kern-button" disabled={!ready} onClick={run}>
            {mode === "extract" ? "Extract" : "Split"}
          </button>
        )}
        {finished && mode === "extract" && (
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
            {finished ? "Close" : "Cancel"}
          </button>
        )}
      </div>
    </Modal>
  );
}
