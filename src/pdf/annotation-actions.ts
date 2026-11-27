// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MarkupKind, PdfObjectId, Rect, Rgb } from "../ipc/pdf";
import { toWireError } from "../ipc";
import { errorText } from "../ops/error-text";
import { useOps } from "../ops/useOps";
import { deleteOp, markupOp, noteOp, noteTextOp, recolourOp } from "./annotations";
import { loadPageText } from "./page-text";
import { usePdfSelection } from "./pdf-selection";
import { colourFor, pickedAnnotation, toolStateOf, usePdfTool, type ColourFor } from "./pdf-tool";
import { selectionRects } from "./selection";
import type { PdfDoc } from "./usePdfDoc";

const say = (text: string) => useOps.getState().notify(text);

const COLOUR_KIND: Record<MarkupKind, ColourFor> = {
  highlight: "highlight",
  underline: "underline",
  strikeOut: "strikeOut",
};

/** The selected text of the tab (a markup can be made of it) and the document can be changed. */
export function canMark(tabId: string, doc: PdfDoc): boolean {
  return doc.canEdit && usePdfSelection.getState().byTab[tabId] !== undefined;
}

/**
 * Marks the selected text: one change, which the engine answers with the page changed. The
 * selection is let go once the change is made, as the page's text is drawn again.
 */
export async function markSelection(tabId: string, doc: PdfDoc, kind: MarkupKind): Promise<void> {
  const selection = usePdfSelection.getState().byTab[tabId];
  if (!selection) return;
  if (!doc.canEdit) {
    say("This document cannot be changed here");
    return;
  }
  try {
    const text = await loadPageText(doc, selection.page);
    const op = markupOp(
      kind,
      selection.page,
      selectionRects(text, selection.from, selection.to),
      colourFor(tabId, COLOUR_KIND[kind])
    );
    if (!op) {
      say("There is no text to mark in the selection");
      return;
    }
    usePdfSelection.getState().clear(tabId);
    await doc.apply(op);
  } catch (e) {
    say(`The text could not be marked: ${errorText(toWireError(e))}`);
  }
}

/**
 * Starts a note on the selected text: the text is highlighted and the note is kept with the
 * highlight when it is written. `at` is where the note's box stands, the end of the selection.
 */
export async function noteAtSelection(
  tabId: string,
  doc: PdfDoc,
  at: [number, number]
): Promise<void> {
  const selection = usePdfSelection.getState().byTab[tabId];
  if (!selection) return;
  if (!doc.canEdit) {
    say("This document cannot be changed here");
    return;
  }
  try {
    const text = await loadPageText(doc, selection.page);
    const rects = selectionRects(text, selection.from, selection.to);
    if (!markupOp("highlight", selection.page, rects, colourFor(tabId, "highlight"))) {
      say("There is no text to put a note on in the selection");
      return;
    }
    usePdfSelection.getState().clear(tabId);
    usePdfTool.getState().draft(tabId, { kind: "markup", page: selection.page, at, rects });
  } catch (e) {
    say(`The note could not be started: ${errorText(toWireError(e))}`);
  }
}

/** Highlights `rects` of `page` with the note `text` kept with the highlight: one change. */
export async function addMarkupNote(
  tabId: string,
  doc: PdfDoc,
  page: number,
  rects: readonly Rect[],
  text: string
): Promise<void> {
  const op = markupOp("highlight", page, rects, colourFor(tabId, "highlight"), text);
  if (op) await doc.apply(op);
}

/** Adds a note reading `text` at `at` on `page`. */
export function addNote(
  tabId: string,
  doc: PdfDoc,
  page: number,
  at: [number, number],
  text: string
): Promise<void> {
  return doc.apply(noteOp(page, at, text, colourFor(tabId, "note")));
}

/** The picked annotation can be taken away or changed: it is on the page and the document can be changed. */
export function canChangePicked(tabId: string, doc: PdfDoc): boolean {
  return doc.canEdit && pickedAnnotation(tabId) !== null;
}

/** Takes the picked annotation away; undo brings it back. */
export async function deletePicked(tabId: string, doc: PdfDoc): Promise<void> {
  const { picked } = toolStateOf(tabId);
  if (!picked || !doc.canEdit) return;
  usePdfTool.getState().pick(tabId, null);
  await doc.apply(deleteOp(picked.page, picked.id));
}

/** Gives the picked annotation a colour. */
export async function recolourPicked(tabId: string, doc: PdfDoc, colour: Rgb): Promise<void> {
  const { picked } = toolStateOf(tabId);
  if (!picked || !doc.canEdit) return;
  await doc.apply(recolourOp(picked.page, picked.id, colour));
}

/** Sets the text of the note, or the note on marked text, `id` on page `page` (from 0). */
export async function setNoteText(
  doc: PdfDoc,
  page: number,
  id: PdfObjectId,
  text: string
): Promise<void> {
  if (!doc.canEdit) return;
  await doc.apply(noteTextOp(page, id, text));
}
