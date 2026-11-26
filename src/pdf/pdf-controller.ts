// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the PDF actions (zoom, Go to page, rotate, undo, redo, a compacted copy, reload, copy and select) and the thumbnails reach: the viewer of a PDF tab
// registers its commands here under the tab's id while it is mounted, as the editor does
// (editor/doc-controller.ts), so the action table needs nothing of React.
/** What a rotation turns: the page in view, or every page. */
export type RotateScope = "page" | "all";

/** A turn clockwise, in degrees; a quarter turn the other way is 270. */
export type Turn = 90 | 180 | 270;

export interface PdfController {
  zoomIn(): void;
  zoomOut(): void;
  /** Fits the widest page to the view's width. */
  zoomFit(): void;
  /** Opens the Go to page box. */
  askGoToPage(): void;
  /** Brings page `page` (from 0) into view: the row that holds it, or the one page shown. */
  goToPage(page: number): void;
  /** Turns the pages `scope` names clockwise by `degrees`. */
  rotate(degrees: Turn, scope: RotateScope): void;
  undo(): void;
  redo(): void;
  /** The document is open and can be changed here (no other place holds it). */
  canEdit(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Opens the question for a compacted copy of the document as it is. */
  askCompactedCopy(): void;
  canCompactedCopy(): boolean;
  /** Reads the file again, after asking when that drops changes made here. */
  askReload(): void;
  canReload(): boolean;
  /** Text is selected on a page. */
  hasSelection(): boolean;
  /** Puts the selected text on the clipboard. */
  copySelection(): void;
  /** Asks for the selected text to be searched for. */
  searchSelection(): void;
  /** Selects all the text of the page in view. */
  selectAll(): void;
  canSelectAll(): boolean;
}

const controllers = new Map<string, PdfController>();

/** Registers the controller of tab `tabId`; the returned function removes it (only if it is still the one). */
export function registerPdf(tabId: string, controller: PdfController): () => void {
  controllers.set(tabId, controller);
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId);
  };
}

export function pdfController(tabId: string): PdfController | undefined {
  return controllers.get(tabId);
}
