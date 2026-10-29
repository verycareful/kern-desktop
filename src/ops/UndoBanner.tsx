// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useState } from "react";
import { useOps } from "./useOps";

// Shown while the undo history cannot be read (design 5.7): Undo and Redo may then be
// wrong or missing. It does not hold the keyboard or take the focus, and stays until a read
// works, which Retry tries again.
export function UndoBanner() {
  const error = useOps((s) => s.undoError);
  const [busy, setBusy] = useState(false);
  if (!error) return null;
  const retry = () => {
    setBusy(true);
    void useOps
      .getState()
      .refreshUndo()
      .finally(() => setBusy(false));
  };
  return (
    <div role="alert" className="kern-banner" data-testid="undo-error">
      <span>
        The undo history could not be read, so Undo and Redo may be missing or wrong. {error.kind}:{" "}
        {error.message}
      </span>
      <button type="button" className="kern-button" disabled={busy} onClick={retry}>
        Retry
      </button>
    </div>
  );
}
