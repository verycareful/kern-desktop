// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { clipText, toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";
import { usePdfSelection } from "./pdf-selection";
import { loadPageText } from "./page-text";
import { selectedText, wholePage } from "./selection";
import type { PdfDoc } from "./usePdfDoc";

const say = (text: string) => useOps.getState().notify(text);

/** The tab has text selected. */
export function hasSelection(tabId: string): boolean {
  return usePdfSelection.getState().byTab[tabId] !== undefined;
}

/** The text of the tab's selection, or null when nothing is selected or the page cannot be read. */
async function textOfSelection(tabId: string, doc: PdfDoc): Promise<string | null> {
  const selection = usePdfSelection.getState().byTab[tabId];
  if (!selection) return null;
  try {
    const text = await loadPageText(doc, selection.page);
    return selectedText(text, selection.from, selection.to);
  } catch (e) {
    say(`The text could not be read: ${errorText(toWireError(e))}`);
    return null;
  }
}

/** Puts the selected text on the clipboard; a failure is said in the status bar. */
export async function copySelection(tabId: string, doc: PdfDoc): Promise<void> {
  const text = await textOfSelection(tabId, doc);
  if (text === null) return;
  if (text === "") {
    say("There is no text to copy in the selection");
    return;
  }
  try {
    await clipText(text);
    say("Copied the selected text");
  } catch (e) {
    say(`The text could not be copied: ${errorText(toWireError(e))}`);
  }
}

/** Asks for the selected text to be searched for. */
export async function searchSelection(tabId: string, doc: PdfDoc): Promise<void> {
  const text = await textOfSelection(tabId, doc);
  if (text === null) return;
  if (text.trim() === "") {
    say("There is no text to search for in the selection");
    return;
  }
  usePdfSelection.getState().requestSearch(tabId, text);
}

/** Selects all the text of page `page` (from 0). */
export async function selectAllOnPage(tabId: string, doc: PdfDoc, page: number): Promise<void> {
  try {
    const text = await loadPageText(doc, page);
    const ends = wholePage(text);
    if (!ends) {
      say(`Page ${page + 1} has no text to select`);
      return;
    }
    usePdfSelection.getState().select(tabId, { page, from: ends[0], to: ends[1] });
  } catch (e) {
    say(`The text could not be read: ${errorText(toWireError(e))}`);
  }
}
