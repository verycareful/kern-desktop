// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { MarkupKind, PdfAnnotation, PdfObjectId, Rect, Rgb } from "../ipc/pdf";
import type { PdfOpInput } from "./edit-state";

// What an annotation is, how it is picked on a page and the operations that make, change and
// take away one. Every geometry is in fractions of the displayed page, y down, which is what
// the text layer's rectangles are and what the engine takes: it turns them into the page's user
// space itself, so a turned page needs nothing here.

/** A colour offered for an annotation. Annotations are document content, so these never follow the theme. */
export interface Swatch {
  name: string;
  rgb: Rgb;
}

export const PALETTE: readonly Swatch[] = [
  { name: "Yellow", rgb: [1, 0.92, 0.2] },
  { name: "Green", rgb: [0.4, 0.85, 0.4] },
  { name: "Blue", rgb: [0.35, 0.65, 1] },
  { name: "Pink", rgb: [1, 0.55, 0.75] },
  { name: "Red", rgb: [0.9, 0.15, 0.15] },
  { name: "Black", rgb: [0, 0, 0] },
];

/** What a new annotation is drawn in until another colour is chosen. */
export const DEFAULT_COLOURS = {
  markup: PALETTE[0]!.rgb,
  ink: PALETTE[4]!.rgb,
  note: PALETTE[0]!.rgb,
} as const;

/** The widths of an ink line, in points (the engine's unit), and the one a new line has. */
export const INK_WIDTHS: readonly number[] = [1, 2, 4, 8];
export const DEFAULT_INK_WIDTH = 2;

/** How far a press may be from an ink line, as a fraction of the page, and still be on it. */
const INK_REACH = 0.012;

/** How long after a line is let go the lines drawn so far are made one change. */
export const INK_GROUP_MS = 1000;

/** A point nearer than this (fractions of the page) to the last point of a stroke adds nothing. */
const STROKE_STEP = 0.002;

/** Whether two colours are the same colour. */
export const sameColour = (a: Rgb, b: Rgb): boolean => a.every((v, i) => v === b[i]);

/** The name of a colour of the palette, or null for one that is not in it. */
export const colourName = (rgb: Rgb): string | null =>
  PALETTE.find((s) => sameColour(s.rgb, rgb))?.name ?? null;

// ---- operations ----

/** The operation that marks `rects` (the rectangles of a text selection), or null when there are none. */
export function markupOp(
  kind: MarkupKind,
  page: number,
  rects: readonly Rect[],
  colour: Rgb
): PdfOpInput | null {
  const quads = rects.filter((r) => r[2] > r[0] && r[3] > r[1]).map((r): Rect => [...r]);
  if (quads.length === 0) return null;
  return { op: "addMarkup", kind, page, quads, colour };
}

/** The operation that draws `strokes` (each at least one point) `width` points wide, or null when there are none. */
export function inkOp(
  page: number,
  strokes: readonly (readonly [number, number][])[],
  colour: Rgb,
  width: number
): PdfOpInput | null {
  const kept = strokes
    .filter((s) => s.length > 0)
    .map((s) => s.map((p): [number, number] => [...p]));
  if (kept.length === 0) return null;
  return { op: "addInk", page, strokes: kept, width, colour };
}

/** The operation that puts a note reading `text` at `at`. */
export const noteOp = (
  page: number,
  at: readonly [number, number],
  text: string,
  colour: Rgb
): PdfOpInput => ({ op: "addNote", page, at: [at[0], at[1]], text, colour });

/** The operation that gives the annotation a colour. */
export const recolourOp = (page: number, id: PdfObjectId, colour: Rgb): PdfOpInput => ({
  op: "editAnnotation",
  page,
  id,
  colour,
});

/** The operation that sets the text of a note. */
export const noteTextOp = (page: number, id: PdfObjectId, text: string): PdfOpInput => ({
  op: "editAnnotation",
  page,
  id,
  contents: text,
});

/** The operation that takes the annotation away, and no other. */
export const deleteOp = (page: number, id: PdfObjectId): PdfOpInput => ({
  op: "deleteAnnotation",
  page,
  id,
});

// ---- what an annotation is ----

/** An annotation that can be picked: one an operation can name and the library draws. */
export interface Pickable extends PdfAnnotation {
  id: PdfObjectId;
}

/**
 * Whether an operation can change this annotation. One written straight into the page has no
 * name to give the engine, and one of a kind the library does not draw (a form field, a stamp,
 * a link) is the page's own: it is shown and left alone.
 */
export const isPickable = (a: PdfAnnotation): a is Pickable => a.id !== null && a.drawn_by_library;

export const isNote = (a: PdfAnnotation): boolean => a.kind === "Note";

/** The name of what the annotation is, for its label and its menu. */
export function kindLabel(a: PdfAnnotation): string {
  switch (a.kind) {
    case "Highlight":
      return "Highlight";
    case "Underline":
      return "Underline";
    case "StrikeOut":
      return "Strikeout";
    case "Ink":
      return "Ink";
    case "Note":
      return "Note";
    default:
      return a.subtype ?? "Annotation";
  }
}

/** The annotations of a page that can be picked. */
export const pickable = (list: readonly PdfAnnotation[]): Pickable[] => list.filter(isPickable);

/** Whether two annotations are the same object. */
export const sameId = (a: PdfObjectId, b: PdfObjectId): boolean =>
  a.object === b.object && a.generation === b.generation;

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

function distanceToSegment(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function onInk(a: PdfAnnotation, x: number, y: number): boolean {
  return a.strokes.some((stroke) => {
    if (stroke.length === 1) {
      const only = stroke[0]!;
      return Math.hypot(x - only[0], y - only[1]) <= INK_REACH;
    }
    return stroke.some(
      (point, i) => i > 0 && distanceToSegment([x, y], stroke[i - 1]!, point) <= INK_REACH
    );
  });
}

function covers(a: Pickable, x: number, y: number): boolean {
  switch (a.kind) {
    case "Highlight":
    case "Underline":
    case "StrikeOut":
      return a.quads.some((q) => inside(q, x, y));
    case "Ink":
      return onInk(a, x, y);
    default:
      return inside(a.rect, x, y);
  }
}

/**
 * The annotation at the point (fractions of the page): the one drawn last of those that cover it,
 * as it is the one on top. Null when none can be picked there.
 */
export function annotationAt(
  list: readonly PdfAnnotation[],
  x: number,
  y: number
): Pickable | null {
  const found = pickable(list).filter((a) => covers(a, x, y));
  return found[found.length - 1] ?? null;
}

// ---- pointer ----

/** The part of the screen a page covers, in CSS pixels. */
export interface PageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The point the pointer is over as fractions of the page, kept on the page; null for a page of no size. */
export function fractionAt(
  clientX: number,
  clientY: number,
  bounds: PageBounds
): [number, number] | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  return [
    clamp01((clientX - bounds.left) / bounds.width),
    clamp01((clientY - bounds.top) / bounds.height),
  ];
}

/** `stroke` with `point` added, unless it is no further from the last point than a stroke needs. */
export function extendStroke(
  stroke: readonly [number, number][],
  point: readonly [number, number]
): [number, number][] {
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < STROKE_STEP) {
    return stroke as [number, number][];
  }
  return [...stroke, [point[0], point[1]]];
}

/** A colour as CSS writes it, for what is drawn over the page before the engine has drawn it. */
export const cssColour = (rgb: Rgb): string =>
  `rgb(${rgb.map((c) => Math.round(c * 255)).join(" ")})`;
