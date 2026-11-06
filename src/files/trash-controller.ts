// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the actions of the table (src/keys/actions.ts) can ask of the Trash
// view that is showing a Trash tab; the same arrangement as folder-controller.ts.
export type TrashMove = "up" | "down" | "first" | "last";

export interface TrashController {
  selectAll(): void;
  selectNone(): void;
  hasSelection(): boolean;
  canMove(): boolean;
  move(to: TrashMove, extend: boolean): void;
  /** True when a restore, a delete or emptying may start: nothing of the kind is running, and (for `needsSelection`) something is selected. */
  canAct(needsSelection: boolean): boolean;
  restore(): void;
  /** Asks to delete the selection for good; the delete runs on the answer. */
  askPurge(): void;
  /** Asks to empty the Trash; the operation runs on the answer. */
  askEmpty(): void;
  refresh(): void;
}

const controllers = new Map<string, TrashController>();

/** Registers the controller of a tab; returns the function that removes it. */
export function registerTrash(tabId: string, controller: TrashController): () => void {
  controllers.set(tabId, controller);
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId);
  };
}

export function trashController(tabId: string): TrashController | undefined {
  return controllers.get(tabId);
}
