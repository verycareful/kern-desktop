// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import { confirmClose, isMainWindow, toWireError } from "../ipc";
import { docController } from "../editor/doc-controller";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";
import { tabTitle, useTabs } from "../store/tabs";

// Closing a document (design 4.5, parent spec 6.2): a document with unsaved
// changes, or whose file was deleted on disk (its text is then the only copy),
// is not closed without asking Save, Close without saving or Cancel. Closing
// the main window asks once for all such documents together. Save writes each
// in turn; one that cannot be saved (changed by another program, read-only, a
// failure) stops the close and is shown with its reason, and nothing closes.
// One question is open at a time; a close asked for meanwhile does nothing.

export type CloseChoice = "save" | "discard" | "cancel";

/** A document that closing would lose something of. */
export interface AtRisk {
  id: string;
  name: string;
  dirty: boolean;
  /** The file was deleted on disk: the open text is the only copy. */
  deleted: boolean;
  /** It cannot be saved where it is; Save As can keep it. */
  readOnly: boolean;
}

export interface CloseQuestion {
  items: AtRisk[];
  /** What is being closed: a tab, or a window with all of its documents. */
  what: "tab" | "window";
  /** Save was chosen and the documents are being written. */
  saving: boolean;
}

interface CloseGuardState {
  question: CloseQuestion | null;
  answer(choice: CloseChoice): void;
  reset(): void;
}

let pending: ((choice: CloseChoice) => void) | null = null;

export const useCloseGuard = create<CloseGuardState>()((set) => ({
  question: null,
  answer(choice) {
    const resolve = pending;
    pending = null;
    // Cancel and Close without saving end the question at once; Save keeps it, busy, while it writes.
    if (choice !== "save") set({ question: null });
    resolve?.(choice);
  },
  reset() {
    pending = null;
    set({ question: null });
  },
}));

const say = (text: string) => useOps.getState().notify(text);

/** The documents among `ids` that closing would lose something of. */
function atRisk(ids: readonly string[]): AtRisk[] {
  const tabs = useTabs.getState().tabs;
  return ids.flatMap((id) => {
    const tab = tabs.find((t) => t.id === id);
    const risk = tab?.kind === "doc" ? docController(id)?.closeRisk() : null;
    return tab && risk ? [{ id, name: tabTitle(tab), ...risk }] : [];
  });
}

/**
 * Asks about the documents among `ids` that closing would lose something of, and saves them if
 * the user says so. True when they may all be closed now.
 */
export async function mayClose(ids: readonly string[], what: "tab" | "window"): Promise<boolean> {
  const items = atRisk(ids);
  return items.length === 0 || (await ask(items, what)) !== "stop";
}

/** "saved": each was written; "discard": the user gave them up; "stop": nothing may close. */
type Outcome = "saved" | "discard" | "stop";

async function ask(items: AtRisk[], what: "tab" | "window"): Promise<Outcome> {
  if (useCloseGuard.getState().question) {
    say("Kern is already asking about closing. Answer that question first.");
    return "stop";
  }
  const choice = await new Promise<CloseChoice>((resolve) => {
    pending = resolve;
    useCloseGuard.setState({ question: { items, what, saving: false } });
  });
  // answer() has ended the question already: a question asked since is another close's own.
  if (choice === "cancel") return "stop";
  if (choice === "discard") return "discard";
  const saving: CloseQuestion = { items, what, saving: true };
  useCloseGuard.setState({ question: saving });
  try {
    for (const item of items) {
      const doc = docController(item.id);
      // A document gone meanwhile (its tab closed) has nothing left to save.
      if (doc && !(await doc.saveForClose())) {
        // Its editor shows why (the question about a changed file, the failure); the user is
        // taken there and nothing closes.
        useTabs.getState().activate(item.id);
        say(`${item.name} was not saved, so nothing was closed.`);
        return "stop";
      }
    }
    return "saved";
  } finally {
    if (useCloseGuard.getState().question === saving) useCloseGuard.setState({ question: null });
  }
}

/**
 * Closes tab `id`: at once when nothing would be lost, else once the question is answered. In a
 * document window the document is the window, so the window closes.
 */
export function closeTab(id: string): void {
  if (!isMainWindow()) {
    void closeWindow();
    return;
  }
  const items = atRisk([id]);
  if (items.length === 0) useTabs.getState().close(id);
  else void ask(items, "tab").then((o) => o !== "stop" && useTabs.getState().close(id));
}

/**
 * Closes this window once nothing in any of its documents would be lost. A document that arrives
 * while the question is open (moved here from another window) was not in it: the window looks
 * again after each answer and asks about what is new, and closes only when nothing it has not
 * asked about is at risk. The last look and the close follow each other with nothing between.
 */
export async function closeWindow(): Promise<void> {
  /** The documents the user chose to close without saving. */
  const givenUp = new Set<string>();
  for (;;) {
    const ids = useTabs
      .getState()
      .tabs.filter((t) => t.kind === "doc" && !givenUp.has(t.id))
      .map((t) => t.id);
    const items = atRisk(ids);
    if (items.length === 0) break;
    const outcome = await ask(items, "window");
    if (outcome === "stop") return;
    if (outcome === "discard") items.forEach((i) => givenUp.add(i.id));
  }
  try {
    await confirmClose();
  } catch (e) {
    say(`The window could not be closed: ${errorText(toWireError(e))}`);
  }
}
