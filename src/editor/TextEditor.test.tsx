// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { Profiler } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
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
  docOpenElsewhere: vi.fn(),
  openPaths: vi.fn(),
  recentTouch: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
  openDefault: vi.fn(),
  userDirs: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useShortcuts } from "../keys/useShortcuts";
import { useViewSettings } from "../files/view-settings";
import { useUserDirs } from "../shell/user-dirs-store";
import { StatusBar } from "../shell/StatusBar";
import { useOps } from "../ops/useOps";
import { useTabs, type DocTab } from "../store/tabs";
import { useDocStatus } from "./doc-status";
import { TextEditor } from "./TextEditor";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const FILE = p("/home/a/notes.txt");
const S0 = "s1:5:0:1:1:0";
const S1 = "s1:9:0:1:1:1";

const opened = (over: Partial<WireText> = {}): WireText => ({
  path: FILE,
  text: "hello\nworld",
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

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  useOps.setState({ notice: null });
  useDocStatus.setState({ byTab: {} });
  useUserDirs.getState().reset();
  useViewSettings.setState({ wordWrap: false, editorZoom: 1 });
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
  ipc.docOpenElsewhere.mockResolvedValue({ state: "free" });
  ipc.recentTouch.mockResolvedValue({ entries: [] });
  ipc.settingsGet.mockResolvedValue({ terminal: "kitty" });
  ipc.openDefault.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({ home: p("/home/a"), dirs: [] });
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
});

/** The editor in a window that has the shortcuts and the status bar. */
function Window(props: { onRender?: () => void }) {
  useShortcuts();
  const path = useTabs((s) => (s.tabs.find((t) => t.id === "t1") as DocTab).path);
  return (
    <>
      <Profiler id="editor" onRender={() => props.onRender?.()}>
        <TextEditor tabId="t1" path={path} active />
      </Profiler>
      <StatusBar />
    </>
  );
}

async function mount(onRender?: () => void) {
  render(<Window onRender={onRender} />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  await waitFor(() => expect(ipc.watchDir).toHaveBeenCalled());
  const content = host.querySelector<HTMLElement>(".cm-content")!;
  const view = EditorView.findFromDOM(host)!;
  return { host, content, view };
}

const key = (el: Element, k: string, mods: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(el, { key: k, code: `Key${k.toUpperCase()}`, ...mods });

test("shows_line_numbers", async () => {
  const { host, view } = await mount();
  expect(host.querySelector(".cm-lineNumbers")).not.toBeNull();
  const numbers = [...host.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].map(
    (e) => e.textContent
  );
  expect(numbers).toContain("1");
  expect(numbers).toContain("2");
  expect(view.state.doc.toString()).toBe("hello\nworld");
});

test("read_only_banner_for_mixed", async () => {
  ipc.textOpen.mockResolvedValue(
    opened({
      read_only: { kind: "MixedLineEndings", detail: "mixed line endings: 3 LF, 2 CRLF, 0 CR" },
    })
  );
  const { view, content } = await mount();
  const banner = screen.getByTestId("read-only-banner");
  expect(banner).toHaveTextContent(
    "This file mixes Windows and Unix line endings. Kern opens it read-only so none of them change."
  );
  // The backend's detail says more than the sentence and is shown too.
  expect(banner).toHaveTextContent("3 LF, 2 CRLF, 0 CR");
  expect(view.state.readOnly).toBe(true);
  // Typing is refused by the editor itself (programmatic transactions are not user input).
  act(() => view.dispatch({ selection: { anchor: 5 } }));
  key(content, "Enter");
  expect(view.state.doc.toString()).toBe("hello\nworld");
  expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: false });
});

test("a_writable_file_has_no_banner_and_takes_edits", async () => {
  const { view, content } = await mount();
  expect(screen.queryByTestId("read-only-banner")).toBeNull();
  expect(view.state.readOnly).toBe(false);
  // The same key that read-only refuses inserts a line here.
  act(() => view.dispatch({ selection: { anchor: 5 } }));
  key(content, "Enter");
  expect(view.state.doc.toString()).toBe("hello\n\nworld");
});

test("each_reason_has_its_own_sentence", async () => {
  const { readOnlyText } = await import("./read-only-text");
  const kinds = ["NotUtf8", "Utf16", "MixedLineEndings", "TooLarge", "NoWritePermission"];
  const sentences = kinds.map((kind) => readOnlyText({ kind, detail: "" }).sentence);
  expect(new Set(sentences).size).toBe(5);
  for (const s of sentences) expect(s).toMatch(/read-only|read only/i);
  expect(readOnlyText({ kind: "NotUtf8", detail: "from byte 7" }).detail).toBe("from byte 7");
  expect(readOnlyText({ kind: "NotUtf8", detail: " " }).detail).toBeNull();
  // A reason from a newer backend is still said.
  expect(readOnlyText({ kind: "Strange", detail: "why" }).sentence).toMatch(/Strange/);
});

test("an_edit_marks_the_tab_dirty_and_the_status_bar_follows_the_cursor", async () => {
  const { view } = await mount();
  expect(screen.getByTestId("status-position")).toHaveTextContent("Ln 1, Col 1");
  expect(screen.getByTestId("status-encoding")).toHaveTextContent(/^UTF-8$/);
  expect(screen.getByTestId("status-ending")).toHaveTextContent(/^LF$/);
  expect(screen.queryByTestId("status-dirty")).toBeNull();

  act(() => view.dispatch({ changes: { from: 0, insert: "ab" }, selection: { anchor: 9 } }));
  // "abhello\nworld": offset 9 is after the "w" of the second line.
  expect(screen.getByTestId("status-position")).toHaveTextContent("Ln 2, Col 2");
  expect(screen.getByTestId("status-dirty")).toBeInTheDocument();
  expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: true });
});

test("a_cursor_move_updates_the_status_bar_and_does_not_render_the_editor", async () => {
  let renders = 0;
  const { view } = await mount(() => renders++);
  const before = renders;
  act(() => view.dispatch({ selection: { anchor: 3 } }));
  act(() => view.dispatch({ selection: { anchor: 9 } }));
  expect(screen.getByTestId("status-position")).toHaveTextContent("Ln 2, Col 4");
  expect(renders).toBe(before);
});

test("a_character_outside_the_bmp_counts_as_one_column", async () => {
  ipc.textOpen.mockResolvedValue(opened({ text: "a\u{1F600}b" }));
  const { view } = await mount();
  act(() => view.dispatch({ selection: { anchor: 3 } }));
  expect(screen.getByTestId("status-position")).toHaveTextContent("Ln 1, Col 3");
});

test("status_shows_bom_and_crlf", async () => {
  ipc.textOpen.mockResolvedValue(opened({ ending: "crlf", bom: true }));
  await mount();
  expect(screen.getByTestId("status-encoding")).toHaveTextContent("UTF-8 with BOM");
  expect(screen.getByTestId("status-ending")).toHaveTextContent("CRLF");
});

test("ctrl_s_saves_with_the_opened_stamp_and_the_dot_goes", async () => {
  const { view, content } = await mount();
  act(() => view.dispatch({ changes: { from: 0, insert: "x" } }));
  key(content, "s", { ctrlKey: true });
  await waitFor(() => expect(ipc.textSave).toHaveBeenCalledTimes(1));
  expect(ipc.textSave).toHaveBeenCalledWith(FILE, "xhello\nworld", "lf", false, {
    kind: "unchanged",
    stamp: S0,
  });
  await waitFor(() => expect(screen.queryByTestId("status-dirty")).toBeNull());
});

test("ctrl_s_on_a_clean_document_writes_nothing", async () => {
  const { content } = await mount();
  key(content, "s", { ctrlKey: true });
  await Promise.resolve();
  expect(ipc.textSave).not.toHaveBeenCalled();
});

test("ctrl_d_is_not_codemirrors_select_next_occurrence", async () => {
  ipc.textOpen.mockResolvedValue(opened({ text: "foo foo" }));
  const { view, content } = await mount();
  act(() => view.dispatch({ selection: { anchor: 0, head: 3 } }));
  const claimed = !fireEvent.keyDown(content, { key: "d", code: "KeyD", ctrlKey: true });
  // CodeMirror's binding would have extended the selection to the second "foo".
  expect(view.state.selection.ranges).toHaveLength(1);
  expect(view.state.selection.main.to).toBe(3);
  // The window's Ctrl+D (Pin) claimed the key, so it has one meaning.
  expect(claimed).toBe(true);
});

test("codemirror_keeps_its_own_undo_select_all_and_find", async () => {
  const { view, content } = await mount();
  act(() => view.dispatch({ changes: { from: 0, insert: "x" } }));
  expect(view.state.doc.toString()).toBe("xhello\nworld");
  key(content, "z", { ctrlKey: true });
  expect(view.state.doc.toString()).toBe("hello\nworld");
  key(content, "y", { ctrlKey: true });
  expect(view.state.doc.toString()).toBe("xhello\nworld");
  key(content, "a", { ctrlKey: true });
  expect(view.state.selection.main).toMatchObject({ from: 0, to: 12 });
  key(content, "f", { ctrlKey: true });
  await waitFor(() => expect(document.querySelector(".cm-search")).not.toBeNull());
  // Find and replace: the panel has a replace field on a writable document.
  expect(document.querySelector('.cm-search input[name="replace"]')).not.toBeNull();
});

test("word_wrap_and_zoom_follow_the_settings", async () => {
  const { content } = await mount();
  expect(content.classList.contains("cm-lineWrapping")).toBe(false);
  act(() => useViewSettings.setState({ wordWrap: true, editorZoom: 2 }));
  await waitFor(() => expect(content.classList.contains("cm-lineWrapping")).toBe(true));
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toContain("* 2)");
});

test("an_inactive_editor_is_hidden_but_keeps_its_text", async () => {
  const { rerender } = render(<TextEditor tabId="t1" path={FILE} active />);
  const host = await screen.findByTestId("editor-host");
  await waitFor(() => expect(host.querySelector(".cm-content")).not.toBeNull());
  const view = EditorView.findFromDOM(host)!;
  act(() => view.dispatch({ changes: { from: 0, insert: "kept " } }));
  rerender(<TextEditor tabId="t1" path={FILE} active={false} />);
  expect(screen.getByTestId("text-editor")).not.toBeVisible();
  rerender(<TextEditor tabId="t1" path={FILE} active />);
  expect(screen.getByTestId("text-editor")).toBeVisible();
  // The same view, with its text and without a second open of the file.
  expect(EditorView.findFromDOM(screen.getByTestId("editor-host"))).toBe(view);
  expect(view.state.doc.toString()).toBe("kept hello\nworld");
  expect(ipc.textOpen).toHaveBeenCalledTimes(1);
});

test("a_file_too_large_to_open_offers_the_default_app", async () => {
  ipc.textOpen.mockRejectedValue(wireError("TooLargeToOpen", "21 MiB is above the limit"));
  render(<Window />);
  const failed = await screen.findByTestId("doc-failed");
  expect(failed).toHaveTextContent("too large");
  expect(ipc.docOpened).not.toHaveBeenCalled();
  fireEvent.click(within(failed).getByRole("button", { name: "Open in default app" }));
  await waitFor(() => expect(ipc.openDefault).toHaveBeenCalledWith([FILE], "kitty"));
});

test("opening_in_the_default_app_says_when_it_fails", async () => {
  ipc.textOpen.mockRejectedValue(wireError("TooLargeToOpen"));
  ipc.openDefault.mockRejectedValue(wireError("NoDefaultApp", "no application"));
  render(<Window />);
  const failed = await screen.findByTestId("doc-failed");
  fireEvent.click(within(failed).getByRole("button", { name: "Open in default app" }));
  await waitFor(() => expect(failed).toHaveTextContent(/no application/));
});

test("another_open_failure_names_the_error_and_offers_no_default_app", async () => {
  ipc.textOpen.mockRejectedValue(wireError("NotFound", "gone"));
  render(<Window />);
  const failed = await screen.findByTestId("doc-failed");
  expect(failed).toHaveTextContent(/could not be opened/);
  expect(failed).toHaveTextContent(/NotFound: gone/);
  expect(within(failed).queryByRole("button")).toBeNull();
});

// ---- the questions of a save ----

test("an_outside_change_asks_reload_overwrite_save_as_or_cancel", async () => {
  const { view, content } = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ExternalModification"));
  ipc.textCheck.mockResolvedValue("changed");
  act(() => view.dispatch({ changes: { from: 0, insert: "mine " } }));
  key(content, "s", { ctrlKey: true });
  const prompt = await screen.findByTestId("external-prompt");
  for (const name of ["Reload", "Overwrite", "Save As…", "Cancel"]) {
    expect(within(prompt).getByRole("button", { name })).toBeInTheDocument();
  }
  // Cancel has the focus and writes nothing.
  expect(within(prompt).getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(ipc.textSave).toHaveBeenCalledTimes(1);

  fireEvent.click(within(prompt).getByRole("button", { name: "Overwrite" }));
  await waitFor(() => expect(ipc.textSave).toHaveBeenCalledTimes(2));
  expect(ipc.textSave).toHaveBeenLastCalledWith(FILE, "mine hello\nworld", "lf", false, {
    kind: "anything",
  });
  await waitFor(() => expect(screen.queryByTestId("external-prompt")).toBeNull());
});

test("reload_in_the_prompt_loads_the_disk_text_into_the_editor", async () => {
  const { view, content } = await mount();
  ipc.textSave.mockRejectedValueOnce(wireError("ExternalModification"));
  ipc.textCheck.mockResolvedValue("changed");
  act(() => view.dispatch({ changes: { from: 0, insert: "mine " } }));
  key(content, "s", { ctrlKey: true });
  const prompt = await screen.findByTestId("external-prompt");
  ipc.textOpen.mockResolvedValue(opened({ text: "theirs", stamp: S1 }));
  fireEvent.click(within(prompt).getByRole("button", { name: "Reload" }));
  await waitFor(() =>
    expect(EditorView.findFromDOM(screen.getByTestId("editor-host"))).not.toBeNull()
  );
  await waitFor(() =>
    expect(EditorView.findFromDOM(screen.getByTestId("editor-host"))!.state.doc.toString()).toBe(
      "theirs"
    )
  );
  expect(screen.queryByTestId("status-dirty")).toBeNull();
});

test("a_file_deleted_on_disk_shows_the_banner_and_save_asks_before_recreating", async () => {
  const { view, content } = await mount();
  ipc.textCheck.mockResolvedValue("deleted");
  await act(async () => handlers["kernkraft://dir-changed"]?.({ key: "doc:t1" }));
  const banner = await screen.findByTestId("deleted-banner");
  expect(banner).toHaveTextContent(/deleted/);
  expect(banner).toHaveTextContent(/creates the file again/);

  act(() => view.dispatch({ changes: { from: 0, insert: "mine " } }));
  key(content, "s", { ctrlKey: true });
  const prompt = await screen.findByTestId("recreate-prompt");
  expect(prompt).toHaveTextContent("/home/a/notes.txt");
  expect(ipc.textSave).not.toHaveBeenCalled();
  fireEvent.click(within(prompt).getByRole("button", { name: "Create the file again" }));
  await waitFor(() => expect(ipc.textSave).toHaveBeenCalledTimes(1));
  expect(ipc.textSave).toHaveBeenCalledWith(FILE, "mine hello\nworld", "lf", false, {
    kind: "nothing",
  });
  await waitFor(() => expect(screen.queryByTestId("deleted-banner")).toBeNull());
});

test("a_changed_file_shows_a_banner_that_names_what_reload_discards", async () => {
  const { view } = await mount();
  ipc.textCheck.mockResolvedValue("changed");
  await act(async () => handlers["kernkraft://dir-changed"]?.({ key: "doc:t1" }));
  const banner = await screen.findByTestId("changed-banner");
  expect(within(banner).getByRole("button", { name: "Reload" })).toBeInTheDocument();
  act(() => view.dispatch({ changes: { from: 0, insert: "mine " } }));
  expect(
    within(screen.getByTestId("changed-banner")).getByRole("button", {
      name: "Discard my changes and reload",
    })
  ).toBeInTheDocument();
});

test("a_watch_that_cannot_be_set_is_said_in_the_editor", async () => {
  ipc.watchDir.mockRejectedValue(wireError("Io", "no inotify watches left"));
  render(<Window />);
  const banner = await screen.findByTestId("watch-banner");
  expect(banner).toHaveTextContent(/will not notice/);
  expect(banner).toHaveTextContent(/no inotify watches left/);
});

test("save_as_asks_for_a_path_and_creates_a_new_file_only_if_nothing_is_there", async () => {
  const { view, content } = await mount();
  act(() => view.dispatch({ changes: { from: 0, insert: "mine " } }));
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  const field = within(dialog).getByRole("textbox");
  expect(field).toHaveValue("/home/a/notes.txt");
  fireEvent.change(field, { target: { value: "~/copy.txt" } });
  ipc.textOpen.mockResolvedValue(opened({ path: p("/home/a/copy.txt"), stamp: S1 }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(ipc.textSave).toHaveBeenCalledTimes(1));
  expect(ipc.textSave).toHaveBeenCalledWith(
    p("/home/a/copy.txt"),
    "mine hello\nworld",
    "lf",
    false,
    { kind: "nothing" }
  );
  await waitFor(() => expect(screen.queryByTestId("save-as-dialog")).toBeNull());
  // The tab follows the new file.
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: p("/home/a/copy.txt"), dirty: false });
  expect(screen.getByTestId("status-bar")).toHaveTextContent("/home/a/copy.txt");
});

test("save_as_onto_an_existing_file_says_what_is_lost_and_waits_for_replace", async () => {
  const { content } = await mount();
  ipc.entryOf.mockResolvedValue({
    path: p("/home/a/other.txt"),
    name: "other.txt",
    kind: "file",
    len: 2048,
    modified_ms: Date.now(),
  });
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "/home/a/other.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const replace = await screen.findByTestId("replace-prompt");
  expect(replace).toHaveTextContent("/home/a/other.txt");
  expect(replace).toHaveTextContent("2 KB");
  expect(replace).toHaveTextContent(/what it holds now is lost/);
  // Nothing was written, and the question opens on the choice that writes nothing.
  expect(ipc.textSave).not.toHaveBeenCalled();
  expect(within(replace).getByRole("button", { name: "Choose another name" })).toHaveFocus();

  ipc.textOpen.mockResolvedValue(opened({ path: p("/home/a/other.txt"), stamp: S1 }));
  fireEvent.click(within(replace).getByRole("button", { name: "Replace" }));
  await waitFor(() => expect(ipc.textSave).toHaveBeenCalledTimes(1));
  expect(ipc.textSave.mock.calls[0]![0]).toEqual(p("/home/a/other.txt"));
  expect(ipc.textSave.mock.calls[0]![4]).toEqual({ kind: "anything" });
});

test("replace_asks_again_with_the_new_facts_when_the_target_changed_since", async () => {
  const { content } = await mount();
  const shown = {
    path: p("/home/a/other.txt"),
    name: "other.txt",
    kind: "file",
    len: 2048,
    modified_ms: 1000,
  };
  ipc.entryOf.mockResolvedValue(shown);
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "/home/a/other.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await screen.findByTestId("replace-prompt");
  // Another program rewrote it while the question was open.
  ipc.entryOf.mockResolvedValue({ ...shown, len: 4096, modified_ms: 2000 });
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));
  await waitFor(() =>
    expect(screen.getByTestId("replace-prompt")).toHaveTextContent(
      "It changed since you were asked. This is what is there now."
    )
  );
  expect(screen.getByTestId("replace-prompt")).toHaveTextContent("4 KB");
  expect(ipc.textSave).not.toHaveBeenCalled();
});

test("save_as_cancelled_at_the_replace_question_writes_nothing", async () => {
  const { content } = await mount();
  ipc.entryOf.mockResolvedValue({
    path: p("/home/a/other.txt"),
    name: "other.txt",
    kind: "file",
    len: 1,
    modified_ms: null,
  });
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "/home/a/other.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const replace = await screen.findByTestId("replace-prompt");
  fireEvent.click(within(replace).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByTestId("replace-prompt")).toBeNull());
  expect(ipc.textSave).not.toHaveBeenCalled();
  expect(useTabs.getState().tabs[0]).toMatchObject({ path: FILE });
});

test("save_as_refuses_a_relative_path_in_the_dialog", async () => {
  const { content } = await mount();
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "copy.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(/absolute path/);
  expect(ipc.textSave).not.toHaveBeenCalled();
});

test("save_as_is_the_way_out_of_a_read_only_file", async () => {
  ipc.textOpen.mockResolvedValue(opened({ read_only: { kind: "NotUtf8", detail: "from byte 3" } }));
  const { content } = await mount();
  key(content, "s", { ctrlKey: true });
  await Promise.resolve();
  expect(ipc.textSave).not.toHaveBeenCalled();
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  expect(dialog).toHaveTextContent(/lossy copy/);
});

test("save_as_into_a_file_open_in_another_window_says_where_and_offers_to_show_it", async () => {
  const { content } = await mount();
  ipc.docOpenElsewhere.mockResolvedValue({
    state: "elsewhere",
    location: { kind: "tab", window: "editor-1", tab_id: "t7" },
  });
  ipc.openPaths.mockResolvedValue([
    { path: p("/home/a/other.txt"), action: "focus", location: null, error: null },
  ]);
  key(content, "s", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByTestId("save-as-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "/home/a/other.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  const note = await within(dialog).findByTestId("open-elsewhere");
  expect(note).toHaveTextContent("other.txt is open in a tab of an editor window");
  expect(note).toHaveTextContent(/never writes over a file that is open/);
  // Nothing was written, and there is no Replace to choose.
  expect(ipc.textSave).not.toHaveBeenCalled();
  expect(screen.queryByTestId("replace-prompt")).toBeNull();
  fireEvent.click(within(note).getByRole("button", { name: "Show it there" }));
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledWith([p("/home/a/other.txt")], "inside")
  );
});
