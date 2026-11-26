// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the PDF actions (zoom, Go to page, rotate, undo, redo, a compacted copy, reload, copy, select and find) and the thumbnails reach: the viewer of a PDF tab
// registers its commands here under the tab's id while it is mounted, as the editor does
// (editor/doc-controller.ts), so the action table needs nothing of React.
import type { MarkupKind } from "../ipc/pdf";
import type { PdfTool } from "./pdf-tool";

/** What a rotation turns: the page in view, every page, or the pages chosen in the strip or grid. */
export type RotateScope = "page" | "all" | "selection";

/** A turn clockwise, in degrees; a quarter turn the other way is 270. */
export type Turn = 90 | 180 | 270;

export interface PdfController {
  zoomIn(): void;
  zoomOut(): void;
  /** Fits the widest page to the view's width. */
  zoomFit(): void;
  /** Opens the Go to page box. */
  askGoToPage(): void;
  /**
   * Brings page `page` (from 0) into view: the row that holds it, or the one page shown. With
   * `at`, the height down the page (a fraction, 0 at the top) that is to be in view.
   */
  goToPage(page: number, at?: number): void;
  /** Turns the pages `scope` names clockwise by `degrees`. */
  rotate(degrees: Turn, scope: RotateScope): void;
  /** Pages are chosen in the thumbnail strip or the grid. */
  hasPageSelection(): boolean;
  /** Takes the chosen pages out (refused, with the reason, when it would leave none). */
  removeSelection(): void;
  /** Opens Merge, Extract (starting with the chosen pages) or Split (the same). */
  askMerge(): void;
  askExtract(): void;
  askSplit(): void;
  /** Merge, Extract and Split can be asked: the document is open and has pages. */
  canPageFiles(): boolean;
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
  /** The tool in hand: Select, or Ink or Note, which act on the page where it is pressed. */
  tool(): PdfTool;
  setTool(tool: PdfTool): void;
  /** Annotations can be made: the document is open and can be changed here. */
  canAnnotate(): boolean;
  /** Marks the selected text (one change); needs `canMark`. */
  mark(kind: MarkupKind): void;
  canMark(): boolean;
  /** An annotation is picked and can be changed. */
  hasPickedAnnotation(): boolean;
  /** Takes the picked annotation away. */
  deletePicked(): void;
  /** Opens the find bar, or gives its field the focus when it is open. */
  openFind(): void;
  /** Goes to the next (`1`) or the previous (`-1`) match, opening the find bar when it is closed. */
  findStep(direction: 1 | -1): void;
  canFind(): boolean;
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
