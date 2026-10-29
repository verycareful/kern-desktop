// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useRef } from "react";
import { Modal } from "./Modal";
import { ReportBody } from "./ReportPanel";
import { useOps } from "./useOps";

// The report of an operation that skipped, failed, warned, was cancelled or
// did not run (design 5.1): shown over the window, whichever tab is on show,
// until it is read. Reports queue; closing one shows the next.
export function ReportDialog() {
  const reports = useOps((s) => s.reports);
  const dismiss = useOps((s) => s.dismissReport);
  const close = useRef<HTMLButtonElement>(null);
  const first = reports[0];
  if (!first) return null;
  const later = reports.length - 1;
  return (
    <Modal
      // A new report is a new dialog: the focus goes to its Close button.
      key={first.id}
      role="dialog"
      label={`Report: ${first.outcome.title}`}
      initialFocus={close}
      onEscape={() => dismiss(first.id)}
      className="kern-modal-wide"
      testId="report-dialog"
    >
      <ReportBody outcome={first.outcome} />
      {later > 0 && (
        <p className="kern-modal-text" role="status">
          {later === 1 ? "One more report follows." : `${later} more reports follow.`}
        </p>
      )}
      <div className="kern-modal-actions">
        <button ref={close} type="button" className="kern-button" onClick={() => dismiss(first.id)}>
          Close
        </button>
      </div>
    </Modal>
  );
}
