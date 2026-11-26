// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { create } from "zustand";
import type { PdfAnnotation, PdfObjectId, Rgb } from "../ipc/pdf";
import { DEFAULT_COLOURS, DEFAULT_INK_WIDTH, sameId } from "./annotations";

// What a PDF tab is doing with annotations, keyed by tab id: the tool in hand, the colour and the
// ink width a new annotation gets, the annotation picked, the note being written, and the
// annotations of the pages in view. Pages write what they read here and the actions and the menus
// read it, so none of them needs the page's React tree (as pdf-selection.ts does for text).

/** Select picks text and annotations; Ink and Note act on the page where it is pressed. */
export type PdfTool = "select" | "ink" | "note";

/** The kind of annotation a colour is for: it decides the colour when none has been chosen. */
export type ColourFor = "highlight" | "underline" | "strikeOut" | "ink" | "note";

/** What a new annotation is drawn in until a colour is chosen. */
const DEFAULT_FOR: Record<ColourFor, Rgb> = {
  highlight: DEFAULT_COLOURS.markup,
  underline: DEFAULT_COLOURS.ink,
  strikeOut: DEFAULT_COLOURS.ink,
  ink: DEFAULT_COLOURS.ink,
  note: DEFAULT_COLOURS.note,
};

export interface PickedAnnotation {
  /** Counted from 0. */
  page: number;
  id: PdfObjectId;
}

/** A note that is being written: where it goes, or the annotation whose text it sets. */
export type NoteDraft =
  | { kind: "new"; page: number; at: [number, number] }
  | { kind: "edit"; page: number; id: PdfObjectId };

export interface ToolState {
  tool: PdfTool;
  /** Chosen in the panel; null until then, and a new annotation takes the default for its kind. */
  colour: Rgb | null;
  /** In points. */
  inkWidth: number;
  picked: PickedAnnotation | null;
  draft: NoteDraft | null;
}

const INITIAL: ToolState = {
  tool: "select",
  colour: null,
  inkWidth: DEFAULT_INK_WIDTH,
  picked: null,
  draft: null,
};

interface PdfToolStore {
  byTab: Record<string, ToolState>;
  /** The annotations of each page read last, by tab and page; a page's list is read again when it changes. */
  listed: Record<string, Record<number, readonly PdfAnnotation[]>>;
  setTool(tabId: string, tool: PdfTool): void;
  setColour(tabId: string, colour: Rgb): void;
  setInkWidth(tabId: string, width: number): void;
  pick(tabId: string, picked: PickedAnnotation | null): void;
  draft(tabId: string, draft: NoteDraft | null): void;
  setListed(tabId: string, page: number, list: readonly PdfAnnotation[]): void;
  dropListed(tabId: string, page: number): void;
  forget(tabId: string): void;
}

const patch = (s: PdfToolStore, tabId: string, change: Partial<ToolState>) => ({
  byTab: { ...s.byTab, [tabId]: { ...(s.byTab[tabId] ?? INITIAL), ...change } },
});

export const usePdfTool = create<PdfToolStore>()((set) => ({
  byTab: {},
  listed: {},
  // Leaving the Select tool puts down what Select was holding: a picked annotation and a note
  // that was being written.
  setTool: (tabId, tool) =>
    set((s) => patch(s, tabId, tool === "select" ? { tool } : { tool, picked: null, draft: null })),
  setColour: (tabId, colour) => set((s) => patch(s, tabId, { colour })),
  setInkWidth: (tabId, inkWidth) => set((s) => patch(s, tabId, { inkWidth })),
  pick: (tabId, picked) => set((s) => patch(s, tabId, { picked })),
  draft: (tabId, draft) => set((s) => patch(s, tabId, { draft })),
  setListed: (tabId, page, list) =>
    set((s) => ({ listed: { ...s.listed, [tabId]: { ...s.listed[tabId], [page]: list } } })),
  dropListed: (tabId, page) =>
    set((s) => {
      const pages = s.listed[tabId];
      if (!pages || !(page in pages)) return s;
      const rest = { ...pages };
      delete rest[page];
      return { listed: { ...s.listed, [tabId]: rest } };
    }),
  forget: (tabId) =>
    set((s) => {
      const byTab = { ...s.byTab };
      const listed = { ...s.listed };
      delete byTab[tabId];
      delete listed[tabId];
      return { byTab, listed };
    }),
}));

/** The state of a tab: the defaults for one that has done nothing yet. */
export const toolStateOf = (tabId: string): ToolState =>
  usePdfTool.getState().byTab[tabId] ?? INITIAL;

/** The colour a new annotation of `kind` takes in this tab. */
export const colourFor = (tabId: string, kind: ColourFor): Rgb =>
  toolStateOf(tabId).colour ?? DEFAULT_FOR[kind];

/** The annotation picked in the tab, as the page's list gives it; null when it is gone from the page. */
export function pickedAnnotation(tabId: string): PdfAnnotation | null {
  const { picked } = toolStateOf(tabId);
  if (!picked) return null;
  const list = usePdfTool.getState().listed[tabId]?.[picked.page];
  return list?.find((a) => a.id !== null && sameId(a.id, picked.id)) ?? null;
}
