// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { PdfPageText } from "../ipc/pdf";
import type { Rect } from "../ipc/pdf";

// A page's text as the text layer and the selection use it. The engine answers a line as its text
// and one rectangle per glyph; a glyph that is a ligature carries more than one character and the
// wire does not say how many, so a line whose characters do not match its glyphs one to one cannot
// be cut between glyphs. Such a line is one unit: it is selected whole, with its own rectangle.

/** The smallest piece a selection starts or ends at: one character with its glyph, or a whole line. */
export interface TextUnit {
  text: string;
  /** Fractions of the displayed page: `[left, top, right, bottom]`, y down. */
  rect: Rect;
}

export interface TextLine {
  /** The characters in logical order, as the engine gave them. */
  text: string;
  rect: Rect;
  /** In logical order: unit `i` is the `i`th character of `text`, or the only unit of a whole line. */
  units: TextUnit[];
  /** The line's characters do not match its glyphs one to one, so it is selected as one piece. */
  whole: boolean;
}

export interface PageText {
  /** The edit state of the document the text was read at. */
  revision: number;
  /** In reading order, with no blank line. */
  lines: TextLine[];
}

/** The text layer's lines of a page: blank lines dropped, each line cut into units. */
export function pageText(wire: PdfPageText): PageText {
  const lines: TextLine[] = [];
  for (const line of wire.lines) {
    if (line.text.trim() === "") continue;
    const characters = Array.from(line.text);
    const whole = characters.length !== line.glyphs.length;
    const units: TextUnit[] = whole
      ? [{ text: line.text, rect: line.rect }]
      : characters.map((text, i) => ({ text, rect: line.glyphs[i] as Rect }));
    lines.push({ text: line.text, rect: line.rect, units, whole });
  }
  return { revision: wire.revision, lines };
}
