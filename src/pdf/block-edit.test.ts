// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it, vi } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";
import {
  blockAt,
  blockText,
  editBlockOp,
  failureText,
  refusalText,
  submitBlockEdit,
  type BlockTarget,
} from "./block-edit";
import type { PdfDoc } from "./usePdfDoc";
import type { ApplyOutcome } from "./edit-state";
import { pageText } from "./text-lines";

const rect = (top: number): Rect => [0.1, top, 0.6, top + 0.05];
const glyphs = (text: string, top: number): Rect[] =>
  Array.from(text).map((_, i) => [0.1 + i * 0.01, top, 0.11 + i * 0.01, top + 0.05]);

/** A page of two blocks: a paragraph of two lines and a heading that cannot be edited. */
const wire = (revision: number, over: Partial<PdfPageText> = {}): PdfPageText => ({
  revision,
  tagged: false,
  lines: [
    { block: 0, text: "first line", rect: rect(0.1), glyphs: glyphs("first line", 0.1) },
    { block: 0, text: "second line", rect: rect(0.16), glyphs: glyphs("second line", 0.16) },
    { block: 1, text: "Title", rect: rect(0.5), glyphs: glyphs("Title", 0.5) },
  ],
  blocks: [
    { id: 0, rect: [0.1, 0.1, 0.6, 0.21], editable: true },
    { id: 1, rect: [0.1, 0.5, 0.6, 0.55], editable: false, reason: "Type3Font" },
  ],
  ...over,
});

const target = (over: Partial<BlockTarget> = {}): BlockTarget => ({
  page: 2,
  block: 0,
  revision: 5,
  original: "first line\nsecond line",
  rect: [0.1, 0.1, 0.6, 0.21],
  ...over,
});

const doc = (apply: (op: unknown) => Promise<ApplyOutcome>): PdfDoc =>
  ({ applyChecked: vi.fn(apply) }) as unknown as PdfDoc;

describe("editBlockOp", () => {
  it("an_edit_carries_the_revision_the_block_was_read_at", () => {
    expect(editBlockOp(2, 0, 5, "new words")).toEqual({
      op: "editText",
      page: 2,
      block: 0,
      revision: 5,
      text: "new words",
    });
  });

  it("an_empty_text_removes_the_blocks_text", () => {
    // The engine deletes a block whose new text is empty; the op says so by carrying nothing.
    expect(editBlockOp(0, 1, 3, "")).toMatchObject({ op: "editText", text: "" });
  });
});

describe("blockText", () => {
  it("a_block_reads_as_its_lines_one_to_a_line", () => {
    expect(blockText(pageText(wire(5)), 0)).toBe("first line\nsecond line");
    expect(blockText(pageText(wire(5)), 1)).toBe("Title");
  });

  it("a_block_with_no_line_reads_as_nothing", () => {
    expect(blockText(pageText(wire(5)), 9)).toBe("");
  });
});

describe("blockAt", () => {
  it("the_block_under_a_point_is_found_and_a_point_on_blank_page_has_none", () => {
    const text = pageText(wire(5));
    expect(blockAt(text, 0.3, 0.12)?.id).toBe(0);
    expect(blockAt(text, 0.3, 0.52)?.id).toBe(1);
    expect(blockAt(text, 0.9, 0.9)).toBeUndefined();
  });

  it("the_smaller_block_wins_where_two_overlap", () => {
    const text = pageText(
      wire(5, {
        blocks: [
          { id: 0, rect: [0, 0, 1, 1], editable: true },
          { id: 1, rect: [0.2, 0.2, 0.4, 0.3], editable: true },
        ],
      })
    );
    expect(blockAt(text, 0.3, 0.25)?.id).toBe(1);
  });
});

describe("refusalText", () => {
  it("refusal_text_names_the_reason_for_each_known_code", () => {
    for (const code of [
      "NoGlyphs",
      "NoSize",
      "NotOnPage",
      "Type3Font",
      "ClippingRenderMode",
      "SplitAcrossStreams",
      "StraddlesStreams",
      "VerticalWriting",
      "UnterminatedTextObject",
      "StateChangedBeforeEnd",
      "TaggedFormContent",
    ]) {
      const text = refusalText(code);
      expect(text, code).not.toContain(code);
      expect(text.length, code).toBeGreaterThan(20);
    }
    expect(refusalText("VerticalWriting")).toMatch(/vertical/i);
    expect(refusalText("Type3Font")).toMatch(/Type 3/);
  });

  it("an_unknown_reason_shows_the_engines_own_word", () => {
    expect(refusalText("SomethingNew")).toContain("SomethingNew");
  });

  it("a_block_refused_without_a_reason_still_says_it_cannot_be_edited", () => {
    expect(refusalText(undefined)).toMatch(/cannot be edited/);
  });
});

describe("failureText", () => {
  it("a_character_with_no_glyph_says_which_and_that_the_text_is_kept", () => {
    const text = failureText({
      kind: "NoGlyphForCharacter",
      message: "the font has no glyph for U+4E2D",
      path: null,
      details: null,
    });
    expect(text).toContain("U+4E2D");
    expect(text).toMatch(/no font/i);
  });

  it("a_mirrored_character_with_no_mirror_is_named", () => {
    const text = failureText({
      kind: "MirroredGlyphNotSet",
      message:
        "U+2308 would be drawn mirrored in a right-to-left run and has no exact mirror image to set",
      path: null,
      details: null,
    });
    expect(text).toContain("U+2308");
  });

  it("any_other_error_is_its_kind_and_its_message", () => {
    expect(failureText({ kind: "Cancelled", message: "stopped", path: null, details: null })).toBe(
      "Cancelled: stopped"
    );
  });
});

describe("submitBlockEdit", () => {
  const stale = {
    status: "failed",
    error: { kind: "StaleBlock", message: "read at 5", path: null, details: null },
  } as const;

  it("an_applied_edit_is_done_and_sent_once_with_the_revision_it_was_read_at", async () => {
    const d = doc(async () => ({ status: "applied" }));
    const reread = vi.fn();
    const result = await submitBlockEdit(d, target(), "new", reread);
    expect(result).toEqual({ status: "done" });
    expect(d.applyChecked).toHaveBeenCalledTimes(1);
    expect(d.applyChecked).toHaveBeenCalledWith(editBlockOp(2, 0, 5, "new"));
    expect(reread).not.toHaveBeenCalled();
  });

  it("a_stale_revision_re-reads_the_page_and_asks_again", async () => {
    const d = doc(async (op) =>
      (op as { revision: number }).revision === 5 ? stale : { status: "applied" }
    );
    const reread = vi.fn().mockResolvedValue(pageText(wire(8)));
    const result = await submitBlockEdit(d, target(), "new", reread);
    expect(result).toEqual({ status: "done" });
    expect(reread).toHaveBeenCalledTimes(1);
    expect(d.applyChecked).toHaveBeenCalledTimes(2);
    expect(d.applyChecked).toHaveBeenLastCalledWith(editBlockOp(2, 0, 8, "new"));
  });

  it("a_stale_revision_is_not_asked_again_when_the_block_is_no_longer_what_was_edited", async () => {
    const d = doc(async () => stale);
    const moved = pageText(
      wire(8, { blocks: [{ id: 0, rect: [0.3, 0.7, 0.9, 0.8], editable: true }] })
    );
    const result = await submitBlockEdit(d, target(), "new", vi.fn().mockResolvedValue(moved));
    expect(d.applyChecked).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ message: expect.stringMatching(/changed/) });
  });

  it("a_stale_revision_is_asked_again_once_and_no_more", async () => {
    const d = doc(async () => stale);
    const result = await submitBlockEdit(
      d,
      target(),
      "new",
      vi.fn().mockResolvedValue(pageText(wire(8)))
    );
    expect(d.applyChecked).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("failed");
  });

  it("a_page_that_cannot_be_read_again_fails_with_why", async () => {
    const d = doc(async () => stale);
    const result = await submitBlockEdit(d, target(), "new", () =>
      Promise.reject({ kind: "Pdf", message: "unreadable", path: null, details: null })
    );
    expect(result).toMatchObject({
      status: "failed",
      message: expect.stringContaining("unreadable"),
    });
  });

  it("a_refused_change_keeps_the_engines_error_for_the_box", async () => {
    const d = doc(async () => ({
      status: "failed",
      error: {
        kind: "NoGlyphForCharacter",
        message: "the font has no glyph for U+4E2D",
        path: null,
        details: null,
      },
    }));
    const result = await submitBlockEdit(d, target(), "中", vi.fn());
    expect(result).toMatchObject({ status: "failed", message: expect.stringMatching(/no font/i) });
  });

  it("a_document_that_cannot_be_changed_says_why_in_the_box", async () => {
    const d = doc(async () => ({
      status: "refused",
      message: "book.pdf is open in another place.",
    }));
    expect(await submitBlockEdit(d, target(), "new", vi.fn())).toEqual({
      status: "failed",
      message: "book.pdf is open in another place.",
    });
  });

  it("a_copy_first_question_that_was_cancelled_makes_no_change_and_no_error", async () => {
    const d = doc(async () => ({ status: "declined" }));
    expect(await submitBlockEdit(d, target(), "new", vi.fn())).toEqual({ status: "declined" });
  });
});
