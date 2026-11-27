// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { HandedDoc } from "./handed-doc";

// What the document actions (Ctrl+S, Ctrl+Shift+S, the File menu) reach: the
// editor of a document tab registers its commands here under the tab's id while
// it is mounted, the way the folder view registers its controller
// (files/folder-controller.ts), so the action table needs nothing of React.
export interface DocController {
  save(): void;
  askSaveAs(): void;
  canSave(): boolean;
  canSaveAs(): boolean;
  /** Why Ctrl+S saves nothing now, in words for the status bar; null when there is nothing to say. */
  whySaveRefused(): string | null;
  /**
   * What closing would lose: unsaved edits, or the only copy of a file deleted on disk; null
   * when nothing. `readOnly` says it cannot be saved where it is.
   */
  closeRisk(): {
    dirty: boolean;
    deleted: boolean;
    readOnly: boolean;
  } | null;
  /** Saves for a close; true when nothing is lost by closing now. */
  saveForClose(): Promise<boolean>;
  /** The document as it is, for another window to take over; null when it holds nothing. */
  snapshot(): HandedDoc | null;
  /**
   * The document is open, so it can be moved or refused now rather than waited for. Absent, a
   * document is settled once its `snapshot` is not null (a PDF has no state to hand over, so its
   * snapshot is always null).
   */
  settled?(): boolean;
  /** While true the document cannot be edited or saved: it is being handed to another window. */
  setMoving(moving: boolean): void;
  /** A save or a move is under way: the document is not to be moved now. */
  busy(): boolean;
  /**
   * Why the document cannot go to another window now, in words that follow "it": a document whose
   * unsaved changes would not go along. Absent or null when it can.
   */
  whyNotMovable?(): string | null;
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
