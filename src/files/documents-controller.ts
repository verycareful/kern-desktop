// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the actions of the table can ask of the Library view while it is
// mounted (there is at most one). With none mounted the actions are disabled.
export interface DocumentsController {
  /** Walks the folders again. */
  refresh(): void;
}

let current: DocumentsController | null = null;

/** Registers the view's controller; returns the function that removes it. */
export function registerDocuments(controller: DocumentsController): () => void {
  current = controller;
  return () => {
    if (current === controller) current = null;
  };
}

export function documentsController(): DocumentsController | null {
  return current;
}
