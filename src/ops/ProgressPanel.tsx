// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { formatSize } from "../files/format";
import { plural } from "./labels";
import { useOps, type OpView } from "./useOps";

// Every file operation in flight, with its progress and a Cancel button that
// works at any time, a name conflict waiting for an answer included (design
// 5.1). It sits above the status bar, whichever tab is on show, so an
// operation started in one tab stays visible from another.

function counts(progress: NonNullable<OpView["progress"]>): string {
  const { done, total, unit } = progress;
  if (unit === "bytes") return `${formatSize(done)} of ${formatSize(total)}`;
  if (unit === "items")
    return `${done.toLocaleString("en-US")} of ${plural(total, "item", "items")}`;
  return `${done.toLocaleString("en-US")} ${unit}`;
}

function Row(props: { op: OpView }) {
  const { op } = props;
  const cancel = useOps((s) => s.cancel);
  const p = op.progress;
  // Without a total (nothing counted yet) the bar stays empty and carries no value.
  const known = p !== null && p.total > 0 ? p : null;
  const label = op.cancelling ? `Cancelling: ${op.running}` : op.running;
  return (
    <div className="kern-op" data-testid="op-row">
      <span className="kern-op-label" title={op.running}>
        {label}
        {op.conflict && !op.cancelling && " (waiting for an answer)"}
      </span>
      <div
        role="progressbar"
        aria-label={op.running}
        aria-valuemin={0}
        aria-valuemax={known?.total}
        aria-valuenow={known?.done}
        className="kern-progress"
      >
        <div
          className="kern-progress-bar"
          style={{ width: known ? `${(100 * known.done) / known.total}%` : "0%" }}
        />
      </div>
      <span className="kern-op-count">{p ? counts(p) : ""}</span>
      <button
        type="button"
        className="kern-button"
        disabled={op.cancelling}
        aria-label={`Cancel: ${op.running}`}
        onClick={() => cancel(op.key)}
      >
        Cancel
      </button>
    </div>
  );
}

export function ProgressPanel() {
  const ops = useOps((s) => s.ops);
  if (ops.length === 0) return null;
  return (
    <section className="kern-ops" aria-label="File operations" data-testid="progress-panel">
      {ops.map((op) => (
        <Row key={op.key} op={op} />
      ))}
    </section>
  );
}
