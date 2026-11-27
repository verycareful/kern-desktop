// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useLayoutEffect, useRef } from "react";
import { registerDoc } from "../editor/doc-controller";
import type { PdfDoc } from "./usePdfDoc";

// What the document actions and the close question reach of an open PDF: the viewer registers
// its commands under the tab's id, as a text editor does (editor/doc-controller.ts). A PDF has no
// state to hand to another window, so a clean one is opened afresh there and a changed one is not
// moved at all: its changes would be lost with this window.

const READ_ONLY_SAVE =
  "This PDF is open in another place, so it is read-only here. Use Save As to keep your changes in another file.";
const NOT_MOVABLE =
  "it has changes that are not saved (save this PDF before moving it to another window)";

export function usePdfDocController(tabId: string, doc: PdfDoc): void {
  const latest = useRef(doc);
  useLayoutEffect(() => {
    latest.current = doc;
  });
  useEffect(() => {
    // A change that is with the engine counts as one already made: closing now would lose it.
    const changed = () => latest.current.modified || latest.current.busy();
    const ready = () => latest.current.phase === "ready";
    return registerDoc(tabId, {
      save: () => void latest.current.save(),
      askSaveAs: () => latest.current.askSaveAs(),
      canSave: () => {
        const d = latest.current;
        return (
          ready() &&
          !d.readOnly &&
          !d.saving &&
          !d.moving &&
          (d.modified || d.externalChange === "gone")
        );
      },
      canSaveAs: () => ready() && !latest.current.saving && !latest.current.moving,
      whySaveRefused: () => {
        const d = latest.current;
        if (!ready()) return null;
        if (d.moving)
          return "The document is being moved to another window, so it cannot be saved now.";
        if (d.saving) return "A save is already under way.";
        return d.readOnly ? READ_ONLY_SAVE : null;
      },
      closeRisk: () => {
        const d = latest.current;
        if (!ready() || !(changed() || d.externalChange === "gone")) return null;
        return {
          dirty: changed(),
          deleted: d.externalChange === "gone",
          readOnly: d.readOnly !== null,
        };
      },
      saveForClose: () => latest.current.saveForClose(),
      snapshot: () => null,
      settled: ready,
      setMoving: (moving) => latest.current.setMoving(moving),
      busy: () => latest.current.busy() || latest.current.moving,
      whyNotMovable: () => (changed() ? NOT_MOVABLE : null),
    });
  }, [tabId]);
}
