// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)

// What the actions of the table (src/keys/actions.ts) can ask of the folder
// view that is showing a tab. The view registers itself while mounted, so an
// action finds it by tab id; with none registered the action is disabled.
export type MoveTo = "up" | "down" | "left" | "right" | "first" | "last";

export interface FolderController {
  selectAll(): void;
  selectNone(): void;
  hasSelection(): boolean;
  /** False when the move has no meaning in the current view (left and right in the list). */
  canMove(to: MoveTo): boolean;
  move(to: MoveTo, extend: boolean): void;
  /** True when `open` has something to open: a selection, or else the outlined item. */
  canOpen(): boolean;
  /** Opens the selected items, or the outlined item when nothing is selected; `newWindow` is the Ctrl gesture of design 4.3. */
  open(newWindow: boolean): void;
  refresh(): void;
  editLocation(): void;
}

const controllers = new Map<string, FolderController>();

/** Registers the controller of a tab; returns the function that removes it. */
export function registerFolder(tabId: string, controller: FolderController): () => void {
  controllers.set(tabId, controller);
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId);
  };
}

export function folderController(tabId: string): FolderController | undefined {
  return controllers.get(tabId);
}
