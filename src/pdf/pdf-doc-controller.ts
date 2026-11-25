// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { useEffect, useLayoutEffect, useRef } from "react";
import { registerDoc } from "../editor/doc-controller";
import type { PdfDoc } from "./usePdfDoc";

// What the document actions and the close question reach of an open PDF: the viewer registers
// its commands under the tab's id, as a text editor does (editor/doc-controller.ts). A PDF has
// no way to save yet, so the question about closing a changed one offers no Save, Ctrl+S says
// why it does nothing, and the document is not handed to another window, which would not have
// its changes.

const NO_SAVE = "This PDF has changes, and saving a PDF is not available yet.";
const NOT_MOVABLE = "it has changes that are not saved, and they would be lost in the other window";

export function usePdfDocController(tabId: string, doc: PdfDoc): void {
  const latest = useRef(doc);
  useLayoutEffect(() => {
    latest.current = doc;
  });
  useEffect(() => {
    // A change that is with the engine counts as one already made: closing now would lose it.
    const changed = () => latest.current.modified || latest.current.busy();
    return registerDoc(tabId, {
      save: () => undefined,
      askSaveAs: () => undefined,
      canSave: () => false,
      canSaveAs: () => false,
      whySaveRefused: () => (changed() ? NO_SAVE : null),
      closeRisk: () =>
        changed() ? { dirty: true, deleted: false, readOnly: false, unsavable: true } : null,
      saveForClose: async () => !changed(),
      snapshot: () => null,
      setMoving: () => undefined,
      busy: () => latest.current.busy(),
      whyNotMovable: () => (changed() ? NOT_MOVABLE : null),
    });
  }, [tabId]);
}
