// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { ConflictDialog } from "./ConflictDialog";
import { DropHover } from "./DropHover";
import { ProgressPanel } from "./ProgressPanel";
import { ReportDialog } from "./ReportDialog";
import { UndoBanner } from "./UndoBanner";
import { useOps } from "./useOps";

// The window's part of the file operations: the progress panel,
// the name conflict being asked, and the reports waiting to be read. Reads the
// undo history once at the start so the Edit menu has its labels, and says so
// (UndoBanner) when it cannot. An editor window hosts it for what is dropped on its tree
// (`editor`).
export function OpsHost(props: { editor?: boolean }) {
  const ops = useOps((s) => s.ops);
  const answer = useOps((s) => s.answer);
  const cancel = useOps((s) => s.cancel);
  useEffect(() => {
    void useOps.getState().refreshUndo();
  }, []);
  // The oldest question is asked first; the other operations stay blocked until their turn.
  const asking = ops.filter((o) => o.conflict !== null).sort((a, b) => a.askedAt - b.askedAt);
  const first = asking[0];
  return (
    <>
      <UndoBanner />
      <DropHover editor={props.editor} />
      <ProgressPanel />
      {first?.conflict && (
        <ConflictDialog
          // Each question is a new dialog, so "Apply to all" starts unticked.
          key={`${first.key}:${first.conflict.conflict}`}
          conflict={first.conflict}
          operation={first.running}
          waiting={asking.length - 1}
          others={ops.length - 1}
          onAnswer={(choice, all) => answer(first.key, choice, all)}
          onCancel={() => cancel(first.key)}
        />
      )}
      <ReportDialog />
    </>
  );
}
