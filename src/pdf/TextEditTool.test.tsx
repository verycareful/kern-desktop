// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi, type Mock } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";
import type { ApplyOutcome } from "./edit-state";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { dropPageText } from "./page-text";
import { testDoc } from "./test-doc";
import { TextEditTool } from "./TextEditTool";
import type { PdfDoc } from "./usePdfDoc";

const HANDLE = 3;
const size = { widthPt: 500, heightPt: 700, rotate: 0 as const };

const glyphs = (text: string, top: number): Rect[] =>
  Array.from(text).map((_, i) => [0.1 + i * 0.01, top, 0.11 + i * 0.01, top + 0.04]);

const wire = (revision: number): PdfPageText => ({
  revision,
  tagged: false,
  lines: [
    {
      block: 0,
      text: "first line",
      rect: [0.1, 0.1, 0.2, 0.14],
      glyphs: glyphs("first line", 0.1),
    },
    {
      block: 0,
      text: "second line",
      rect: [0.1, 0.16, 0.21, 0.2],
      glyphs: glyphs("second line", 0.16),
    },
    { block: 1, text: "Title", rect: [0.1, 0.5, 0.15, 0.54], glyphs: glyphs("Title", 0.5) },
  ],
  blocks: [
    { id: 0, rect: [0.1, 0.1, 0.6, 0.2], editable: true },
    { id: 1, rect: [0.1, 0.5, 0.6, 0.54], editable: false, reason: "Type3Font" },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  ipc.pdfText.mockResolvedValue(wire(5));
});

async function tool(applyChecked?: Mock<PdfDoc["applyChecked"]>) {
  const apply =
    applyChecked ??
    vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({ status: "applied" } as ApplyOutcome);
  const doc = testDoc({ handle: HANDLE, pages: 1, pageRevisions: [0], applyChecked: apply });
  render(<TextEditTool doc={doc} page={0} size={size} cssWidth={1000} />);
  await screen.findByRole("button", { name: /Edit text: first line/ });
  return apply;
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /Edit text: first line/ }));
const box = () => screen.getByRole("textbox", { name: "Text of the block" });

test("a_refused_block_shows_why_and_cannot_be_edited", async () => {
  const apply = await tool();
  fireEvent.click(screen.getByRole("button", { name: /Text that cannot be edited: Title/ }));
  expect(screen.getByRole("dialog", { name: "Text that cannot be edited" })).toHaveTextContent(
    /Type 3 font/
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

test("a_block_opens_with_its_lines_and_enter_sends_one_edit_at_the_revision_it_was_read_at", async () => {
  const apply = await tool();
  open();
  expect(box()).toHaveValue("first line\nsecond line");
  fireEvent.change(box(), { target: { value: "new words" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({
    op: "editText",
    page: 0,
    block: 0,
    revision: 5,
    text: "new words",
  });
});

test("shift_enter_starts_a_line_and_does_not_send", async () => {
  const apply = await tool();
  open();
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  expect(apply).not.toHaveBeenCalled();
  expect(box()).toBeInTheDocument();
});

test("escape_lets_the_box_go_without_a_change", async () => {
  const apply = await tool();
  open();
  fireEvent.change(box(), { target: { value: "new words" } });
  fireEvent.keyDown(box(), { key: "Escape" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

test("text_that_was_not_changed_is_not_sent", async () => {
  const apply = await tool();
  open();
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});

test("emptying_a_block_sends_empty_text_which_takes_the_text_off_the_page", async () => {
  const apply = await tool();
  open();
  fireEvent.change(box(), { target: { value: "" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ op: "editText", text: "" }));
});

test("a_character_with_no_glyph_shows_the_engine_error_and_keeps_the_text", async () => {
  const apply = await tool(
    vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({
      status: "failed",
      error: {
        kind: "NoGlyphForCharacter",
        message: "the font has no glyph for U+4E2D",
        path: null,
        details: null,
      },
    })
  );
  open();
  fireEvent.change(box(), { target: { value: "中" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(/U\+4E2D/);
  expect(box()).toHaveValue("中");
  expect(apply).toHaveBeenCalledTimes(1);
});

test("a_stale_block_reads_the_page_again_from_the_engine_not_from_the_kept_text", async () => {
  const stale = {
    status: "failed",
    error: { kind: "StaleBlock", message: "read at 5", path: null, details: null },
  } as const;
  const apply = await tool(
    vi
      .fn<PdfDoc["applyChecked"]>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce({ status: "applied" })
  );
  ipc.pdfText.mockResolvedValue(wire(9));
  open();
  fireEvent.change(box(), { target: { value: "new words" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  expect(ipc.pdfText).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenLastCalledWith(
    expect.objectContaining({ revision: 9, text: "new words" })
  );
});

test("a_copy_question_that_was_cancelled_keeps_the_box_without_an_error", async () => {
  await tool(vi.fn<PdfDoc["applyChecked"]>().mockResolvedValue({ status: "declined" }));
  open();
  fireEvent.change(box(), { target: { value: "new words" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(box()).toHaveValue("new words"));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a_page_whose_text_cannot_be_read_says_so", async () => {
  ipc.pdfText.mockRejectedValue({ kind: "Pdf", message: "unreadable", path: null, details: null });
  const doc = testDoc({ handle: HANDLE, pages: 1, pageRevisions: [0] });
  render(<TextEditTool doc={doc} page={0} size={size} cssWidth={1000} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(/page 1.*unreadable/);
});
