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
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("./system-fonts", () => ({ ensureSystemFonts: () => Promise.resolve() }));

import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { pdfDate } from "./pdf-date";
import { thumbCache, thumbKey } from "./thumb-cache";
import { usePdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");
const HANDLE = 11;
const PIXELS = { width: 1, height: 1, bytes: new Uint8Array(4) };

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

const tabDirty = () => {
  const tab = useTabs.getState().tabs.find((t) => t.id === "t1");
  return tab?.kind === "doc" ? tab.dirty : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
  thumbCache.dropDocument(HANDLE);
  ipc.pdfOpen.mockResolvedValue(opened());
  ipc.pdfClose.mockResolvedValue(undefined);
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.on.mockImplementation(async () => () => undefined);
});

afterEach(() => vi.useRealTimers());

const ready = async (opts = {}) => {
  const view = renderHook(() => usePdfDoc("t1", FILE, opts));
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  return view;
};

test("apply_rotate_marks_the_tab_dirty_and_reports_changed_pages", async () => {
  const { result } = await ready();
  expect(result.current).toMatchObject({ modified: false, canUndo: false, canRedo: false });
  ipc.pdfApply.mockResolvedValue(answer());
  await act(() => result.current.apply({ op: "rotate", pages: [1], degrees: 90 }));
  expect(ipc.pdfApply).toHaveBeenCalledWith(HANDLE, { op: "rotate", pages: [1], degrees: 90 });
  expect(result.current).toMatchObject({
    revision: 1,
    modified: true,
    canUndo: true,
    canRedo: false,
    changedPages: [1],
  });
  expect(tabDirty()).toBe(true);
});

test("undo_to_the_open_state_clears_dirty", async () => {
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer());
  await act(() => result.current.apply({ op: "rotate", pages: [1], degrees: 90 }));
  expect(tabDirty()).toBe(true);
  ipc.pdfUndo.mockResolvedValue(
    answer({ revision: 2, can_undo: false, can_redo: true, modified: false })
  );
  await act(() => result.current.undo());
  expect(ipc.pdfUndo).toHaveBeenCalledWith(HANDLE);
  expect(result.current).toMatchObject({ modified: false, canUndo: false, canRedo: true });
  expect(tabDirty()).toBe(false);
});

test("redo_after_undo_restores_the_edit", async () => {
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer());
  ipc.pdfUndo.mockResolvedValue(
    answer({ revision: 2, can_undo: false, can_redo: true, modified: false })
  );
  ipc.pdfRedo.mockResolvedValue(answer({ revision: 3, can_undo: true, can_redo: false }));
  await act(() => result.current.apply({ op: "rotate", pages: [1], degrees: 90 }));
  await act(() => result.current.undo());
  await act(() => result.current.redo());
  expect(ipc.pdfRedo).toHaveBeenCalledWith(HANDLE);
  expect(result.current).toMatchObject({
    revision: 3,
    modified: true,
    canUndo: true,
    canRedo: false,
  });
  expect(tabDirty()).toBe(true);
});

test("a_refused_op_leaves_the_state_and_raises_the_error", async () => {
  const { result } = await ready();
  ipc.pdfApply.mockRejectedValue({
    kind: "BadRequest",
    message: "a rotation is 90, 180 or 270 degrees, not 45",
    path: null,
    details: null,
  });
  // It never rejects: the caller has the error told to the user.
  await act(() => result.current.apply({ op: "rotate", pages: [1], degrees: 90 }));
  expect(result.current).toMatchObject({ revision: 0, modified: false, canUndo: false });
  expect(tabDirty()).toBe(false);
  expect(useOps.getState().notice?.text).toMatch(/The change did not apply to book\.pdf: .*not 45/);
});

test("the_page_re-renders_after_an_edit_and_its_thumbnail_is_dropped", async () => {
  const { result } = await ready();
  expect(result.current.pageRevisions).toEqual([0, 0, 0]);
  thumbCache.set(thumbKey(HANDLE, 0, 1, 120), PIXELS);
  thumbCache.set(thumbKey(HANDLE, 0, 2, 120), PIXELS);
  ipc.pdfApply.mockResolvedValue(answer({ changed_pages: [1] }));
  await act(() => result.current.apply({ op: "rotate", pages: [1], degrees: 90 }));
  // Page 1 has a revision of its own and so a new key; the others keep theirs and their pictures.
  expect(result.current.pageRevisions).toEqual([0, 1, 0]);
  expect(thumbCache.get(thumbKey(HANDLE, 0, 1, 120))).toBeUndefined();
  expect(thumbCache.get(thumbKey(HANDLE, 0, 2, 120))).toBeDefined();
});

test("apply_stamps_the_op_with_the_pdf_date_of_now", async () => {
  const now = new Date(2026, 10, 26, 1, 3, 9);
  vi.useFakeTimers({ toFake: ["Date"], now });
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer());
  await act(() =>
    result.current.apply({ op: "addNote", page: 0, at: [0.5, 0.5], text: "hi", colour: [1, 1, 0] })
  );
  const sent = ipc.pdfApply.mock.calls[0]?.[1];
  expect(sent).toMatchObject({ op: "addNote", text: "hi", modified: pdfDate(now) });
  expect(sent.modified).toMatch(/^D:20261126010309[+-]\d\d'\d\d'$/);
});

test("an_op_that_takes_no_date_is_sent_without_one", async () => {
  const { result } = await ready();
  ipc.pdfApply.mockResolvedValue(answer());
  await act(() => result.current.apply({ op: "rotate", pages: [0], degrees: 270 }));
  expect(ipc.pdfApply.mock.calls[0]?.[1]).toEqual({ op: "rotate", pages: [0], degrees: 270 });
});

test("changes_run_one_at_a_time_in_the_order_asked", async () => {
  const { result } = await ready();
  const order: string[] = [];
  let finishFirst!: (a: PdfEditAnswer) => void;
  ipc.pdfApply.mockImplementationOnce(() => {
    order.push("first starts");
    return new Promise<PdfEditAnswer>((r) => (finishFirst = r));
  });
  ipc.pdfApply.mockImplementationOnce(async () => {
    order.push("second starts");
    return answer({ revision: 2, changed_pages: [0] });
  });
  let both!: Promise<unknown>;
  act(() => {
    both = Promise.all([
      result.current.apply({ op: "rotate", pages: [1], degrees: 90 }),
      result.current.apply({ op: "rotate", pages: [0], degrees: 90 }),
    ]);
  });
  await waitFor(() => expect(order).toEqual(["first starts"]));
  expect(result.current.busy()).toBe(true);
  await act(async () => finishFirst(answer({ revision: 1 })));
  await act(async () => void (await both));
  expect(order).toEqual(["first starts", "second starts"]);
  expect(result.current.revision).toBe(2);
  expect(result.current.busy()).toBe(false);
});

test("an_undo_with_nothing_to_undo_changes_nothing", async () => {
  const { result } = await ready();
  // The engine answers the state it is in: the revision has not moved.
  ipc.pdfUndo.mockResolvedValue(
    answer({ revision: 0, changed_pages: [], can_undo: false, modified: false })
  );
  const before = result.current;
  await act(() => result.current.undo());
  expect(result.current.revision).toBe(0);
  expect(result.current.pageRevisions).toBe(before.pageRevisions);
  expect(useOps.getState().notice).toBeNull();
});

test("an_answer_that_arrives_after_the_tab_closed_changes_nothing_and_says_nothing", async () => {
  const { result, unmount } = await ready();
  let finish!: (a: PdfEditAnswer) => void;
  ipc.pdfApply.mockImplementation(() => new Promise<PdfEditAnswer>((r) => (finish = r)));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.apply({ op: "rotate", pages: [1], degrees: 90 });
  });
  await waitFor(() => expect(ipc.pdfApply).toHaveBeenCalled());
  unmount();
  await act(async () => {
    finish(answer());
    await pending;
  });
  expect(useOps.getState().notice).toBeNull();
  expect(ipc.pdfClose).toHaveBeenCalledWith(HANDLE);
});

test("an_error_that_arrives_after_the_tab_closed_says_nothing", async () => {
  const { result, unmount } = await ready();
  let fail!: (e: unknown) => void;
  ipc.pdfApply.mockImplementation(() => new Promise((_, r) => (fail = r)));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.apply({ op: "rotate", pages: [1], degrees: 90 });
  });
  await waitFor(() => expect(ipc.pdfApply).toHaveBeenCalled());
  unmount();
  await act(async () => {
    fail({ kind: "Io", message: "closed", path: null, details: null });
    await pending;
  });
  expect(useOps.getState().notice).toBeNull();
});

test("a_document_open_in_another_place_takes_no_change_and_says_so", async () => {
  ipc.docOpened.mockRejectedValue({
    kind: "AlreadyOpen",
    message: "open in editor-2",
    path: null,
    details: null,
  });
  const view = renderHook(() => usePdfDoc("t1", FILE));
  await waitFor(() => expect(view.result.current.readOnly).not.toBeNull());
  expect(view.result.current.canEdit).toBe(false);
  await act(() => view.result.current.apply({ op: "rotate", pages: [0], degrees: 90 }));
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(useOps.getState().notice?.text).toBe(
    "The change was not made: book.pdf is open in another place and cannot be changed here."
  );
});

test("a_document_that_is_not_open_takes_no_change_and_says_so", async () => {
  ipc.pdfOpen.mockRejectedValue({ kind: "NotFound", message: "gone", path: null, details: null });
  const view = renderHook(() => usePdfDoc("t1", FILE));
  await waitFor(() => expect(view.result.current.phase).toBe("failed"));
  expect(view.result.current.canEdit).toBe(false);
  await act(() => view.result.current.apply({ op: "rotate", pages: [0], degrees: 90 }));
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(useOps.getState().notice?.text).toBe("The change was not made: book.pdf is not open.");
});

test("a_change_queued_behind_another_when_the_tab_closes_is_dropped_without_a_notice", async () => {
  const { result, unmount } = await ready();
  let finish!: (a: PdfEditAnswer) => void;
  ipc.pdfApply.mockImplementationOnce(() => new Promise<PdfEditAnswer>((r) => (finish = r)));
  let both!: Promise<unknown>;
  act(() => {
    both = Promise.all([
      result.current.apply({ op: "rotate", pages: [1], degrees: 90 }),
      result.current.apply({ op: "rotate", pages: [0], degrees: 90 }),
    ]);
  });
  await waitFor(() => expect(ipc.pdfApply).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => {
    finish(answer());
    await both;
  });
  // The second change was never sent, and nothing is said of a document the user closed.
  expect(ipc.pdfApply).toHaveBeenCalledTimes(1);
  expect(useOps.getState().notice).toBeNull();
});
