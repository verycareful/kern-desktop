// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { PdfPageText, Rect } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn(), clipText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { dropPageText } from "./page-text";
import { usePdfSelection } from "./pdf-selection";
import { copySelection, searchSelection, selectAllOnPage } from "./selection-actions";
import { SelectionMenu } from "./SelectionMenu";
import { testDoc } from "./test-doc";

const TAB = "tab-1";
const HANDLE = 3;
const glyphs = (text: string, y: number): Rect[] =>
  Array.from(text).map((_, i) => [0.1 + i * 0.02, y, 0.12 + i * 0.02, y + 0.02]);
const wire: PdfPageText = {
  revision: 1,
  lines: [
    {
      block: 0,
      text: "hello there",
      rect: [0.1, 0.1, 0.32, 0.12],
      glyphs: glyphs("hello there", 0.1),
    },
    { block: 0, text: "second", rect: [0.1, 0.2, 0.22, 0.22], glyphs: glyphs("second", 0.2) },
  ],
  blocks: [],
  tagged: false,
};
const doc = testDoc({ handle: HANDLE, pages: 3 });

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(HANDLE);
  usePdfSelection.setState({ byTab: {}, searches: {} });
  useOps.setState({ notice: null } as never);
  ipc.pdfText.mockResolvedValue(wire);
  ipc.clipText.mockResolvedValue(undefined);
});

const select = (from: number, to: number) =>
  act(() =>
    usePdfSelection.getState().select(TAB, {
      page: 1,
      from: { line: 0, unit: from },
      to: { line: 0, unit: to },
    })
  );

test("the_menu_has_a_button_for_each_thing_to_do_with_the_text", () => {
  const onCopy = vi.fn();
  const onSearch = vi.fn();
  render(<SelectionMenu at={{ left: 0.5, top: 0.25 }} onCopy={onCopy} onSearch={onSearch} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Search for it" }));
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(onSearch).toHaveBeenCalledTimes(1);
});

test("copy_puts_the_text_on_the_clipboard", async () => {
  select(0, 4);
  await copySelection(TAB, doc);
  expect(ipc.pdfText).toHaveBeenCalledWith(HANDLE, 1);
  expect(ipc.clipText).toHaveBeenCalledWith("hello");
});

test("copy_across_lines_keeps_the_line_breaks", async () => {
  act(() =>
    usePdfSelection.getState().select(TAB, {
      page: 1,
      from: { line: 0, unit: 6 },
      to: { line: 1, unit: 2 },
    })
  );
  await copySelection(TAB, doc);
  expect(ipc.clipText).toHaveBeenCalledWith("there\nsec");
});

test("a_failed_copy_is_said_and_a_missing_selection_copies_nothing", async () => {
  await copySelection(TAB, doc);
  expect(ipc.clipText).not.toHaveBeenCalled();
  select(0, 4);
  ipc.clipText.mockRejectedValue({ kind: "Other", message: "no clipboard" });
  const notify = vi.spyOn(useOps.getState(), "notify");
  await copySelection(TAB, doc);
  expect(notify).toHaveBeenCalledWith("The text could not be copied: Other: no clipboard");
});

test("search_opens_find_with_the_selected_text", async () => {
  select(0, 4);
  await searchSelection(TAB, doc);
  expect(usePdfSelection.getState().searches[TAB]).toEqual({ text: "hello", seq: 1 });
  await searchSelection(TAB, doc);
  expect(usePdfSelection.getState().searches[TAB]?.seq).toBe(2);
});

test("select_all_selects_the_whole_page_and_a_page_without_text_says_so", async () => {
  await selectAllOnPage(TAB, doc, 1);
  expect(usePdfSelection.getState().byTab[TAB]).toEqual({
    page: 1,
    from: { line: 0, unit: 0 },
    to: { line: 1, unit: 5 },
  });
  await copySelection(TAB, doc);
  expect(ipc.clipText).toHaveBeenCalledWith("hello there\nsecond");

  usePdfSelection.setState({ byTab: {} });
  ipc.pdfText.mockResolvedValue({ ...wire, lines: [] });
  const notify = vi.spyOn(useOps.getState(), "notify");
  await selectAllOnPage(TAB, doc, 2);
  expect(usePdfSelection.getState().byTab[TAB]).toBeUndefined();
  expect(notify).toHaveBeenCalledWith("Page 3 has no text to select");
});
