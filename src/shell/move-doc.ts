// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { currentWindowLabel, detachDoc, moveDocToMain, toWireError } from "../ipc";
import { docController } from "../editor/doc-controller";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";
import { tabTitle, useTabs } from "../store/tabs";

// A document moving between windows (design 4.4, 4.5): "Move to new window"
// gives a tab of the main window a window of its own, and Home in a document
// window gives its document to a tab of the main window. The editor's state
// goes along (handed-doc.ts), unsaved text included. While it moves the editor
// takes no edits, since an edit made after the state was taken would be lost
// when the source closes. If the move fails the document stays where it was
// and can be edited again.

const say = (text: string) => useOps.getState().notify(text);

/** Moves document tab `id` of the main window into a window of its own. */
export async function moveTabToWindow(id: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (tab?.kind !== "doc") return;
  const doc = docController(id);
  // A document still opening, or that could not be opened, holds no text: the window reads it.
  const state = doc?.snapshot() ?? null;
  doc?.setMoving(true);
  try {
    await detachDoc(id, tab.path, state);
  } catch (e) {
    doc?.setMoving(false);
    say(`${tabTitle(tab)} could not be moved to a new window: ${errorText(toWireError(e))}`);
    return;
  }
  // The window has the document, unsaved text included: the tab goes without a question.
  useTabs.getState().close(id);
}

/**
 * Home in a document window: its document goes to a tab of the main window and this window
 * closes (the backend closes it once the main window has the document). Resolves to why it did
 * not, or null.
 */
export async function moveDocHome(): Promise<string | null> {
  const label = currentWindowLabel();
  if (!label) return "This is not a document window.";
  const doc = docController(label);
  const state = doc?.snapshot() ?? null;
  doc?.setMoving(true);
  try {
    await moveDocToMain(label, state);
    return null;
  } catch (e) {
    doc?.setMoving(false);
    return `The document could not be moved to the main window, so it stays here: ${errorText(toWireError(e))}`;
  }
}
