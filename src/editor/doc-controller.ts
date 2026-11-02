// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the document actions (Ctrl+S, Ctrl+Shift+S, the File menu) reach: the
// editor of a document tab registers its commands here under the tab's id while
// it is mounted, the way the folder view registers its controller
// (files/folder-controller.ts), so the action table needs nothing of React.
export interface DocController {
  save(): void;
  askSaveAs(): void;
  canSave(): boolean;
  canSaveAs(): boolean;
}

const controllers = new Map<string, DocController>();

/** Registers the controller of tab `tabId`; the returned function removes it (only if it is still the one). */
export function registerDoc(tabId: string, controller: DocController): () => void {
  controllers.set(tabId, controller);
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId);
  };
}

export function docController(tabId: string): DocController | undefined {
  return controllers.get(tabId);
}
