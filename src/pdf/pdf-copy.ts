// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  answerConflict,
  dropStartOp,
  parent,
  toWireError,
  type WireError,
  type WirePath,
} from "../ipc";
import { runOp } from "../ops/run-op";

// The copy Save a copy first makes before the first edit: the file, byte for byte, beside itself
// under the first free name (`name (2).pdf`). It is kernkraft's copy operation into the file's own
// folder; the name already being taken is the one conflict it meets, and it answers it by keeping
// both, so nothing is ever replaced.

const refused = (message: string, path: WirePath | null = null): WireError => ({
  kind: "CopyFailed",
  message,
  path,
  details: null,
});

/** Copies the file at `path` beside itself and answers where the copy is. Rejects with a WireError. */
export async function copyBeside(path: WirePath): Promise<WirePath> {
  const folder = parent(path);
  if (!folder) throw refused("the file has no folder to copy it into", path);
  // `running` is read only when a conflict arrives, which is after it has been assigned.
  let running: ReturnType<typeof runOp> | null = null;
  running = runOp(
    () => dropStartOp("copy", [path], folder),
    () => undefined,
    (conflict) => {
      answerConflict(conflict.op, conflict.conflict, "keep_both", false).catch(() => {
        // The copy waits for an answer it will not get: it is stopped, and says so as cancelled.
        void running?.cancel().catch(() => undefined);
      });
    }
  );
  let end;
  try {
    end = await running.done;
  } catch (e) {
    throw toWireError(e);
  }
  if (end.error) throw end.error;
  const report = end.report;
  if (!report) throw refused("the copy ended without a report", path);
  const failed = report.failed[0];
  if (failed) throw failed.error;
  if (report.cancelled) throw refused("the copy was cancelled", path);
  const dest = report.done[0]?.dest;
  if (!dest) throw refused("the copy was not made", path);
  return dest;
}
