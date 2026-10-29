// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";
import { X } from "lucide-react";
import {
  displayPath,
  pathKey,
  type WireDone,
  type WireError,
  type WireItemError,
  type WirePath,
} from "../ipc";
import { REPORT_PAGE, type Outcome } from "./outcome";
import { plural } from "./labels";

// What a finished operation or command has to tell (Review Focus 5, design
// 5.1 and 5.7): every item that was skipped, failed, warned about or not
// reached, each with its reason, and what was done. Nothing is summarised
// away: a long list is shown a page at a time, and one click shows the rest.
// Operations, undo and the Trash commands hand their outcome to the report
// body, which the banner (src/files/TrashView.tsx) and the dialog
// (ReportDialog.tsx) both show.

function ErrorLine(props: { error: WireError }) {
  const { error } = props;
  return (
    <>
      {error.kind}: {error.message}
    </>
  );
}

/** What an undo that stopped partway did and did not do. */
function PartialDetails(props: { error: WireError }) {
  const d = props.error.details;
  if (d?.k !== "Partial") return null;
  return (
    <>
      <PathRows heading="Undone before it stopped" testid="report-done" paths={d.done} />
      <PathRows heading="Not reached" testid="report-not-reached" paths={d.not_done} />
      <p className="kern-report-heading">Why it stopped</p>
      <p>
        <ErrorLine error={d.cause} />
      </p>
      <ErrorRows heading="Warnings" items={d.warnings} />
    </>
  );
}

export function Paged<T>(props: { items: readonly T[]; row(item: T, i: number): React.ReactNode }) {
  const [shown, setShown] = useState(REPORT_PAGE);
  const rest = props.items.length - shown;
  return (
    <>
      <ul>{props.items.slice(0, shown).map((item, i) => props.row(item, i))}</ul>
      {rest > 0 && (
        <p>
          <button
            type="button"
            className="kern-button"
            onClick={() => setShown(shown + REPORT_PAGE)}
          >
            Show {Math.min(REPORT_PAGE, rest).toLocaleString("en-US")} more
          </button>{" "}
          <button
            type="button"
            className="kern-button"
            onClick={() => setShown(props.items.length)}
          >
            Show all {props.items.length.toLocaleString("en-US")}
          </button>
        </p>
      )}
    </>
  );
}

function ErrorRows(props: { heading: string; items: readonly WireItemError[] }) {
  if (props.items.length === 0) return null;
  return (
    <>
      <p className="kern-report-heading">
        {props.heading} ({props.items.length.toLocaleString("en-US")})
      </p>
      <Paged
        items={props.items}
        row={(f, i) => (
          <li key={`${pathKey(f.path)}\n${f.error.kind}\n${i}`} data-testid="report-item">
            <span className="kern-report-path">{displayPath(f.path)}</span>{" "}
            <ErrorLine error={f.error} />
          </li>
        )}
      />
    </>
  );
}

function PathRows(props: { heading: string; testid: string; paths: readonly WirePath[] }) {
  if (props.paths.length === 0) return null;
  return (
    <>
      <p className="kern-report-heading">
        {props.heading} ({props.paths.length.toLocaleString("en-US")})
      </p>
      <Paged
        items={props.paths}
        row={(p, i) => (
          <li key={`${pathKey(p)}\n${i}`} data-testid={props.testid}>
            <span className="kern-report-path">{displayPath(p)}</span>
          </li>
        )}
      />
    </>
  );
}

function DoneRows(props: { items: readonly WireDone[] }) {
  // Only drawn once opened: a copy of a whole tree can have a hundred thousand of them.
  const [open, setOpen] = useState(false);
  if (props.items.length === 0) return null;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="kern-report-heading">
        Done ({props.items.length.toLocaleString("en-US")})
      </summary>
      {open && (
        <Paged
          items={props.items}
          row={(d, i) => (
            <li key={`${pathKey(d.source)}\n${i}`} data-testid="report-done">
              <span className="kern-report-path">
                {displayPath(d.source)}
                {d.dest && ` → ${displayPath(d.dest)}`}
              </span>
            </li>
          )}
        />
      )}
    </details>
  );
}

export function ReportBody(props: { outcome: Outcome }) {
  const { outcome } = props;
  const r = outcome.report;
  const partial = outcome.error?.details?.k === "Partial";
  return (
    <div className="kern-report-body">
      <p className="kern-report-title">{outcome.title}</p>
      {outcome.error && (
        <>
          <p>
            {partial ? "It stopped partway: " : "It did not run: "}
            <ErrorLine error={outcome.error} />
          </p>
          <PartialDetails error={outcome.error} />
        </>
      )}
      {r && (
        <p>
          {r.done.length} done
          {r.skipped.length > 0 && `, ${r.skipped.length} skipped`}
          {r.failed.length > 0 && `, ${r.failed.length} failed`}
          {r.warnings.length > 0 && `, ${plural(r.warnings.length, "warning", "warnings")}`}
          {r.cancelled && ", cancelled"}
          {r.not_reached.length > 0 && `, ${r.not_reached.length} not reached`}.
        </p>
      )}
      {r && <ErrorRows heading="Failed" items={r.failed} />}
      {r && <ErrorRows heading="Warnings" items={r.warnings} />}
      {r && <PathRows heading="Skipped" testid="report-skipped" paths={r.skipped} />}
      {r && <PathRows heading="Not reached" testid="report-not-reached" paths={r.not_reached} />}
      {r && <DoneRows items={r.done} />}
    </div>
  );
}

export function ReportPanel(props: { outcome: Outcome; onDismiss(): void }) {
  const { outcome } = props;
  return (
    <div role="alert" className="kern-banner kern-report" data-testid="report-panel">
      <ReportBody outcome={outcome} />
      <button
        type="button"
        className="kern-icon-button"
        aria-label={`Dismiss the report: ${outcome.title}`}
        onClick={props.onDismiss}
      >
        <X size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
