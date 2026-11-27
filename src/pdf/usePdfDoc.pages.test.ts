// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfEditAnswer, WirePath, WirePdfOpened } from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfOpen: vi.fn(),
  pdfClose: vi.fn(),
  pdfApply: vi.fn(),
  pdfUndo: vi.fn(),
  pdfRedo: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  on: vi.fn(),
  textCheck: vi.fn(),
  entryOf: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  recentTouch: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("./system-fonts", () => ({ ensureSystemFonts: () => Promise.resolve() }));

import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { thumbCache } from "./thumb-cache";
import { usePdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");
const HANDLE = 11;

const opened = (over: Partial<WirePdfOpened> = {}): WirePdfOpened => ({
  handle: HANDLE,
  pages: 3,
  revision: 0,
  stamp: "s1:opened",
  ...over,
});

/** The engine's answer to the step that made `revision`. */
const answer = (over: Partial<PdfEditAnswer> = {}): PdfEditAnswer => ({
  revision: 1,
  pages: 3,
  changed_pages: [1],
  can_undo: true,
  can_redo: false,
  modified: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
  thumbCache.dropDocument(HANDLE);
  ipc.recentTouch.mockResolvedValue({ entries: [] });
  ipc.pdfOpen.mockResolvedValue(opened());
  ipc.pdfClose.mockResolvedValue(undefined);
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.textCheck.mockResolvedValue("same");
  ipc.entryOf.mockResolvedValue({ kind: "file", len: 10, modified_ms: 1000 });
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.on.mockImplementation(async () => () => undefined);
});

afterEach(() => vi.useRealTimers());

// The first change of an open session asks whether to keep a copy; the tests of the edits answer
// that once, so each can go on to its change (the question itself is tested in usePdfDoc.save.test.ts).
const ready = async (opts = {}) => {
  const view = renderHook(() => usePdfDoc("t1", FILE, opts));
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  if (view.result.current.canEdit) {
    let go!: Promise<boolean>;
    act(() => {
      go = view.result.current.beforeFirstEdit();
    });
    await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
    await act(() => view.result.current.answerCopyFirst("without"));
    await expect(go).resolves.toBe(true);
  }
  return view;
};

const notice = () => useOps.getState().notice?.text;

test("reorder_pages_asks_for_the_whole_order_and_marks_every_page_changed", async () => {
  ipc.pdfOpen.mockResolvedValue(opened({ pages: 4 }));
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer({ pages: 4, changed_pages: [0, 1, 2, 3] }));
  await act(() => result.current.reorderPages(0, 2));
  expect(ipc.pdfApply).toHaveBeenCalledWith(HANDLE, { op: "reorder", order: [1, 2, 0, 3] });
  expect(result.current).toMatchObject({ modified: true, changedPages: [0, 1, 2, 3] });
  expect(result.current.pageRevisions).toEqual([1, 1, 1, 1]);
});

test("reorder_to_the_same_place_asks_the_engine_nothing", async () => {
  const { result } = await ready();
  await act(() => result.current.reorderPages(1, 1));
  await act(() => result.current.reorderPages(1, 9));
  expect(ipc.pdfApply).not.toHaveBeenCalled();
});

test("remove_pages_then_undo_gives_the_pages_back_and_draws_every_page_again", async () => {
  ipc.pdfOpen.mockResolvedValue(opened({ pages: 4 }));
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer({ pages: 3, changed_pages: [0, 1, 2] }));
  await act(() => result.current.removePages([1]));
  expect(ipc.pdfApply).toHaveBeenCalledWith(HANDLE, { op: "remove", pages: [1] });
  expect(result.current.pages).toBe(3);
  expect(result.current.pageRevisions).toEqual([1, 1, 1]);
  ipc.pdfUndo.mockResolvedValue(
    answer({
      revision: 2,
      pages: 4,
      changed_pages: [0, 1, 2, 3],
      can_undo: false,
      can_redo: true,
      modified: false,
    })
  );
  await act(() => result.current.undo());
  expect(result.current).toMatchObject({ pages: 4, modified: false, canRedo: true });
  expect(result.current.pageRevisions).toEqual([2, 2, 2, 2]);
  expect(result.current.changedPages).toEqual([0, 1, 2, 3]);
});

test("removing_every_page_is_refused_with_the_reason_and_the_engine_is_not_asked", async () => {
  const { result } = await ready();
  await act(() => result.current.removePages([0, 1, 2]));
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(notice()).toBe("A PDF keeps at least one page. Choose fewer pages.");
  expect(result.current.modified).toBe(false);
});

test("remove_with_no_pages_says_so", async () => {
  const { result } = await ready();
  await act(() => result.current.removePages([]));
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(notice()).toBe("Choose the pages to remove first.");
});

test("rotate_pages_sends_the_chosen_pages_and_never_an_empty_list", async () => {
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer({ changed_pages: [0, 2] }));
  await act(() => result.current.rotatePages([0, 2], 270));
  expect(ipc.pdfApply).toHaveBeenCalledWith(HANDLE, { op: "rotate", pages: [0, 2], degrees: 270 });
  ipc.pdfApply.mockClear();
  // The engine reads an empty list as every page.
  await act(() => result.current.rotatePages([], 90));
  expect(ipc.pdfApply).not.toHaveBeenCalled();
});
