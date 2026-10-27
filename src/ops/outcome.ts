// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireError, WireReport } from "../ipc";

/** What a finished operation or command has to tell: its report, or why it failed outright. */
export interface Outcome {
  /** What was being done: "Restore from Trash", "Empty Trash". */
  title: string;
  report: WireReport | null;
  /** The command or operation itself failed; nothing in `report`. */
  error: WireError | null;
}

/** True when the outcome has something the user must be told. */
export function needsAttention(o: Outcome): boolean {
  const r = o.report;
  return (
    o.error !== null ||
    (r !== null &&
      (r.failed.length > 0 || r.warnings.length > 0 || r.cancelled || r.not_reached.length > 0))
  );
}
