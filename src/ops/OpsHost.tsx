// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect } from "react";
import { EVENT_DROP, on, toWireError } from "../ipc";
import { activeTab, useTabs } from "../store/tabs";
import { ConflictDialog } from "./ConflictDialog";
import { ProgressPanel } from "./ProgressPanel";
import { ReportDialog } from "./ReportDialog";
import { useOps } from "./useOps";

// The window's part of the file operations (design 5.1): the progress panel,
// the name conflict being asked, and the reports waiting to be read. Reads the
// undo history once at the start so the Edit menu has its labels.
export function OpsHost() {
  const ops = useOps((s) => s.ops);
  const answer = useOps((s) => s.answer);
  const cancel = useOps((s) => s.cancel);
  useEffect(() => {
    void useOps.getState().refreshUndo();
  }, []);
  // A folder tab's view takes a drop on itself; a drop on any other tab is told it has nowhere to go.
  useEffect(() => {
    let live = true;
    let off: (() => void) | undefined;
    on(EVENT_DROP, () => {
      if (activeTab(useTabs.getState())?.kind !== "folder") {
        useOps
          .getState()
          .notify("Files can only be dropped on a folder tab; this tab cannot take them.");
      }
    }).then(
      (u) => (live ? (off = u) : u()),
      (e: unknown) => {
        if (live) {
          useOps.getState().report({ title: "Drop", report: null, error: toWireError(e) });
        }
      }
    );
    return () => {
      live = false;
      off?.();
    };
  }, []);
  // The oldest question is asked first; the other operations stay blocked until their turn.
  const asking = ops.filter((o) => o.conflict !== null).sort((a, b) => a.askedAt - b.askedAt);
  const first = asking[0];
  return (
    <>
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
