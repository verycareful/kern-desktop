// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { Rect } from "../ipc/pdf";
import type { PageText, TextLine } from "./text-lines";

// Selecting text on a page. A line's characters are in logical order, and each glyph keeps the
// rectangle where it is drawn, so where a character stands says nothing about its place in the
// text: a right-to-left line runs from its right end, a line on a turned page runs up or down.
// Positions on a line are therefore its visual order, found from the rectangles along the line's
// own axis; the text of a selection is read back in logical order.

/** One piece of text: unit `unit` of line `line` of a page's text (counted from 0). */
export interface CharRef {
  line: number;
  unit: number;
}

type Axis = "x" | "y";

/** A glyph of no size (a point) is never hit and never drawn. */
function sized(r: Rect): boolean {
  return r[2] > r[0] && r[3] > r[1];
}

const centre = (r: Rect, axis: Axis): number =>
  axis === "x" ? (r[0] + r[2]) / 2 : (r[1] + r[3]) / 2;

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
}

/** How far the point is from the rectangle: 0 inside it. */
function distance(r: Rect, x: number, y: number): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dy = Math.max(r[1] - y, 0, y - r[3]);
  return Math.hypot(dx, dy);
}

// The direction a line runs on the page: along the axis its glyphs are spread over, and along
// the long side of the line for one glyph or a line taken whole.
function axisOf(line: TextLine): Axis {
  const rects = line.units.map((u) => u.rect).filter(sized);
  if (rects.length < 2) {
    const r = line.rect;
    return r[3] - r[1] > r[2] - r[0] ? "y" : "x";
  }
  const spread = (axis: Axis): number => {
    const at = rects.map((r) => centre(r, axis));
    return Math.max(...at) - Math.min(...at);
  };
  return spread("y") > spread("x") ? "y" : "x";
}

/**
 * The units of a line that have a size, in the order they stand on the page along the line's
 * axis (left to right, or top to bottom). Units at the same place keep their logical order.
 */
export function visualOrder(line: TextLine): number[] {
  const axis = axisOf(line);
  return line.units
    .map((unit, index) => ({ index, at: centre(unit.rect, axis), shown: sized(unit.rect) }))
    .filter((u) => u.shown)
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((u) => u.index);
}

/** The character under the point (fractions of the page), or null: a glyph of no size is never hit. */
export function hitTest(text: PageText, x: number, y: number): CharRef | null {
  for (let line = 0; line < text.lines.length; line++) {
    const units = text.lines[line]?.units ?? [];
    for (let unit = 0; unit < units.length; unit++) {
      const rect = units[unit]!.rect;
      if (sized(rect) && contains(rect, x, y)) return { line, unit };
    }
  }
  return null;
}

/**
 * The character nearest the point: a drag that leaves the text still has an end, and a press
 * between two glyphs still has a start. Null only when the page has no glyph with a size.
 */
export function charNear(text: PageText, x: number, y: number): CharRef | null {
  let best: CharRef | null = null;
  let bestLine = Infinity;
  let bestUnit = Infinity;
  for (let line = 0; line < text.lines.length; line++) {
    const l = text.lines[line]!;
    // The line is chosen before the glyph, so a point between two lines goes to the nearer line
    // and not to whichever glyph happens to be the closest.
    const lineDistance = distance(l.rect, x, y);
    for (let unit = 0; unit < l.units.length; unit++) {
      const rect = l.units[unit]!.rect;
      if (!sized(rect)) continue;
      const unitDistance = distance(rect, x, y);
      if (lineDistance < bestLine || (lineDistance === bestLine && unitDistance < bestUnit)) {
        best = { line, unit };
        bestLine = lineDistance;
        bestUnit = unitDistance;
      }
    }
  }
  return best;
}

interface Segment {
  line: number;
  /** In logical order. */
  units: number[];
}

// A unit of no size has no place on the line, so it is in a selection when the sized units on
// both sides of it (in the text) are.
function withSizeless(line: TextLine, chosen: Set<number>): number[] {
  const picked: number[] = [];
  line.units.forEach((unit, index) => {
    if (sized(unit.rect)) {
      if (chosen.has(index)) picked.push(index);
      return;
    }
    let before = index - 1;
    while (before >= 0 && !sized(line.units[before]!.rect)) before--;
    let after = index + 1;
    while (after < line.units.length && !sized(line.units[after]!.rect)) after++;
    if (before >= 0 && after < line.units.length && chosen.has(before) && chosen.has(after)) {
      picked.push(index);
    }
  });
  return picked;
}

function segments(text: PageText, a: CharRef, b: CharRef): Segment[] {
  const [first, last] = a.line <= b.line ? [a, b] : [b, a];
  const out: Segment[] = [];
  if (first.line === last.line) {
    const line = text.lines[first.line];
    if (!line) return out;
    const order = visualOrder(line);
    const from = order.indexOf(a.unit);
    const to = order.indexOf(b.unit);
    if (from < 0 || to < 0) return out;
    const chosen = new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1));
    return [{ line: first.line, units: withSizeless(line, chosen) }];
  }
  // Across lines the text is read in its own order: the first line from its character on, the
  // last up to its character, every line between whole.
  for (let i = first.line; i <= last.line; i++) {
    const line = text.lines[i];
    if (!line) continue;
    const start = i === first.line ? first.unit : 0;
    const end = i === last.line ? last.unit : line.units.length - 1;
    const units: number[] = [];
    for (let u = start; u <= end; u++) units.push(u);
    out.push({ line: i, units });
  }
  return out;
}

/** The text a selection from `a` to `b` (either way round) holds: lines in order, each line's characters in logical order. */
export function selectedText(text: PageText, a: CharRef, b: CharRef): string {
  return segments(text, a, b)
    .map((s) => s.units.map((u) => text.lines[s.line]!.units[u]!.text).join(""))
    .filter((line) => line !== "")
    .join("\n");
}

/** The boxes to colour for a selection: one per run of neighbouring glyphs on a line, as fractions of the page. */
export function selectionRects(text: PageText, a: CharRef, b: CharRef): Rect[] {
  const out: Rect[] = [];
  for (const segment of segments(text, a, b)) {
    const line = text.lines[segment.line]!;
    const chosen = new Set(segment.units);
    // Runs follow the line's visual order, so a glyph that is next on the page is next in the run
    // whatever its place in the text.
    let run: Rect | null = null;
    for (const unit of visualOrder(line)) {
      if (!chosen.has(unit)) {
        if (run) out.push(run);
        run = null;
        continue;
      }
      const r = line.units[unit]!.rect;
      run = run
        ? [
            Math.min(run[0], r[0]),
            Math.min(run[1], r[1]),
            Math.max(run[2], r[2]),
            Math.max(run[3], r[3]),
          ]
        : r;
    }
    if (run) out.push(run);
  }
  return out;
}

/** The ends of a selection of the whole page, or null when the page has no text. */
export function wholePage(text: PageText): [CharRef, CharRef] | null {
  const last = text.lines.length - 1;
  if (last < 0) return null;
  if (last === 0) {
    const order = visualOrder(text.lines[0]!);
    const first = order[0];
    const end = order[order.length - 1];
    return first === undefined || end === undefined
      ? null
      : [
          { line: 0, unit: first },
          { line: 0, unit: end },
        ];
  }
  return [
    { line: 0, unit: 0 },
    { line: last, unit: text.lines[last]!.units.length - 1 },
  ];
}

export const sameChar = (a: CharRef, b: CharRef): boolean => a.line === b.line && a.unit === b.unit;

/** The point is inside the box of some line, between its glyphs or not. */
export function inLine(text: PageText, x: number, y: number): boolean {
  return text.lines.some((line) => contains(line.rect, x, y));
}
