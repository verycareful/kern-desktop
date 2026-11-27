// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  EVENT_DOC_MOVED,
  EVENT_DOC_RELEASED,
  type WireError,
  type WirePath,
  type WirePdfOpened,
} from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfOpen: vi.fn(),
  pdfClose: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  on: vi.fn(),
  textCheck: vi.fn(),
  entryOf: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("./system-fonts", () => ({ ensureSystemFonts: () => Promise.resolve() }));

import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import { usePdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");
const MOVED = p("/home/a/novel.pdf");
const HERE = { kind: "tab", window: "main", tab_id: "t1" };

const opened = (over: Partial<WirePdfOpened> = {}): WirePdfOpened => ({
  handle: 11,
  pages: 3,
  revision: 0,
  stamp: "s1:opened",
  ...over,
});
const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

let handlers: Record<string, (payload: unknown) => void>;
const emit = (name: string, payload?: unknown) => act(async () => handlers[name]?.(payload));

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
  ipc.pdfOpen.mockResolvedValue(opened());
  ipc.pdfClose.mockResolvedValue(undefined);
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.textCheck.mockResolvedValue("same");
  ipc.entryOf.mockResolvedValue({ kind: "file", len: 10, modified_ms: 1000 });
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.on.mockImplementation(async (name: string, handler: (payload: unknown) => void) => {
    handlers[name] = handler;
    return () => {
      delete handlers[name];
    };
  });
});

const mount = (path = FILE, opts = {}) =>
  renderHook(({ path }) => usePdfDoc("t1", path, opts), { initialProps: { path } });

test("opens_and_closes_the_handle_on_unmount", async () => {
  const { result, unmount } = mount();
  expect(result.current.phase).toBe("opening");
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(ipc.pdfOpen).toHaveBeenCalledWith(FILE, undefined);
  expect(result.current).toMatchObject({
    handle: 11,
    pages: 3,
    revision: 0,
    stamp: "s1:opened",
    readOnly: null,
  });
  expect(ipc.pdfClose).not.toHaveBeenCalled();
  unmount();
  expect(ipc.pdfClose).toHaveBeenCalledTimes(1);
  expect(ipc.pdfClose).toHaveBeenCalledWith(11);
});

test("a_WrongPassword_error_asks_again_and_leaks_no_handle", async () => {
  ipc.pdfOpen.mockImplementation(async (_path: WirePath, password?: string) => {
    if (password === "right") return opened({ handle: 21 });
    throw wireError("WrongPassword");
  });
  const { result, unmount } = mount();
  await waitFor(() => expect(result.current.phase).toBe("needs-password"));
  // The first ask names no failure.
  expect(result.current.error).toBeUndefined();

  await act(() => result.current.open("wrong"));
  expect(result.current.phase).toBe("needs-password");
  expect(result.current.error?.kind).toBe("WrongPassword");
  expect(ipc.pdfOpen).toHaveBeenLastCalledWith(FILE, "wrong");

  await act(() => result.current.open("right"));
  expect(result.current.phase).toBe("ready");
  expect(result.current.error).toBeUndefined();
  expect(result.current.handle).toBe(21);

  // A refused password opened nothing, so the one document is the only one to close.
  expect(ipc.pdfClose).not.toHaveBeenCalled();
  unmount();
  expect(ipc.pdfClose).toHaveBeenCalledTimes(1);
  expect(ipc.pdfClose).toHaveBeenCalledWith(21);
});

test("a_cancelled_password_settles_the_tab_as_failed", async () => {
  ipc.pdfOpen.mockRejectedValue(wireError("WrongPassword"));
  const { result, unmount } = mount();
  await waitFor(() => expect(result.current.phase).toBe("needs-password"));
  act(() => result.current.cancelPassword());
  expect(result.current.phase).toBe("failed");
  expect(result.current.error?.kind).toBe("NoPassword");
  expect(result.current.error?.message).toContain("book.pdf");
  unmount();
  expect(ipc.pdfClose).not.toHaveBeenCalled();
});

test("a_corrupt_file_fails_with_the_error_text", async () => {
  ipc.pdfOpen.mockRejectedValue(wireError("Invalid", "the cross-reference table is damaged"));
  const { result, unmount } = mount();
  await waitFor(() => expect(result.current.phase).toBe("failed"));
  expect(result.current.error).toMatchObject({
    kind: "Invalid",
    message: "the cross-reference table is damaged",
  });
  expect(result.current.handle).toBeUndefined();
  unmount();
  expect(ipc.pdfClose).not.toHaveBeenCalled();
});

test("a_file_with_zero_pages_is_ready_with_no_pages", async () => {
  ipc.pdfOpen.mockResolvedValue(opened({ pages: 0 }));
  const { result } = mount();
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(result.current.pages).toBe(0);
});

test("an_open_that_answers_after_the_tab_went_closes_its_document", async () => {
  let answer!: (o: WirePdfOpened) => void;
  ipc.pdfOpen.mockReturnValue(new Promise<WirePdfOpened>((r) => (answer = r)));
  const { unmount } = mount();
  unmount();
  await act(async () => answer(opened({ handle: 31 })));
  expect(ipc.pdfClose).toHaveBeenCalledTimes(1);
  expect(ipc.pdfClose).toHaveBeenCalledWith(31);
});

test("StrictMode_opens_twice_and_closes_the_document_the_first_open_made", async () => {
  let handle = 40;
  ipc.pdfOpen.mockImplementation(async () => opened({ handle: ++handle }));
  const { result, unmount } = renderHook(() => usePdfDoc("t1", FILE), { wrapper: StrictMode });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  expect(ipc.pdfOpen).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(ipc.pdfClose).toHaveBeenCalledTimes(1));
  // The one still open is the second.
  expect(result.current.handle).toBe(42);
  expect(ipc.pdfClose).toHaveBeenCalledWith(41);
  unmount();
  expect(ipc.pdfClose).toHaveBeenCalledWith(42);
});

test("a_close_that_fails_is_said", async () => {
  ipc.pdfClose.mockRejectedValue(wireError("UnknownHandle", "no such document"));
  const { result, unmount } = mount();
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  unmount();
  await waitFor(() => expect(useOps.getState().notice).not.toBeNull());
});

test("the_document_is_registered_as_open_here_and_released_with_the_tab", async () => {
  const { result, unmount } = mount();
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await waitFor(() => expect(ipc.docOpened).toHaveBeenCalledWith(FILE, HERE));
  expect(ipc.docOpened).toHaveBeenCalledTimes(1);
  unmount();
  await waitFor(() => expect(ipc.docClosed).toHaveBeenCalledWith(FILE, HERE, true));
});

test("a_document_registered_by_the_caller_is_not_registered_again", async () => {
  const { result } = mount(FILE, { registered: true });
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await Promise.resolve();
  expect(ipc.docOpened).not.toHaveBeenCalled();
});

test("a_file_open_elsewhere_is_shown_read_only_until_the_other_place_lets_go", async () => {
  // The first try is refused, and so is the one made as the listener starts (the other place may
  // have let go before it listened); the third, after a release, is taken.
  ipc.docOpened
    .mockRejectedValueOnce(wireError("AlreadyOpen", "open in editor-2"))
    .mockRejectedValueOnce(wireError("AlreadyOpen", "open in editor-2"));
  const onRegistered = vi.fn();
  const { result } = mount(FILE, { onRegistered });
  await waitFor(() => expect(result.current.readOnly).not.toBeNull());
  expect(result.current.readOnly).toEqual({ kind: "OpenElsewhere", detail: "open in editor-2" });
  expect(result.current.phase).toBe("ready");
  expect(onRegistered).toHaveBeenCalledWith(false);

  await waitFor(() => expect(handlers[EVENT_DOC_RELEASED]).toBeDefined());
  await emit(EVENT_DOC_RELEASED);
  await waitFor(() => expect(result.current.readOnly).toBeNull());
  expect(onRegistered).toHaveBeenLastCalledWith(true);
});

test("a_rename_gives_the_tab_the_new_path_and_keeps_the_open_document", async () => {
  // The file is not looked at under its new name here (usePdfDoc.save.test.ts does that): the stamp
  // stays, so the document is not read again.
  ipc.entryOf.mockRejectedValue(new Error("not looked at"));
  const { result, rerender } = mount();
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await waitFor(() => expect(handlers[EVENT_DOC_MOVED]).toBeDefined());

  await emit(EVENT_DOC_MOVED, { from: FILE, to: MOVED });
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: MOVED });
  rerender({ path: MOVED });

  expect(result.current.phase).toBe("ready");
  expect(ipc.pdfOpen).toHaveBeenCalledTimes(1);
  expect(ipc.pdfClose).not.toHaveBeenCalled();
});

test("a_move_of_another_file_is_ignored", async () => {
  const { result } = mount();
  await waitFor(() => expect(result.current.phase).toBe("ready"));
  await waitFor(() => expect(handlers[EVENT_DOC_MOVED]).toBeDefined());
  await emit(EVENT_DOC_MOVED, { from: p("/home/a/other.pdf"), to: MOVED });
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: FILE });
});
