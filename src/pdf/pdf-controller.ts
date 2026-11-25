// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the PDF actions (Ctrl+plus, Ctrl+minus, Ctrl+0, Ctrl+G) and the thumbnails reach: the viewer of a PDF tab
// registers its commands here under the tab's id while it is mounted, as the editor does
// (editor/doc-controller.ts), so the action table needs nothing of React.
export interface PdfController {
  zoomIn(): void;
  zoomOut(): void;
  /** Fits the widest page to the view's width. */
  zoomFit(): void;
  /** Opens the Go to page box. */
  askGoToPage(): void;
  /** Brings page `page` (from 0) into view: the row that holds it, or the one page shown. */
  goToPage(page: number): void;
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
