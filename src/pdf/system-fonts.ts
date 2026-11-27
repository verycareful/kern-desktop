// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { pdfSetSystemFonts, toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";

// The PDF engine draws and edits with the system's fonts wherever a file embeds none, and it
// learns them from one call. The list applies to every render and edit after the call, so the
// first document of a window waits for it and later ones find it done.

let pending: Promise<void> | null = null;

/** Indexes the system fonts once per page load; a failure is said and tried again by the next open. */
export function ensureSystemFonts(): Promise<void> {
  pending ??= pdfSetSystemFonts().then(
    (fonts) => {
      if (fonts.unreadable_dirs > 0) {
        useOps
          .getState()
          .notify(
            `${fonts.unreadable_dirs} font folder${fonts.unreadable_dirs === 1 ? "" : "s"} could not be read, so PDF text may be drawn in another font.`
          );
      }
    },
    (e: unknown) => {
      pending = null;
      useOps
        .getState()
        .notify(
          `The system fonts could not be listed, so PDF text may be drawn in another font: ${errorText(toWireError(e))}`
        );
    }
  );
  return pending;
}
