// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { invoke, invokeBytes } from "./invoke";
import type { TextExpect, WireStamp } from "./kernkraft";
import type { WirePath } from "./wire-path";

// One typed function per `pdf_*` command of the `kernkraft` plugin
// (kernkraft-tauri, src/pdf_cmds.rs and kernkraft-pdf-engine). Argument names
// are the camelCase of the Rust parameters; field names inside an answer or an
// operation are the engine's own (snake_case).
//
// The app counts pages from 0. The wire counts them from 1: every page number
// that goes out or comes back is converted here and nowhere else. A rotation or
// a removal names pages, a move names an order, an answer names the pages it
// changed and a link names the page it leads to; all of them are converted.

const cmd = (name: string) => `plugin:kernkraft-tauri|${name}`;

/** The number the wire gives the first page; the app's first page is 0. */
export const PAGE_BASE = 1;

/** A page number of the app, as the wire counts it. */
export const toWirePage = (page: number): number => page + PAGE_BASE;

/** A page number of the wire, as the app counts it. */
export const fromWirePage = (page: number): number => page - PAGE_BASE;

// ---- wire types ----

/** The number `pdf_open` answers; every later call names the document by it. */
export type PdfHandle = number;

/** `[left, top, right, bottom]` as fractions of the displayed page, y down. */
export type Rect = [left: number, top: number, right: number, bottom: number];

/** A part of a page to draw, as a rectangle of fractions of the displayed page. */
export type Region = Rect;

/** `[red, green, blue]`, each 0 to 1. */
export type Rgb = [red: number, green: number, blue: number];

/** An object of the file: the id an annotation is named by. */
export interface PdfObjectId {
  object: number;
  generation: number;
}

/** A job number the app chose and never uses twice. */
export type JobId = number;

export interface WirePdfOpened {
  handle: PdfHandle;
  pages: number;
  revision: number;
  /** The file as it was before it was read; hand it back as `unchanged` to save. */
  stamp: WireStamp;
}

export interface PdfPageInfo {
  width_pt: number;
  height_pt: number;
  /** The displayed page's rotation in degrees, a multiple of 90. */
  rotate: number;
  /** `[llx, lly, urx, ury]` of the box of user space the page shows. */
  crop_box: [number, number, number, number];
}

export interface PdfTextLine {
  /** The index of the block the line belongs to. */
  block: number;
  text: string;
  rect: Rect;
  /** One rectangle per character, in the order of `text` (logical, not left to right). */
  glyphs: Rect[];
}

export interface PdfTextBlock {
  id: number;
  rect: Rect;
  editable: boolean;
  /** Why a block cannot be edited (`NoGlyphs`, `NoSize`, `Type3Font`, ...). */
  reason?: string;
}

export interface PdfPageText {
  /** A block index is good only at this revision. */
  revision: number;
  lines: PdfTextLine[];
  blocks: PdfTextBlock[];
  tagged: boolean;
}

export interface PdfSearchMatch {
  rects: Rect[];
}

export interface PdfLink {
  rects: Rect[];
  /** An address the link opens. */
  uri?: string;
  /** The page of this document it leads to, counted from 0. */
  page?: number;
  x?: number | null;
  y?: number | null;
  zoom?: number | null;
}

export interface PdfAnnotation {
  /** Null for an annotation no operation can name. */
  id: PdfObjectId | null;
  /** `Highlight`, `Underline`, `StrikeOut`, `Ink`, `Text` and so on, or `Other`. */
  kind: string;
  /** The PDF subtype of an `Other` annotation. */
  subtype: string | null;
  drawn_by_library: boolean;
  rect: Rect;
  quads: Rect[];
  strokes: [number, number][][];
  contents: string | null;
  author: string | null;
  colour: Rgb | null;
  opacity: number | null;
  line_width: number | null;
  flags: number;
}

export type MarkupKind = "highlight" | "underline" | "strikeOut";

/**
 * One change. Dates are PDF dates (`D:YYYYMMDDHHmmSSOHH'mm'`) from the app's clock. Pages are
 * counted from 0, as everywhere in the app.
 */
export type PdfOp =
  | { op: "rotate"; pages: number[]; degrees: 90 | 180 | 270 }
  | { op: "reorder"; order: number[] }
  | { op: "remove"; pages: number[] }
  | {
      op: "addMarkup";
      kind: MarkupKind;
      page: number;
      quads: Rect[];
      colour: Rgb;
      opacity?: number | null;
      contents?: string | null;
      author?: string | null;
      modified: string;
    }
  | {
      op: "addInk";
      page: number;
      strokes: [number, number][][];
      width: number;
      colour: Rgb;
      opacity?: number | null;
      author?: string | null;
      modified: string;
    }
  | {
      op: "addNote";
      page: number;
      at: [number, number];
      text: string;
      colour: Rgb;
      opacity?: number | null;
      author?: string | null;
      modified: string;
    }
  | {
      op: "editAnnotation";
      page: number;
      id: PdfObjectId;
      colour?: Rgb | null;
      opacity?: number | null;
      line_width?: number | null;
      contents?: string | null;
      author?: string | null;
      translate?: [number, number] | null;
      modified: string;
    }
  | { op: "deleteAnnotation"; page: number; id: PdfObjectId }
  | {
      op: "editText";
      page: number;
      block: number;
      revision: number;
      text: string;
      family?: string | null;
      size?: number | null;
      colour?: Rgb | null;
    }
  | {
      op: "addText";
      page: number;
      /** The top left corner of the text's box, in fractions of the displayed page. */
      at: [number, number];
      /** The box's width, a fraction of the displayed page's width; the lines wrap at it. */
      width: number;
      text: string;
      /** The block whose font, size and colour the text takes; else the block nearest `at`. */
      like?: { block: number; revision: number } | null;
      family?: string | null;
      /** In points. A page with no text to follow refuses new text without it (`NoSizeForNewText`). */
      size?: number | null;
      colour?: Rgb | null;
    };

export interface PdfEditAnswer {
  revision: number;
  pages: number;
  /** Counted from 0. */
  changed_pages: number[];
  can_undo: boolean;
  can_redo: boolean;
  modified: boolean;
  /** The annotation an add operation made. */
  annotation?: PdfObjectId;
  /** After `editText` and `addText`: the lines the new text came to. */
  lines?: number;
  /** After `editText` and `addText`: the fonts of the page that had to be replaced, in words. */
  notes?: string[];
  /** After `addText`: the family the text is set in. */
  family?: string;
  /** After `addText`: the block whose style the text took, or null when no block was followed. */
  followed?: number | null;
}

export interface PdfRenderSize {
  width: number;
  height: number;
  bytes: number;
}

export interface PdfJobProgress {
  running: boolean;
  done: number;
  /** 0 until the operation knows it. */
  total: number;
  stage: string;
}

export interface PdfFonts {
  faces: number;
  skipped: number;
  unreadable_dirs: number;
}

/** A PDF to read and the password that opens it, when it has one. */
export interface PdfSource {
  path: WirePath;
  password?: string;
}

/** What a save expects at its path: the same three cases as a text save. */
export type PdfExpect = TextExpect;

// ---- page conversion ----

interface WireOpAnswer extends Omit<PdfEditAnswer, "changed_pages"> {
  changed_pages: number[];
}

const fromWireAnswer = (a: WireOpAnswer): PdfEditAnswer => ({
  ...a,
  changed_pages: a.changed_pages.map(fromWirePage),
});

const toWireOp = (op: PdfOp): Record<string, unknown> => {
  switch (op.op) {
    case "rotate":
    case "remove":
      return { ...op, pages: op.pages.map(toWirePage) };
    case "reorder":
      return { ...op, order: op.order.map(toWirePage) };
    case "addMarkup":
    case "addInk":
    case "addNote":
    case "editAnnotation":
    case "deleteAnnotation":
    case "editText":
    case "addText":
      return { ...op, page: toWirePage(op.page) };
  }
};

// ---- documents ----

/**
 * Opens the PDF at `path`. The document belongs to the window that calls this and closes with
 * it; close it with `pdfClose` when done. An encrypted file refuses with `WrongPassword` until
 * `password` opens it.
 */
export const pdfOpen = (path: WirePath, password?: string) =>
  invoke<WirePdfOpened>(cmd("pdf_open"), { path, password });

export const pdfClose = (handle: PdfHandle) => invoke<void>(cmd("pdf_close"), { handle });

export const pdfPageInfo = (handle: PdfHandle, page: number) =>
  invoke<PdfPageInfo>(cmd("pdf_page_info"), { handle, page: toWirePage(page) });

export const pdfText = (handle: PdfHandle, page: number, job?: JobId) =>
  invoke<PdfPageText>(cmd("pdf_text"), { handle, page: toWirePage(page), job });

/** The matches on one page; loop the pages and cancel with the job to stop between them. */
export const pdfSearch = (
  handle: PdfHandle,
  page: number,
  query: string,
  caseSensitive = false,
  wholeWord = false,
  job?: JobId
) =>
  invoke<{ matches: PdfSearchMatch[] }>(cmd("pdf_search"), {
    handle,
    page: toWirePage(page),
    query,
    caseSensitive,
    wholeWord,
    job,
  }).then((a) => a.matches);

export const pdfLinks = (handle: PdfHandle, page: number) =>
  invoke<{ links: PdfLink[] }>(cmd("pdf_links"), { handle, page: toWirePage(page) }).then((a) =>
    a.links.map((link) =>
      link.page === undefined ? link : { ...link, page: fromWirePage(link.page) }
    )
  );

export const pdfAnnotations = (handle: PdfHandle, page: number) =>
  invoke<{ annotations: PdfAnnotation[] }>(cmd("pdf_annotations"), {
    handle,
    page: toWirePage(page),
  }).then((a) => a.annotations);

// ---- edits ----

export const pdfApply = (handle: PdfHandle, op: PdfOp, job?: JobId) =>
  invoke<WireOpAnswer>(cmd("pdf_apply"), { handle, op: toWireOp(op), job }).then(fromWireAnswer);

export const pdfUndo = (handle: PdfHandle) =>
  invoke<WireOpAnswer>(cmd("pdf_undo"), { handle }).then(fromWireAnswer);

export const pdfRedo = (handle: PdfHandle) =>
  invoke<WireOpAnswer>(cmd("pdf_redo"), { handle }).then(fromWireAnswer);

/**
 * Writes the opened bytes and one update to `path`, as far as `expect` allows; answers the stamp
 * of the file written. A file changed under the app refuses with `ExternalModification` and is
 * never overwritten. `modified` is the PDF date the app writes from its clock.
 */
export const pdfSave = (
  handle: PdfHandle,
  path: WirePath,
  expect: PdfExpect,
  modified: string,
  job?: JobId
) => invoke<WireStamp>(cmd("pdf_save"), { handle, path, expect, modified, job });

/** Writes a compacted copy to `out` (never over a file); answers its path. */
export const pdfCompact = (handle: PdfHandle, out: WirePath, job?: JobId) =>
  invoke<WirePath>(cmd("pdf_compact"), { handle, out, job });

/**
 * Writes a compacted copy of the file `source` to `out` (never over a file); answers its path. For
 * a file `pdfOpen` refuses with `RebuiltNotEditable` or `RevisionNotEditable`, which has no
 * document to `pdfCompact`.
 */
export const pdfCompactFile = (source: PdfSource, out: WirePath, job?: JobId) =>
  invoke<WirePath>(cmd("pdf_compact_file"), { source, out, job });

// ---- drawing ----

/** The size of the picture `pdfRender` makes: ask first, a picture is up to 1 GiB. */
export const pdfRenderSize = (
  handle: PdfHandle,
  page: number,
  region: Region | null,
  widthPx: number
) =>
  invoke<PdfRenderSize>(cmd("pdf_render_size"), {
    handle,
    page: toWirePage(page),
    region,
    widthPx,
  });

/** Straight RGBA8 rows from the top: `width * height * 4` bytes of the size `pdfRenderSize` gave. */
export const pdfRender = (
  handle: PdfHandle,
  page: number,
  region: Region | null,
  widthPx: number,
  job?: JobId
) =>
  invokeBytes(cmd("pdf_render"), {
    handle,
    page: toWirePage(page),
    region,
    widthPx,
    job,
  });

// ---- files, not documents ----

/** Joins the sources into `out` (never over a file); answers its path. */
export const pdfMerge = (sources: PdfSource[], out: WirePath, job?: JobId) =>
  invoke<WirePath>(cmd("pdf_merge"), { sources, out, job });

/** Writes the pages (counted from 0, in the order given) of `source` to `out`. */
export const pdfExtract = (source: PdfSource, pages: number[], out: WirePath, job?: JobId) =>
  invoke<WirePath>(cmd("pdf_extract"), { source, pages: pages.map(toWirePage), out, job });

/**
 * Splits `source` into files in `outDir`. `ranges` is what the user types, as the page numbers
 * are shown (from 1): `1-3,5,7-9`. Answers the paths written.
 */
export const pdfSplit = (source: PdfSource, ranges: string, outDir: WirePath, job?: JobId) =>
  invoke<WirePath[]>(cmd("pdf_split"), { source, ranges, outDir, job });

// ---- jobs ----

export const pdfCancelJob = (job: JobId) => invoke<unknown>(cmd("pdf_cancel_job"), { job });

export const pdfJobProgress = (job: JobId) =>
  invoke<PdfJobProgress>(cmd("pdf_job_progress"), { job });

// ---- fonts and colour ----

/** Indexes the system's font files for text edits and renders; once per app start. */
export const pdfSetSystemFonts = (job?: JobId) =>
  invoke<PdfFonts>(cmd("pdf_set_system_fonts"), { job });

/** Uses the ICC profile at `path` for DeviceCMYK; with no path, takes the profile away. */
export const pdfSetCmykProfile = (path?: WirePath) =>
  invoke<{ source: "application" | "bundled" }>(cmd("pdf_set_cmyk_profile"), { path });
