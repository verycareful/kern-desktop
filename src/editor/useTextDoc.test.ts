// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook, waitFor } from "@testing-library/react";
import { Text } from "@codemirror/state";
import { beforeEach, expect, test, vi } from "vitest";
import type { WireError, WirePath, WireText } from "../ipc";

const ipc = vi.hoisted(() => ({
  textOpen: vi.fn(),
  textSave: vi.fn(),
  textCheck: vi.fn(),
  entryOf: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  recentTouch: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useOps } from "../ops/useOps";
import { useTabs, type DocTab } from "../store/tabs";
import { useDocStatus } from "./doc-status";
import { docController } from "./doc-controller";
import { useTextDoc } from "./useTextDoc";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/notes.txt");
const S0 = "s1:5:0:1:1:0";
const S1 = "s1:9:0:1:1:1";

const opened = (over: Partial<WireText> = {}): WireText => ({
  path: FILE,
  text: "hello",
  ending: "lf",
  bom: false,
  read_only: null,
  stamp: S0,
  ...over,
});
const wireError = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

let handlers: Record<string, (payload: unknown) => void>;
const emit = (name: string, payload: unknown) => act(async () => handlers[name]?.(payload));

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  useOps.setState({ notice: null });
  useDocStatus.setState({ byTab: {} });
  useTabs.setState({
    tabs: [{ id: "t1", kind: "doc", path: FILE, dirty: false }],
    activeId: "t1",
  });
  ipc.textOpen.mockResolvedValue(opened());
  ipc.textSave.mockResolvedValue(S1);
  ipc.textCheck.mockResolvedValue("same");
  ipc.entryOf.mockRejectedValue(wireError("NotFound"));
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.recentTouch.mockResolvedValue({ entries: [] });
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
});

/** The hook as a tab hosts it: the path comes from the tab, which Save As changes. */
async function mount() {
  const hook = renderHook(() => {
    const path = useTabs((s) => (s.tabs.find((t) => t.id === "t1") as DocTab).path);
    return useTextDoc("t1", path);
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
  // The watch is placed once the subscriptions are.
  await waitFor(() => expect(ipc.watchDir).toHaveBeenCalled());
  return hook;
}
const type = (hook: Awaited<ReturnType<typeof mount>>, text: string) =>
  act(() => hook.result.current.edited(Text.of(text.split("\n"))));

test("dirty_after_edit_clean_after_save", async () => {
  const hook = await mount();
  expect(hook.result.current.dirty).toBe(false);
  type(hook, "hello world");
  expect(hook.result.current.dirty).toBe(true);
  expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: true });

  await act(() => hook.result.current.save());
  // The stamp of the text as opened goes with the save, never null.
  expect(ipc.textSave).toHaveBeenCalledWith(FILE, "hello world", "lf", false, S0);
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.stamp).toBe(S1);
  expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: false });

  // The next save carries the stamp the last one returned.
  type(hook, "hello world!");
  await act(() => hook.result.current.save());
  expect(ipc.textSave).toHaveBeenLastCalledWith(FILE, "hello world!", "lf", false, S1);
});

test("an_edit_undone_by_hand_is_clean_again", async () => {
  const hook = await mount();
  type(hook, "hello!");
  expect(hook.result.current.dirty).toBe(true);
  type(hook, "hello");
  expect(hook.result.current.dirty).toBe(false);
  expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: false });
});

test("text_typed_while_a_save_is_written_stays_dirty", async () => {
  const hook = await mount();
  let finish: (stamp: string) => void = () => undefined;
  ipc.textSave.mockReturnValue(new Promise<string>((r) => (finish = r)));
  type(hook, "one");
  let saving: Promise<void> = Promise.resolve();
  act(() => {
    saving = hook.result.current.save();
  });
  await waitFor(() => expect(ipc.textSave).toHaveBeenCalled());
  type(hook, "one two");
  await act(async () => {
    finish(S1);
    await saving;
  });
  // What was written is "one"; "one two" is not saved.
  expect(hook.result.current.dirty).toBe(true);
});

test("crlf_kept_on_save", async () => {
  ipc.textOpen.mockResolvedValue(opened({ ending: "crlf", bom: true, text: "a\nb" }));
  const hook = await mount();
  expect(hook.result.current.ending).toBe("crlf");
  expect(useDocStatus.getState().byTab.t1).toMatchObject({ ending: "crlf", bom: true });
  type(hook, "a\nbc");
  await act(() => hook.result.current.save());
  expect(ipc.textSave).toHaveBeenCalledWith(FILE, "a\nbc", "crlf", true, S0);
});

test("external_change_prompts", async () => {
  const hook = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ExternalModification"));
  ipc.textCheck.mockResolvedValue("changed");
  type(hook, "mine");
  await act(() => hook.result.current.save());
  expect(hook.result.current.prompt).toBe("external");
  expect(hook.result.current.changedOnDisk).toBe(true);
  // Nothing was written without the stamp.
  expect(ipc.textSave).toHaveBeenCalledTimes(1);
  expect(ipc.textSave.mock.calls[0]![4]).toBe(S0);
  // Cancel writes nothing and keeps the edit.
  act(() => hook.result.current.cancelPrompt());
  expect(hook.result.current.prompt).toBeNull();
  expect(hook.result.current.dirty).toBe(true);
  expect(ipc.textSave).toHaveBeenCalledTimes(1);
});

test("overwrite_after_the_prompt_saves_without_a_stamp", async () => {
  const hook = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ExternalModification"));
  ipc.textCheck.mockResolvedValue("changed");
  type(hook, "mine");
  await act(() => hook.result.current.save());
  await act(() => hook.result.current.overwrite());
  expect(ipc.textSave).toHaveBeenCalledTimes(2);
  expect(ipc.textSave).toHaveBeenLastCalledWith(FILE, "mine", "lf", false, null);
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.changedOnDisk).toBe(false);
});

test("overwrite_does_nothing_when_no_question_is_open", async () => {
  const hook = await mount();
  type(hook, "mine");
  await act(() => hook.result.current.overwrite());
  expect(ipc.textSave).not.toHaveBeenCalled();
});

test("reload_after_the_prompt_reads_the_disk_and_drops_the_edit", async () => {
  const hook = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ExternalModification"));
  ipc.textCheck.mockResolvedValue("changed");
  type(hook, "mine");
  await act(() => hook.result.current.save());
  ipc.textOpen.mockResolvedValue(opened({ text: "theirs", stamp: S1 }));
  const before = hook.result.current.generation;
  await act(() => hook.result.current.reload());
  expect(hook.result.current.doc?.toString()).toBe("theirs");
  expect(hook.result.current.generation).toBe(before + 1);
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.prompt).toBeNull();
  expect(hook.result.current.stamp).toBe(S1);
});

test("a_save_refused_because_the_file_is_gone_asks_to_recreate_not_to_overwrite", async () => {
  const hook = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ExternalModification"));
  ipc.textCheck.mockResolvedValue("deleted");
  type(hook, "mine");
  await act(() => hook.result.current.save());
  expect(hook.result.current.prompt).toBe("recreate");
  expect(hook.result.current.deletedOnDisk).toBe(true);
});

test("deleted_file_save_warns", async () => {
  const hook = await mount();
  ipc.textCheck.mockResolvedValue("deleted");
  await emit("kernkraft://dir-changed", { key: "doc:t1" });
  await waitFor(() => expect(hook.result.current.deletedOnDisk).toBe(true));
  expect(ipc.textCheck).toHaveBeenCalledWith(FILE, S0);

  type(hook, "mine");
  await act(() => hook.result.current.save());
  // It asks, and writes nothing yet.
  expect(hook.result.current.prompt).toBe("recreate");
  expect(ipc.textSave).not.toHaveBeenCalled();

  // Cancel leaves the file gone and the edit in place.
  act(() => hook.result.current.cancelPrompt());
  expect(ipc.textSave).not.toHaveBeenCalled();
  expect(hook.result.current.dirty).toBe(true);

  // Only the confirmation writes, without a stamp (there is nothing to match).
  await act(() => hook.result.current.save());
  await act(() => hook.result.current.overwrite());
  expect(ipc.textSave).toHaveBeenCalledTimes(1);
  expect(ipc.textSave).toHaveBeenCalledWith(FILE, "mine", "lf", false, null);
  expect(hook.result.current.deletedOnDisk).toBe(false);
  expect(hook.result.current.dirty).toBe(false);
});

test("the_folder_vanishing_means_the_file_is_deleted", async () => {
  const hook = await mount();
  ipc.textCheck.mockResolvedValue("deleted");
  await emit("kernkraft://dir-gone", { key: "doc:t1" });
  await waitFor(() => expect(hook.result.current.deletedOnDisk).toBe(true));
});

test("a_watch_that_ended_with_an_error_is_said", async () => {
  const hook = await mount();
  await emit("kernkraft://dir-gone", { key: "doc:t1", error: wireError("Io", "inotify") });
  expect(hook.result.current.watchError?.message).toBe("inotify");
});

test("events_for_another_key_are_ignored", async () => {
  await mount();
  await emit("kernkraft://dir-changed", { key: "t1" });
  await emit("kernkraft://dir-changed", { key: "doc:other" });
  expect(ipc.textCheck).not.toHaveBeenCalled();
});

test("a_changed_file_is_flagged_and_a_check_that_fails_is_said", async () => {
  const hook = await mount();
  ipc.textCheck.mockResolvedValueOnce("changed");
  await emit("kernkraft://dir-changed", { key: "doc:t1" });
  await waitFor(() => expect(hook.result.current.changedOnDisk).toBe(true));
  expect(hook.result.current.deletedOnDisk).toBe(false);

  ipc.textCheck.mockRejectedValueOnce(wireError("Io", "denied"));
  await emit("kernkraft://dir-changed", { key: "doc:t1" });
  await waitFor(() => expect(hook.result.current.problem).toMatch(/could not check/));
  expect(hook.result.current.problem).toMatch(/denied/);
});

test("the_document_is_registered_recent_and_watched_and_released_with_the_tab", async () => {
  const hook = await mount();
  expect(ipc.docOpened).toHaveBeenCalledWith(FILE, { kind: "tab", tab_id: "t1" });
  expect(ipc.recentTouch).toHaveBeenCalledWith(FILE);
  expect(ipc.watchDir).toHaveBeenCalledWith("doc:t1", p("/home/a"));
  hook.unmount();
  await waitFor(() =>
    expect(ipc.docClosed).toHaveBeenCalledWith(FILE, { kind: "tab", tab_id: "t1" })
  );
  expect(ipc.unwatchDir).toHaveBeenCalledWith("doc:t1");
  expect(useDocStatus.getState().byTab.t1).toBeUndefined();
});

test("a_failed_recent_entry_is_said_and_editing_goes_on", async () => {
  ipc.recentTouch.mockRejectedValue(wireError("Io", "disk full"));
  const hook = await mount();
  await waitFor(() => expect(useOps.getState().notice?.text).toMatch(/Recent.*disk full/));
  expect(hook.result.current.phase).toBe("ready");
  type(hook, "x");
  expect(hook.result.current.dirty).toBe(true);
});

test("a_failed_registration_is_said_and_not_released", async () => {
  ipc.docOpened.mockRejectedValue(wireError("Io", "no registry"));
  const hook = await mount();
  await waitFor(() => expect(useOps.getState().notice?.text).toMatch(/no registry/));
  hook.unmount();
  await Promise.resolve();
  expect(ipc.docClosed).not.toHaveBeenCalled();
});

test("a_watch_that_cannot_be_set_is_said", async () => {
  ipc.watchDir.mockRejectedValue(wireError("Io", "no inotify watches left"));
  const hook = renderHook(() => useTextDoc("t1", FILE));
  await waitFor(() =>
    expect(hook.result.current.watchError?.message).toBe("no inotify watches left")
  );
  expect(hook.result.current.phase).toBe("ready");
});

test("a_file_that_cannot_be_opened_is_failed_with_its_error", async () => {
  ipc.textOpen.mockRejectedValue(wireError("TooLargeToOpen", "too big"));
  const hook = renderHook(() => useTextDoc("t1", FILE));
  await waitFor(() => expect(hook.result.current.phase).toBe("failed"));
  expect(hook.result.current.error?.kind).toBe("TooLargeToOpen");
  expect(ipc.docOpened).not.toHaveBeenCalled();
  expect(ipc.recentTouch).not.toHaveBeenCalled();
});

test("a_read_only_file_is_not_saved", async () => {
  ipc.textOpen.mockResolvedValue(
    opened({ read_only: { kind: "MixedLineEndings", detail: "mixed" } })
  );
  const hook = await mount();
  await act(() => hook.result.current.save());
  expect(ipc.textSave).not.toHaveBeenCalled();
  expect(useOps.getState().notice?.text).toMatch(/read-only/);
  expect(docController("t1")?.canSave()).toBe(false);
  expect(docController("t1")?.canSaveAs()).toBe(true);
});

test("a_failed_save_is_said_and_the_edit_is_kept", async () => {
  const hook = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ReadOnly", "no permission"));
  type(hook, "mine");
  await act(() => hook.result.current.save());
  expect(hook.result.current.problem).toMatch(/notes\.txt was not saved.*no permission/);
  expect(hook.result.current.dirty).toBe(true);
  expect(hook.result.current.prompt).toBeNull();
});

test("a_clean_document_has_nothing_to_save", async () => {
  await mount();
  expect(docController("t1")?.canSave()).toBe(false);
});

// ---- Save As ----

test("save_as_to_a_new_path_writes_without_a_stamp_and_the_tab_follows", async () => {
  const hook = await mount();
  const target = p("/home/a/copy.txt");
  ipc.textOpen.mockClear();
  ipc.textOpen.mockResolvedValue(opened({ path: target, stamp: S1 }));
  type(hook, "mine");
  let result: unknown;
  await act(async () => {
    result = await hook.result.current.saveAs(target, false);
  });
  expect(result).toEqual({ status: "saved" });
  expect(ipc.textSave).toHaveBeenCalledWith(target, "mine", "lf", false, null);
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: target, dirty: false });
  // The new file is read back once; the move to its path does not open it again.
  await waitFor(() =>
    expect(ipc.docOpened).toHaveBeenCalledWith(target, { kind: "tab", tab_id: "t1" })
  );
  expect(ipc.docClosed).toHaveBeenCalledWith(FILE, { kind: "tab", tab_id: "t1" });
  expect(ipc.watchDir).toHaveBeenLastCalledWith("doc:t1", p("/home/a"));
  expect(ipc.recentTouch).toHaveBeenCalledWith(target);
  expect(ipc.textOpen).toHaveBeenCalledTimes(1);
  expect(hook.result.current.dirty).toBe(false);
  expect(hook.result.current.stamp).toBe(S1);
});

test("save_as_over_an_existing_file_asks_first_and_writes_nothing", async () => {
  const hook = await mount();
  const target = p("/home/a/other.txt");
  const entry = { path: target, name: "other.txt", kind: "file", len: 42 };
  ipc.entryOf.mockResolvedValue(entry);
  type(hook, "mine");
  let result: unknown;
  await act(async () => {
    result = await hook.result.current.saveAs(target, false);
  });
  expect(result).toEqual({ status: "exists", entry });
  expect(ipc.textSave).not.toHaveBeenCalled();
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: FILE });

  // Only the agreed Replace writes.
  ipc.textOpen.mockResolvedValue(opened({ path: target, stamp: S1 }));
  await act(async () => {
    result = await hook.result.current.saveAs(target, true);
  });
  expect(result).toEqual({ status: "saved" });
  expect(ipc.textSave).toHaveBeenCalledWith(target, "mine", "lf", false, null);
});

test("save_as_refuses_a_folder_this_file_and_an_open_tab_and_writes_nothing", async () => {
  const hook = await mount();
  ipc.entryOf.mockResolvedValue({ path: p("/home/a/d"), name: "d", kind: "dir", len: 0 });
  let r: { status: string; message?: string } = { status: "" };
  await act(async () => {
    r = await hook.result.current.saveAs(p("/home/a/d"), false);
  });
  expect(r).toMatchObject({ status: "failed" });
  expect(r.message).toMatch(/folder/);

  await act(async () => {
    r = await hook.result.current.saveAs(FILE, false);
  });
  expect(r).toMatchObject({ status: "failed" });

  useTabs.setState((s) => ({
    tabs: [...s.tabs, { id: "t2", kind: "doc", path: p("/home/a/x.txt"), dirty: false }],
  }));
  await act(async () => {
    r = await hook.result.current.saveAs(p("/home/a/x.txt"), false);
  });
  expect(r.message).toMatch(/another tab/);
  expect(ipc.textSave).not.toHaveBeenCalled();
});

test("save_as_does_not_guess_when_it_cannot_tell_whether_something_is_there", async () => {
  const hook = await mount();
  ipc.entryOf.mockRejectedValue(wireError("PermissionDenied", "cannot stat"));
  let r: { status: string; message?: string } = { status: "" };
  await act(async () => {
    r = await hook.result.current.saveAs(p("/root/x.txt"), false);
  });
  expect(r.status).toBe("failed");
  expect(r.message).toMatch(/cannot stat/);
  expect(ipc.textSave).not.toHaveBeenCalled();
});

test("a_failed_save_as_leaves_the_document_where_it_was", async () => {
  const hook = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("Io", "read-only file system"));
  type(hook, "mine");
  let r: { status: string; message?: string } = { status: "" };
  await act(async () => {
    r = await hook.result.current.saveAs(p("/home/a/new.txt"), false);
  });
  expect(r.status).toBe("failed");
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: FILE, dirty: true });
  expect(hook.result.current.dirty).toBe(true);
});

test("a_release_never_lands_after_the_next_registration_of_the_same_document", async () => {
  // The first registration is slow: the move to the Save As path must still wait for it, then
  // release it, and only then register the new path.
  const log: string[] = [];
  const slow = () => new Promise<void>((r) => setTimeout(r, 30));
  ipc.docOpened.mockImplementation(async (path: WirePath) => {
    log.push(`open ${path.v} start`);
    await slow();
    log.push(`open ${path.v} end`);
  });
  ipc.docClosed.mockImplementation(async (path: WirePath) => {
    log.push(`close ${path.v}`);
  });
  const target = p("/home/a/copy.txt");
  ipc.textOpen.mockResolvedValueOnce(opened()).mockResolvedValue(opened({ path: target }));
  const hook = renderHook(() => {
    const path = useTabs((s) => (s.tabs.find((t) => t.id === "t1") as DocTab).path);
    return useTextDoc("t1", path);
  });
  await waitFor(() => expect(hook.result.current.phase).toBe("ready"));
  await act(async () => {
    await hook.result.current.saveAs(target, false);
  });
  await waitFor(() => expect(log).toContain("open /home/a/copy.txt end"));
  expect(log).toEqual([
    "open /home/a/notes.txt start",
    "open /home/a/notes.txt end",
    "close /home/a/notes.txt",
    "open /home/a/copy.txt start",
    "open /home/a/copy.txt end",
  ]);
});
