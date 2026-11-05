// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import {
  currentWindowLabel,
  detachDoc,
  displayPath,
  handDoc,
  handRefused,
  isDocumentWindow,
  moveDocToMain,
  pathKey,
  toWireError,
  type WirePath,
} from "../ipc";
import { docController, type DocController } from "../editor/doc-controller";
import { parseHanded, type HandedDoc } from "../editor/handed-doc";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";
import { tabTitle, useTabs } from "../store/tabs";

// A document moving between windows: "Move to new window"
// gives a tab of the main window a window of its own, Home in a document
// window gives its document to a tab of the main window, and a document
// opened from inside an editor window while open elsewhere is given to that
// editor (handTo). The editor's state
// goes along (handed-doc.ts), unsaved text included. While it moves the editor
// takes no edits, since an edit made after the state was taken would be lost
// when the source closes. If the move fails the document stays where it was
// and can be edited again.

const say = (text: string) => useOps.getState().notify(text);

/**
 * The state to hand over, or why the document cannot move now. A document holding no text yet
 * (still opening, or it could not be opened) moves without one and the other window reads the
 * file. The state is read back as the other window will read it, so a move whose text would not
 * arrive whole is refused here, while the document is still open where it is.
 */
function stateToHand(doc: DocController | undefined): { state: HandedDoc | null } | string {
  if (!doc) return { state: null };
  if (doc.busy()) return "it is being saved or moved; try again when that has finished";
  const state = doc.snapshot();
  if (state === null) return { state: null };
  const arrives = parseHanded(JSON.parse(JSON.stringify(state)));
  if (!arrives || arrives.text !== state.text || arrives.saved !== state.saved) {
    return "its text could not be prepared for the other window";
  }
  return { state };
}

/** Moves document tab `id` of the main window into a window of its own. */
export async function moveTabToWindow(id: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === id);
  if (tab?.kind !== "doc") return;
  const doc = docController(id);
  const ready = stateToHand(doc);
  if (typeof ready === "string") {
    say(`${tabTitle(tab)} was not moved to a new window: ${ready}.`);
    return;
  }
  const { state } = ready;
  doc?.setMoving(true);
  try {
    await detachDoc(id, tab.path, state);
  } catch (e) {
    doc?.setMoving(false);
    say(`${tabTitle(tab)} could not be moved to a new window: ${errorText(toWireError(e))}`);
    return;
  }
  // The window has the text as it was taken. The editor took no edits meanwhile; if its text
  // differs all the same, the tab stays, so nothing typed here is lost.
  const now = doc?.snapshot() ?? null;
  if (state && now && now.text !== state.text) {
    doc?.setMoving(false);
    say(
      `${tabTitle(tab)} is open in a new window as it was when moved; this tab keeps the changes made since.`
    );
    return;
  }
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
  const ready = stateToHand(doc);
  if (typeof ready === "string") return `The document was not moved: ${ready}.`;
  const { state } = ready;
  doc?.setMoving(true);
  try {
    await moveDocToMain(label, state);
    return null;
  } catch (e) {
    doc?.setMoving(false);
    return `The document could not be moved to the main window, so it stays here: ${errorText(toWireError(e))}`;
  }
}

/**
 * How long a document that is being saved or still opening is waited for before it is handed
 * over: the backend's wait for the other window's answer (windows.rs ADOPT_TIMEOUT), so the whole
 * move is bounded the same way on both sides.
 */
export const HAND_WAIT_MS = 15_000;
/** How often the document is looked at while it is waited for. */
const HAND_POLL_MS = 100;

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * The document this window holds at `path` goes to editor window `to`, which asked for it (a
 * HandTo directive). A document that is being saved or is still opening is waited for, up to
 * HAND_WAIT_MS. The other window takes it with its unsaved text; only then does the tab here
 * close (a document window is closed by the backend). Whatever stops the move, the document stays
 * here, `to` is told why and this window comes forward.
 */
export async function handTo(path: WirePath, to: string): Promise<void> {
  const own = isDocumentWindow() ? currentWindowLabel() : null;
  const name = displayPath(path);
  const refuse = async (reason: string) => {
    try {
      await handRefused(path, to, reason);
    } catch (e) {
      say(
        `${name} was asked for by another window and stays here (${reason}); that window could not be told: ${errorText(toWireError(e))}`
      );
    }
  };
  const tabId = (): string | null => {
    if (own) return own;
    const key = pathKey(path);
    const tab = useTabs.getState().tabs.find((t) => t.kind === "doc" && pathKey(t.path) === key);
    return tab?.id ?? null;
  };

  const deadline = Date.now() + HAND_WAIT_MS;
  let id = tabId();
  for (;;) {
    if (!id) {
      await refuse("it is no longer open there");
      return;
    }
    const doc = docController(id);
    if (doc && !doc.busy() && doc.snapshot() !== null) break;
    if (Date.now() >= deadline) {
      await refuse(
        doc?.busy()
          ? "it was still being saved or moved"
          : "it had not finished opening, or could not be opened"
      );
      return;
    }
    await pause(HAND_POLL_MS);
    id = tabId();
  }

  const doc = docController(id);
  const ready = stateToHand(doc);
  if (typeof ready === "string") {
    await refuse(ready);
    return;
  }
  const { state } = ready;
  doc?.setMoving(true);
  try {
    await handDoc(own ? null : id, path, state, to);
  } catch (e) {
    doc?.setMoving(false);
    await refuse(errorText(toWireError(e)));
    return;
  }
  // A document window is closed by the backend once the other window has the document.
  if (own) return;
  // The editor took no edits meanwhile; if its text differs all the same, the tab stays, so
  // nothing typed here is lost.
  const now = doc?.snapshot() ?? null;
  if (state && now && now.text !== state.text) {
    doc?.setMoving(false);
    say(
      `${name} is open in the other editor as it was when moved; this tab keeps the changes made since.`
    );
    return;
  }
  useTabs.getState().close(id);
}
