// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import {
  EVENT_DIR_CHANGED,
  EVENT_DOC_MOVED,
  type PdfEditAnswer,
  type WireEntry,
  type WireError,
  type WirePath,
  type WirePdfOpened,
} from "../ipc";

const ipc = vi.hoisted(() => ({
  pdfOpen: vi.fn(),
  pdfClose: vi.fn(),
  pdfApply: vi.fn(),
  pdfUndo: vi.fn(),
  pdfSave: vi.fn(),
  pdfCompact: vi.fn(),
  pdfCompactFile: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  docOpenElsewhere: vi.fn(),
  recentTouch: vi.fn(),
  on: vi.fn(),
  textCheck: vi.fn(),
  entryOf: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("./system-fonts", () => ({ ensureSystemFonts: () => Promise.resolve() }));
const copy = vi.hoisted(() => ({ copyBeside: vi.fn() }));
vi.mock("./pdf-copy", () => copy);

import { useOps } from "../ops/useOps";
import { useTabs } from "../store/tabs";
import type { PdfOpInput } from "./edit-state";
import { thumbCache } from "./thumb-cache";
import { usePdfDoc } from "./usePdfDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/book.pdf");
const COPY = p("/home/a/book (2).pdf");
const OTHER = p("/home/a/novel.pdf");
const HANDLE = 11;
const ROTATE: PdfOpInput = { op: "rotate", pages: [1], degrees: 90 };
const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});
const opened = (over: Partial<WirePdfOpened> = {}): WirePdfOpened => ({
  handle: HANDLE,
  pages: 3,
  revision: 0,
  stamp: "s1:opened",
  ...over,
});
const answer = (over: Partial<PdfEditAnswer> = {}): PdfEditAnswer => ({
  revision: 1,
  pages: 3,
  changed_pages: [1],
  can_undo: true,
  can_redo: false,
  modified: true,
  ...over,
});
const entry = (over: Partial<WireEntry> = {}): WireEntry => ({
  path: OTHER,
  name: "novel.pdf",
  kind: "file",
  target_is_dir: false,
  len: 10,
  modified_ms: 1000,
  hidden: false,
  mime: "application/pdf",
  mode: 0o644,
  ...over,
});
const tab = () => useTabs.getState().tabs.find((t) => t.id === "t1");
const tabPath = (): WirePath => {
  const t = tab();
  return t?.kind === "doc" ? t.path : FILE;
};

let handlers: Record<string, (payload: unknown) => void>;
/** What the disk is, as `textCheck` finds it: the file as stamped, changed, or gone. */
let disk: "same" | "changed" | "deleted";
const emit = (name: string, payload?: unknown) => act(async () => handlers[name]?.(payload));

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  disk = "same";
  useOps.setState({ notice: null });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" }],
    activeId: "t1",
  });
  thumbCache.dropDocument(HANDLE);
  ipc.pdfOpen.mockResolvedValue(opened());
  ipc.pdfClose.mockResolvedValue(undefined);
  ipc.pdfApply.mockResolvedValue(answer());
  ipc.pdfSave.mockResolvedValue("s2:saved");
  ipc.pdfCompact.mockResolvedValue(undefined);
  ipc.pdfCompactFile.mockResolvedValue(undefined);
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.docOpenElsewhere.mockResolvedValue({ state: "free" });
  ipc.recentTouch.mockResolvedValue(undefined);
  ipc.textCheck.mockImplementation(async () => disk);
  ipc.entryOf.mockResolvedValue(entry());
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  copy.copyBeside.mockResolvedValue(COPY);
  ipc.on.mockImplementation(async (name: string, handler: (payload: unknown) => void) => {
    handlers[name] = handler;
    return () => {
      delete handlers[name];
    };
  });
});

const mount = () => renderHook(() => usePdfDoc("t1", tabPath()));

/** Opens, and answers the question about a copy so the tests can edit. */
const ready = async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  let go!: Promise<boolean>;
  act(() => {
    go = view.result.current.beforeFirstEdit();
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  await act(() => view.result.current.answerCopyFirst("without"));
  await expect(go).resolves.toBe(true);
  return view;
};
const edited = async () => {
  const view = await ready();
  await act(() => view.result.current.apply(ROTATE));
  expect(view.result.current.modified).toBe(true);
  return view;
};

// ---- Save ----

test("save_expects_the_stamp_of_the_open", async () => {
  const { result } = await edited();
  await act(() => result.current.save());
  expect(ipc.pdfSave).toHaveBeenCalledWith(
    HANDLE,
    FILE,
    { kind: "unchanged", stamp: "s1:opened" },
    expect.stringMatching(/^D:\d{14}[+-]\d\d'\d\d'?$/)
  );
  expect(result.current).toMatchObject({ modified: false, stamp: "s2:saved", prompt: null });
  expect(tab()).toMatchObject({ dirty: false });
  expect(useOps.getState().notice?.text).toBe("Saved book.pdf");
});

test("save_expects_the_stamp_of_the_last_save", async () => {
  const { result } = await edited();
  await act(() => result.current.save());
  ipc.pdfSave.mockResolvedValue("s3:saved");
  ipc.pdfApply.mockResolvedValue(answer({ revision: 2 }));
  await act(() => result.current.apply(ROTATE));
  await act(() => result.current.save());
  expect(ipc.pdfSave).toHaveBeenLastCalledWith(
    HANDLE,
    FILE,
    { kind: "unchanged", stamp: "s2:saved" },
    expect.any(String)
  );
});

test("an_undo_after_a_save_makes_the_document_differ_from_its_file_again", async () => {
  const { result } = await edited();
  await act(() => result.current.save());
  expect(result.current.modified).toBe(false);
  ipc.pdfUndo.mockResolvedValue(
    answer({ revision: 2, can_undo: false, can_redo: true, modified: true })
  );
  await act(() => result.current.undo());
  expect(result.current.modified).toBe(true);
  expect(tab()).toMatchObject({ dirty: true });
});

test("nothing_is_written_for_a_document_that_is_unchanged", async () => {
  const { result } = await ready();
  await act(() => result.current.save());
  expect(ipc.pdfSave).not.toHaveBeenCalled();
});

test("a_read_only_document_is_not_saved_in_place", async () => {
  const { result } = await edited();
  ipc.docOpened.mockRejectedValue(wireError("AlreadyOpen"));
  // The registration answered before the edit; the document is held elsewhere from now on.
  const held = renderHook(() => usePdfDoc("t2", FILE));
  useTabs.setState({
    tabs: [
      { id: "t1", kind: "doc", path: FILE, dirty: false, format: "pdf" },
      { id: "t2", kind: "doc", path: FILE, dirty: false, format: "pdf" },
    ],
    activeId: "t1",
  });
  await waitFor(() => expect(held.result.current.readOnly).not.toBeNull());
  await act(() => held.result.current.save());
  expect(ipc.pdfSave).not.toHaveBeenCalled();
  expect(useOps.getState().notice?.text).toMatch(/read-only here\. Use Save As/);
  expect(result.current.readOnly).toBeNull();
});

// ---- the file changed under the app ----

test("an_external_modification_is_not_overwritten_and_the_banner_shows", async () => {
  const { result } = await edited();
  ipc.pdfSave.mockRejectedValue(wireError("ExternalModification"));
  disk = "changed";
  await act(() => result.current.save());
  expect(ipc.pdfSave).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({
    prompt: "external",
    externalChange: "changed",
    modified: true,
    problem: null,
  });
  expect(tab()).toMatchObject({ dirty: true });

  // Overwrite is the user's word, and only then is the file replaced.
  ipc.pdfSave.mockResolvedValue("s2:saved");
  await act(() => result.current.overwrite());
  expect(ipc.pdfSave).toHaveBeenLastCalledWith(
    HANDLE,
    FILE,
    { kind: "anything" },
    expect.any(String)
  );
  disk = "same";
  expect(result.current).toMatchObject({ prompt: null, modified: false });
});

test("a_file_deleted_on_disk_is_created_again_only_while_it_is_still_gone", async () => {
  const { result } = await edited();
  ipc.pdfSave.mockRejectedValue(wireError("ExternalModification"));
  disk = "deleted";
  await act(() => result.current.save());
  expect(result.current).toMatchObject({ prompt: "recreate", externalChange: "gone" });

  ipc.pdfSave.mockResolvedValue("s2:saved");
  await act(() => result.current.overwrite());
  expect(ipc.pdfSave).toHaveBeenLastCalledWith(
    HANDLE,
    FILE,
    { kind: "nothing" },
    expect.any(String)
  );
  expect(result.current.modified).toBe(false);
});

test("a_file_that_came_back_changed_asks_the_external_question_instead_of_creating", async () => {
  const { result } = await edited();
  ipc.pdfSave.mockRejectedValue(wireError("ExternalModification"));
  disk = "deleted";
  await act(() => result.current.save());
  ipc.pdfSave.mockClear();
  disk = "changed";
  await act(() => result.current.overwrite());
  expect(ipc.pdfSave).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ prompt: "external", externalChange: "changed" });
});

test("a_change_in_the_folder_that_changes_the_file_shows_the_banner_and_reload_clears_it", async () => {
  const { result } = await ready();
  await waitFor(() => expect(handlers[EVENT_DIR_CHANGED]).toBeDefined());
  expect(ipc.watchDir).toHaveBeenCalledWith("doc:t1", p("/home/a"));
  disk = "changed";
  await emit(EVENT_DIR_CHANGED, { key: "doc:t1" });
  expect(result.current.externalChange).toBe("changed");

  ipc.pdfOpen.mockResolvedValue(opened({ handle: 12, stamp: "s9:new" }));
  disk = "same";
  await act(() => result.current.reload());
  expect(ipc.pdfOpen).toHaveBeenCalledTimes(2);
  expect(result.current).toMatchObject({ handle: 12, stamp: "s9:new", externalChange: "none" });
  expect(ipc.pdfClose).toHaveBeenCalledWith(HANDLE);
});

test("the_folder_change_a_save_makes_itself_is_not_taken_for_another_programs", async () => {
  const { result } = await edited();
  await waitFor(() => expect(handlers[EVENT_DIR_CHANGED]).toBeDefined());
  // The write lands and the folder says so before the save has answered.
  ipc.pdfSave.mockImplementation(async () => {
    disk = "changed";
    await emit(EVENT_DIR_CHANGED, { key: "doc:t1" });
    disk = "same";
    return "s2:saved";
  });
  await act(() => result.current.save());
  expect(result.current.externalChange).toBe("none");
  expect(result.current.prompt).toBeNull();
});

// ---- a failed write ----

test("a_failed_write_keeps_the_tab_dirty_and_raises_the_error", async () => {
  const { result } = await edited();
  ipc.pdfSave.mockRejectedValue(wireError("Io", "No space left on device"));
  await act(() => result.current.save());
  expect(result.current.problem).toBe("book.pdf was not saved: Io: No space left on device");
  expect(result.current).toMatchObject({ modified: true, stamp: "s1:opened", prompt: null });
  expect(tab()).toMatchObject({ dirty: true });
  // The next success takes the words away.
  ipc.pdfSave.mockResolvedValue("s2:saved");
  await act(() => result.current.save());
  expect(result.current.problem).toBeNull();
});

test("saving_for_a_close_says_whether_the_file_holds_the_document_now", async () => {
  const { result } = await edited();
  let ok = true;
  await act(async () => {
    ok = await result.current.saveForClose();
  });
  expect(ok).toBe(true);
  expect(ipc.pdfSave).toHaveBeenCalledTimes(1);
  ipc.pdfApply.mockResolvedValue(answer({ revision: 2 }));
  await act(() => result.current.apply(ROTATE));
  ipc.pdfSave.mockRejectedValue(wireError("Io", "disk full"));
  await act(async () => {
    ok = await result.current.saveForClose();
  });
  expect(ok).toBe(false);
  expect(result.current.problem).toMatch(/was not saved/);
});

test("saving_for_a_close_of_a_document_that_is_unchanged_writes_nothing", async () => {
  const { result } = await ready();
  let ok = false;
  await act(async () => {
    ok = await result.current.saveForClose();
  });
  expect(ok).toBe(true);
  expect(ipc.pdfSave).not.toHaveBeenCalled();
});

// ---- Save As ----

test("save_as_refuses_an_existing_file_until_the_user_agrees_to_replace_it", async () => {
  const { result } = await edited();
  const there = entry({ len: 5, modified_ms: 7 });
  ipc.entryOf.mockResolvedValue(there);
  let outcome;
  await act(async () => {
    outcome = await result.current.saveAs(OTHER, null);
  });
  expect(outcome).toEqual({ status: "exists", entry: there });
  expect(ipc.pdfSave).not.toHaveBeenCalled();
  // Nothing was written, so the hold on the name is let go.
  expect(ipc.docClosed).toHaveBeenCalledWith(OTHER, expect.anything());

  await act(async () => {
    outcome = await result.current.saveAs(OTHER, there);
  });
  expect(outcome).toEqual({ status: "saved" });
  expect(ipc.pdfSave).toHaveBeenCalledWith(HANDLE, OTHER, { kind: "anything" }, expect.any(String));
});

test("save_as_to_a_free_name_writes_only_if_nothing_appears_and_the_tab_follows_the_file", async () => {
  const { result } = await edited();
  ipc.entryOf.mockImplementation(async (path: WirePath) => {
    if (path.v === OTHER.v) throw wireError("NotFound");
    return entry();
  });
  ipc.pdfSave.mockResolvedValue("s7:other");
  let outcome;
  await act(async () => {
    outcome = await result.current.saveAs(OTHER, null);
  });
  expect(outcome).toEqual({ status: "saved" });
  expect(ipc.pdfSave).toHaveBeenCalledWith(HANDLE, OTHER, { kind: "nothing" }, expect.any(String));
  expect(tab()).toMatchObject({ path: OTHER, dirty: false });
  expect(result.current).toMatchObject({ stamp: "s7:other", modified: false, prompt: null });
  // The same document under a new name: not opened again.
  expect(ipc.pdfOpen).toHaveBeenCalledTimes(1);
  expect(ipc.recentTouch).toHaveBeenCalledWith(OTHER);
});

test("save_as_to_a_file_that_appears_meanwhile_asks_about_it", async () => {
  const { result } = await edited();
  const there = entry({ len: 5, modified_ms: 7 });
  let appeared = false;
  ipc.entryOf.mockImplementation(async (path: WirePath) => {
    if (path.v !== OTHER.v) return entry();
    if (!appeared) throw wireError("NotFound");
    return there;
  });
  ipc.pdfSave.mockImplementation(async () => {
    appeared = true;
    throw wireError("Exists");
  });
  let outcome;
  await act(async () => {
    outcome = await result.current.saveAs(OTHER, null);
  });
  expect(outcome).toEqual({ status: "exists", entry: there });
  expect(tab()).toMatchObject({ path: FILE, dirty: true });
});

test("save_as_never_writes_over_a_file_open_elsewhere", async () => {
  const { result } = await edited();
  const where = { kind: "tab", window: "main", tab_id: "other" };
  ipc.docOpenElsewhere.mockResolvedValue({ state: "elsewhere", location: where });
  let outcome;
  await act(async () => {
    outcome = await result.current.saveAs(OTHER, null);
  });
  expect(outcome).toEqual({ status: "open-elsewhere", location: where });
  expect(ipc.pdfSave).not.toHaveBeenCalled();
});

test("save_as_to_the_open_file_itself_is_refused", async () => {
  const { result } = await edited();
  let outcome;
  await act(async () => {
    outcome = await result.current.saveAs(FILE, null);
  });
  expect(outcome).toMatchObject({ status: "failed", message: expect.stringMatching(/Use Save/) });
  expect(ipc.pdfSave).not.toHaveBeenCalled();
});

// ---- a compacted copy ----

test("a_compacted_copy_never_targets_the_open_file", async () => {
  const { result } = await ready();
  let outcome;
  await act(async () => {
    outcome = await result.current.saveCompactedCopy(FILE);
  });
  expect(outcome).toMatchObject({ status: "failed", message: expect.stringMatching(/open file/) });
  expect(ipc.pdfCompact).not.toHaveBeenCalled();
  expect(ipc.pdfCompactFile).not.toHaveBeenCalled();
});

test("a_compacted_copy_of_an_open_document_holds_the_changes_made_before_it", async () => {
  const { result } = await edited();
  let outcome;
  await act(async () => {
    outcome = await result.current.saveCompactedCopy(OTHER);
  });
  expect(outcome).toEqual({ status: "saved" });
  expect(ipc.pdfCompact).toHaveBeenCalledWith(HANDLE, OTHER);
  // The document is still the one that was opened: nothing was saved to its file.
  expect(result.current).toMatchObject({ modified: true, stamp: "s1:opened" });
});

test("a_compacted_copy_over_a_file_is_refused_with_words", async () => {
  const { result } = await ready();
  ipc.pdfCompact.mockRejectedValue(wireError("Exists"));
  let outcome;
  await act(async () => {
    outcome = await result.current.saveCompactedCopy(OTHER);
  });
  expect(outcome).toMatchObject({
    status: "failed",
    message: expect.stringMatching(/never writes/),
  });
});

test.each(["RebuiltNotEditable", "RevisionNotEditable"])(
  "a_%s_refusal_offers_a_compacted_copy_of_the_file",
  async (kind) => {
    ipc.pdfOpen.mockRejectedValue(wireError(kind));
    const { result } = mount();
    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.error?.kind).toBe(kind);
    let outcome;
    await act(async () => {
      outcome = await result.current.saveCompactedCopy(OTHER);
    });
    expect(outcome).toEqual({ status: "saved" });
    expect(ipc.pdfCompactFile).toHaveBeenCalledWith({ path: FILE, password: undefined }, OTHER);
    expect(ipc.pdfCompact).not.toHaveBeenCalled();
  }
);

test("a_compacted_copy_of_an_encrypted_file_that_did_not_open_sends_its_password", async () => {
  ipc.pdfOpen.mockImplementation(async (_path: WirePath, password?: string) => {
    if (password === undefined) throw wireError("WrongPassword");
    throw wireError("RebuiltNotEditable");
  });
  const { result } = mount();
  await waitFor(() => expect(result.current.phase).toBe("needs-password"));
  await act(() => result.current.open("secret"));
  await waitFor(() => expect(result.current.phase).toBe("failed"));
  await act(() => result.current.saveCompactedCopy(OTHER));
  expect(ipc.pdfCompactFile).toHaveBeenCalledWith({ path: FILE, password: "secret" }, OTHER);
});

// ---- the copy before the first edit ----

test("the_first_edit_asks_to_save_a_copy_first_and_only_once", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  expect(view.result.current.firstEditPending).toBe(true);
  let edit!: Promise<void>;
  act(() => {
    edit = view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  // Nothing is changed while the question is open.
  expect(ipc.pdfApply).not.toHaveBeenCalled();

  await act(() => view.result.current.answerCopyFirst("copy"));
  await act(() => edit);
  expect(copy.copyBeside).toHaveBeenCalledWith(FILE);
  expect(ipc.pdfApply).toHaveBeenCalledTimes(1);
  expect(view.result.current).toMatchObject({ prompt: null, firstEditPending: false });
  expect(useOps.getState().notice?.text).toBe("Kept a copy of book.pdf as book (2).pdf");

  ipc.pdfApply.mockResolvedValue(answer({ revision: 2 }));
  await act(() => view.result.current.apply(ROTATE));
  expect(view.result.current.prompt).toBeNull();
  expect(copy.copyBeside).toHaveBeenCalledTimes(1);
});

test("cancel_at_the_prompt_makes_no_edit_and_the_next_edit_asks_again", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  let edit!: Promise<void>;
  act(() => {
    edit = view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  await act(() => view.result.current.answerCopyFirst("cancel"));
  await act(() => edit);
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(copy.copyBeside).not.toHaveBeenCalled();
  expect(view.result.current).toMatchObject({ prompt: null, modified: false });

  act(() => {
    void view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
});

test("escape_at_the_prompt_is_cancel", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  let edit!: Promise<void>;
  act(() => {
    edit = view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  act(() => view.result.current.cancelPrompt());
  await act(() => edit);
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(view.result.current.prompt).toBeNull();
});

test("edit_without_a_copy_makes_the_edit_and_no_copy", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  let edit!: Promise<void>;
  act(() => {
    edit = view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  await act(() => view.result.current.answerCopyFirst("without"));
  await act(() => edit);
  expect(copy.copyBeside).not.toHaveBeenCalled();
  expect(ipc.pdfApply).toHaveBeenCalledTimes(1);
});

test("a_copy_that_could_not_be_made_stops_the_edit_and_says_why", async () => {
  copy.copyBeside.mockRejectedValue(wireError("Io", "Permission denied"));
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  let edit!: Promise<void>;
  act(() => {
    edit = view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  await act(() => view.result.current.answerCopyFirst("copy"));
  await act(() => edit);
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(view.result.current.problem).toBe(
    "book.pdf was not copied, so nothing was changed: Io: Permission denied"
  );
  expect(view.result.current.prompt).toBeNull();
});

test("a_second_change_asked_while_the_question_is_open_waits_for_the_same_answer", async () => {
  const view = mount();
  await waitFor(() => expect(view.result.current.phase).toBe("ready"));
  let a!: Promise<void>;
  let b!: Promise<void>;
  act(() => {
    a = view.result.current.apply(ROTATE);
    b = view.result.current.apply(ROTATE);
  });
  await waitFor(() => expect(view.result.current.prompt).toBe("copyFirst"));
  await act(() => view.result.current.answerCopyFirst("without"));
  await act(() => Promise.all([a, b]).then(() => undefined));
  expect(ipc.pdfApply).toHaveBeenCalledTimes(2);
});

test("a_document_open_in_another_place_is_not_asked_about_a_copy", async () => {
  ipc.docOpened.mockRejectedValue(wireError("AlreadyOpen"));
  const view = mount();
  await waitFor(() => expect(view.result.current.readOnly).not.toBeNull());
  expect(view.result.current.firstEditPending).toBe(false);
  await act(() => view.result.current.apply(ROTATE));
  expect(view.result.current.prompt).toBeNull();
  expect(ipc.pdfApply).not.toHaveBeenCalled();
  expect(useOps.getState().notice?.text).toMatch(/cannot be changed here/);
});

// ---- a rename ----

test("a_rename_takes_the_stamp_again_when_the_file_is_what_it_was", async () => {
  const { result } = await edited();
  await waitFor(() => expect(handlers[EVENT_DOC_MOVED]).toBeDefined());
  // Reading it again under the new name gives a stamp that differs only in the change time.
  ipc.pdfOpen.mockResolvedValue(opened({ handle: 12, stamp: "s3:renamed" }));
  await emit(EVENT_DOC_MOVED, { from: FILE, to: OTHER });
  await waitFor(() => expect(result.current.stamp).toBe("s3:renamed"));
  expect(ipc.pdfOpen).toHaveBeenLastCalledWith(OTHER, undefined);
  // The document read only to take the stamp is closed again; the open one stays.
  expect(ipc.pdfClose).toHaveBeenCalledWith(12);
  expect(ipc.pdfClose).not.toHaveBeenCalledWith(HANDLE);

  await act(() => result.current.save());
  expect(ipc.pdfSave).toHaveBeenCalledWith(
    HANDLE,
    OTHER,
    { kind: "unchanged", stamp: "s3:renamed" },
    expect.any(String)
  );
});

test("a_rename_keeps_the_stamp_when_the_file_is_not_what_it_was", async () => {
  const { result } = await edited();
  await waitFor(() => expect(handlers[EVENT_DOC_MOVED]).toBeDefined());
  ipc.entryOf.mockResolvedValue(entry({ len: 99, modified_ms: 2000 }));
  await emit(EVENT_DOC_MOVED, { from: FILE, to: OTHER });
  expect(result.current.stamp).toBe("s1:opened");
  expect(ipc.pdfOpen).toHaveBeenCalledTimes(1);
});

test("a_rename_keeps_the_stamp_when_the_file_changed_while_it_was_read_again", async () => {
  const { result } = await edited();
  await waitFor(() => expect(handlers[EVENT_DOC_MOVED]).toBeDefined());
  let looks = 0;
  // The second look (after the document was read again) finds another modification time.
  ipc.entryOf.mockImplementation(async () => entry({ modified_ms: ++looks >= 2 ? 5000 : 1000 }));
  ipc.pdfOpen.mockResolvedValue(opened({ handle: 12, stamp: "s3:renamed" }));
  await emit(EVENT_DOC_MOVED, { from: FILE, to: OTHER });
  expect(result.current.stamp).toBe("s1:opened");
});

// ---- moving to another window ----

test("a_document_that_is_moving_takes_no_change_and_no_save", async () => {
  const { result } = await edited();
  act(() => result.current.setMoving(true));
  expect(result.current.canEdit).toBe(false);
  await act(() => result.current.apply(ROTATE));
  expect(ipc.pdfApply).toHaveBeenCalledTimes(1);
  await act(() => result.current.save());
  expect(ipc.pdfSave).not.toHaveBeenCalled();
  act(() => result.current.setMoving(false));
  await act(() => result.current.save());
  expect(ipc.pdfSave).toHaveBeenCalledTimes(1);
});
