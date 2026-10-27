// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { X } from "lucide-react";
import { displayPath, pathKey, type WireError, type WireItemError } from "../ipc";
import type { Outcome } from "./outcome";

// The least a report must do (Review Focus 5, design 5.7): say what
// did not work, item by item, with the reason, and never let a failure pass
// unseen. Operations and trash commands hand their outcome here. The full
// report dialog (counts per kind, retry, details) builds on this component.

function ErrorLine(props: { error: WireError }) {
  const { error } = props;
  return (
    <>
      {error.kind}: {error.message}
    </>
  );
}

function ItemList(props: { heading: string; items: WireItemError[] }) {
  if (props.items.length === 0) return null;
  return (
    <>
      <p className="kern-report-heading">{props.heading}</p>
      <ul>
        {props.items.map((f, i) => (
          <li key={`${pathKey(f.path)}\n${f.error.kind}\n${i}`} data-testid="report-item">
            <span className="kern-report-path">{displayPath(f.path)}</span>{" "}
            <ErrorLine error={f.error} />
          </li>
        ))}
      </ul>
    </>
  );
}

export function ReportPanel(props: { outcome: Outcome; onDismiss(): void }) {
  const { outcome } = props;
  const r = outcome.report;
  return (
    <div role="alert" className="kern-banner kern-report" data-testid="report-panel">
      <div className="kern-report-body">
        <p className="kern-report-title">{outcome.title}</p>
        {outcome.error && (
          <p>
            It did not run: <ErrorLine error={outcome.error} />
          </p>
        )}
        {r && (
          <p>
            {r.done.length} done
            {r.skipped.length > 0 && `, ${r.skipped.length} skipped`}
            {r.failed.length > 0 && `, ${r.failed.length} failed`}
            {r.cancelled && ", cancelled"}
            {r.not_reached.length > 0 && `, ${r.not_reached.length} not reached`}.
          </p>
        )}
        {r && <ItemList heading="Failed" items={r.failed} />}
        {r && <ItemList heading="Warnings" items={r.warnings} />}
      </div>
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
