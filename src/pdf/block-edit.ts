// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { toWireError, type WireError } from "../ipc";
import type { PdfTextBlock, Rect } from "../ipc/pdf";
import { errorText } from "../ops/error-text";
import type { ApplyOutcome, PdfOpInput } from "./edit-state";
import type { PageText, TextLine } from "./text-lines";
import type { PdfDoc } from "./usePdfDoc";

// Editing the text of a block: what the engine is asked, what its refusals say in plain words, and
// the one retry a block read at an older revision is owed. The engine names a block by its index
// in the page's text, good only at the revision the page was read at.

/** Two rectangles of one block, read twice, are the same to within this many page fractions. */
const SAME_RECT_TOLERANCE = 1e-6;

/** The block a user chose, as it was when it was read. */
export interface BlockTarget {
  /** Counted from 0. */
  page: number;
  block: number;
  /** The revision the page's text was read at; the block index is good only at this revision. */
  revision: number;
  /** The text of the block as it was read, the box's first text. */
  original: string;
  rect: Rect;
}

/** How a request to change a block's text ended. */
export type BlockResult =
  | { status: "done" }
  /** Nothing was changed and nothing went wrong: the copy question was cancelled. */
  | { status: "declined" }
  | { status: "failed"; message: string };

/** Where the box of a block stands when it is not where it was read: only what was changed is given. */
export interface BlockBoxChange {
  left?: number;
  width?: number;
}

/**
 * The change that sets a block's text; empty text takes the block's text off the page. A `box`
 * moves the block's left edge and sets the width its text is broken to.
 */
export function editBlockOp(
  page: number,
  block: number,
  revision: number,
  text: string,
  box: BlockBoxChange = {}
): PdfOpInput {
  const op: PdfOpInput = { op: "editText", page, block, revision, text };
  if (box.left !== undefined) op.left = box.left;
  if (box.width !== undefined) op.width = box.width;
  return op;
}

/**
 * A line that ends in one of these already gives the engine's line breaking (UAX #14) a place to
 * break, so it joins the next with nothing between them: a space, and a soft hyphen, which the
 * engine drops, so a word hyphenated at the wrap joins up whole.
 */
const BREAKS_AFTER = /^[\s\u00AD]$/u;
/**
 * A hyphen or dash that ends a word ("well-" then "known") joins with nothing (UAX #14 LB21, B2);
 * one set apart by a space ("a –" then "b") keeps the space after it.
 */
const DASH = /^[-\u2010\u2012\u2013\u2014]$/u;
/**
 * Scripts written with no space between words: a wrap between two of their characters joins
 * with nothing (UAX #14 LB31 for ideographs, SA for South East Asian scripts), and so does one
 * beside CJK punctuation or a full-width form.
 */
const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\u3000-\u303F\uFF00-\uFFEF]/u;

/** What goes between a line and the next line of its block. */
function lineEnd(line: TextLine, next: TextLine): string {
  if (!line.wrapped) return "\n";
  const chars = Array.from(line.text);
  const last = chars[chars.length - 1] ?? "";
  const before = chars[chars.length - 2] ?? " ";
  const first = Array.from(next.text)[0] ?? "";
  if (BREAKS_AFTER.test(last)) return "";
  if (DASH.test(last)) return /\s/u.test(before) ? " " : "";
  if (NO_SPACE_SCRIPT.test(last) || NO_SPACE_SCRIPT.test(first)) return "";
  return " ";
}

/**
 * The text of a block as the engine sets it back: a line its writer ended ends with a line feed,
 * which the engine keeps as a hard break; lines that wrapped run on, so the engine sets them
 * again to the block's width.
 */
export function blockText(text: PageText, block: number): string {
  const lines = text.lines.filter((line) => line.block === block);
  return lines
    .map((line, i) => {
      const next = lines[i + 1];
      return next ? line.text + lineEnd(line, next) : line.text;
    })
    .join("");
}

const area = (r: Rect): number => (r[2] - r[0]) * (r[3] - r[1]);

/** The block under a point of the page (fractions); the smaller one where two lie over it. */
export function blockAt(text: PageText, x: number, y: number): PdfTextBlock | undefined {
  let found: PdfTextBlock | undefined;
  for (const block of text.blocks) {
    const [left, top, right, bottom] = block.rect;
    if (x < left || x > right || y < top || y > bottom) continue;
    if (!found || area(block.rect) < area(found.rect)) found = block;
  }
  return found;
}

const REFUSALS: Readonly<Record<string, string>> = {
  NoGlyphs:
    "This text holds no letters, only the spaces between them, so there is nothing to edit.",
  NoSize:
    "This text has no size (a font size of 0), so none of it is drawn and there is no text on the page to change.",
  NotOnPage:
    "This text is no longer on the page as it was read, so it cannot be edited. Choose it again.",
  Type3Font:
    "This text is drawn as shapes (a Type 3 font, whose letters are small drawings) and not as letters Kern can change, so it cannot be edited here.",
  ClippingRenderMode:
    "This text also shapes a clip for what is drawn after it, so taking it out would change how the rest of the page looks.",
  SplitAcrossStreams:
    "This text is stored in more than one part of the page's content, which Kern does not edit.",
  StraddlesStreams:
    "One instruction that draws this text begins in one part of the page's content and ends in another, which Kern does not edit.",
  VerticalWriting:
    "This text is written vertically, and Kern sets new text along the line, so a vertical block cannot be edited.",
  UnterminatedTextObject:
    "This text is not closed before the page's content ends, so there is no place after it for new text.",
  StateChangedBeforeEnd:
    "The page's drawing settings (transparency, overprint, line style or clipping) change inside this text, so new text put after it would not look like it did.",
  TaggedFormContent:
    "This text is part of a form that the document's structure tree names, and an edited copy of the form would not be named by it.",
};

/** Why a block cannot be edited, in plain words, from the engine's name for the reason. */
export function refusalText(reason: string | undefined): string {
  if (reason === undefined) return "This text cannot be edited.";
  return REFUSALS[reason] ?? `This text cannot be edited (${reason}).`;
}

const CODE_POINT = /U\+[0-9A-F]{4,6}/;

/** What a refused edit says to the user. The engine's kinds that name a character say which. */
export function failureText(e: WireError): string {
  const character = CODE_POINT.exec(e.message)?.[0];
  if (e.kind === "NoGlyphForCharacter" && character) {
    return `No font Kern can use has a glyph for ${character}, so the text was not changed. Take that character out, or leave the block as it is.`;
  }
  if (e.kind === "MirroredGlyphNotSet" && character) {
    return `${character} is drawn mirrored in right-to-left text and has no exact mirror image to set, so the text was not changed. Take that character out.`;
  }
  return errorText(e);
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) <= SAME_RECT_TOLERANCE);

/** The block of `target` in a page read again, when the page still has that block, else null. */
function sameBlock(fresh: PageText, target: BlockTarget): BlockTarget | null {
  const block = fresh.blocks.find((b) => b.id === target.block);
  if (!block || !sameRect(block.rect, target.rect)) return null;
  if (blockText(fresh, block.id) !== target.original) return null;
  return { ...target, revision: fresh.revision };
}

const failed = (outcome: Extract<ApplyOutcome, { status: "failed" | "refused" }>): BlockResult => ({
  status: "failed",
  message: outcome.status === "failed" ? failureText(outcome.error) : outcome.message,
});

/**
 * Sets the text of a block. A block read at an older revision than the document is at is refused
 * as stale; the page is read again with `reread`, and when it still has that block, with the same
 * text, the change is asked once more at the new revision. A block that moved or changed is not
 * edited, since the text typed was meant for another one.
 */
export async function submitBlockEdit(
  doc: PdfDoc,
  target: BlockTarget,
  text: string,
  reread: () => Promise<PageText>,
  box: BlockBoxChange = {}
): Promise<BlockResult> {
  const ask = (at: BlockTarget) =>
    doc.applyChecked(editBlockOp(at.page, at.block, at.revision, text, box));
  let outcome = await ask(target);
  if (outcome.status === "failed" && outcome.error.kind === "StaleBlock") {
    let fresh: BlockTarget | null;
    try {
      fresh = sameBlock(await reread(), target);
    } catch (e) {
      return {
        status: "failed",
        message: `The page could not be read again: ${errorText(toWireError(e))}`,
      };
    }
    if (!fresh) {
      return {
        status: "failed",
        message:
          "The page changed since this text was chosen, so it was not edited. Choose it again.",
      };
    }
    outcome = await ask(fresh);
  }
  if (outcome.status === "applied") return { status: "done" };
  if (outcome.status === "declined") return { status: "declined" };
  return failed(outcome);
}
