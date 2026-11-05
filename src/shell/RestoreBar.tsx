// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useState } from "react";
import {
  sessionClosedDismiss,
  sessionClosedGet,
  sessionRestoreClosed,
  toWireError,
  type WireError,
} from "../ipc";
import { errorText } from "../ops/error-text";

// The windows open when Kern last ran, set aside at launch (session.rs), offered at the top of
// the main window: Restore opens them again, the close button drops them. Shown only when there
// are some; gone once either is done. A lookup or an action that fails is said in the bar.

type BarState =
  | { kind: "looking" }
  | { kind: "none" }
  | { kind: "offer"; count: number; busy: boolean; error: WireError | null }
  | { kind: "failed"; error: WireError };

const windowsText = (n: number) => (n === 1 ? "1 window" : `${n} windows`);

export function RestoreBar() {
  const [state, setState] = useState<BarState>({ kind: "looking" });

  useEffect(() => {
    let alive = true;
    sessionClosedGet().then(
      (count) =>
        alive &&
        setState(count > 0 ? { kind: "offer", count, busy: false, error: null } : { kind: "none" }),
      (e: unknown) => alive && setState({ kind: "failed", error: toWireError(e) })
    );
    return () => {
      alive = false;
    };
  }, []);

  if (state.kind === "looking" || state.kind === "none") return null;
  if (state.kind === "failed") {
    return (
      <div role="alert" className="kern-restore-bar">
        <span>The windows from last time could not be looked up: {errorText(state.error)}</span>
        <button type="button" className="kern-button" onClick={() => setState({ kind: "none" })}>
          Dismiss
        </button>
      </div>
    );
  }

  const act = (run: () => Promise<void>) => {
    setState({ ...state, busy: true, error: null });
    run().then(
      () => setState({ kind: "none" }),
      (e: unknown) => setState({ ...state, busy: false, error: toWireError(e) })
    );
  };

  return (
    <div role="region" aria-label="Windows from last time" className="kern-restore-bar">
      <span>
        {windowsText(state.count)} from last time.
        {state.error && <span role="alert"> {errorText(state.error)}</span>}
      </span>
      <span className="kern-restore-bar-actions">
        <button
          type="button"
          className="kern-button"
          disabled={state.busy}
          onClick={() => act(sessionRestoreClosed)}
        >
          Restore
        </button>
        <button
          type="button"
          className="kern-button"
          aria-label="Forget the windows from last time"
          title="Forget the windows from last time"
          disabled={state.busy}
          onClick={() => act(sessionClosedDismiss)}
        >
          ×
        </button>
      </span>
    </div>
  );
}
