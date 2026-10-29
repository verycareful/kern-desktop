// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import type { OpDoneEvent, Settings, WireEntry, WireError, WirePath, WireReport } from "../ipc";
import { useShortcuts } from "../keys/useShortcuts";
import { useOps } from "../ops/useOps";
import { activeTab, useTabs, type FolderTab } from "../store/tabs";
import { useFolderStatus } from "./folder-status";
import { useFolderUi } from "./folder-ui";
import { useViewSettings } from "./view-settings";
import { dir, entry } from "./test-entries";
import { stubLayout } from "./test-layout";

// The file operations of a folder view (design 5.1, 5.7, 5.8): they act on the
// selection and nothing else, ask before deleting for good, edit names in
// place, create, paste and take drops.

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  on: vi.fn(),
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  openPaths: vi.fn(),
  thumbRequest: vi.fn(),
  thumbCancel: vi.fn(),
  userDirs: vi.fn(),
  startOp: vi.fn(),
  answerConflict: vi.fn(),
  cancelOp: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  undoState: vi.fn(),
  createDir: vi.fn(),
  createFile: vi.fn(),
  rename: vi.fn(),
  clipSet: vi.fn(),
  clipGet: vi.fn(),
  dragOut: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  ...ipc,
  assetUrl: (f: { v: string }) => `asset://${f.v}`,
}));

import { FolderView } from "./FolderView";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const SETTINGS = { show_hidden: false, view_mode: "list", density: "cozy" } as Settings;
const err = (kind: string, message = kind): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

let handlers: Record<string, (payload: unknown) => void>;
let restoreLayout: () => void;
let hasFocus: MockInstance<() => boolean>;

function Host(props: { tab: FolderTab }) {
  useShortcuts();
  const tab = useTabs((s) => activeTab(s)) as FolderTab | null;
  return <FolderView key={props.tab.id} tab={tab ?? props.tab} />;
}

async function mount(entries: WireEntry[], path: string | WirePath = "/d") {
  ipc.listDir.mockResolvedValue(entries);
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(typeof path === "string" ? p(path) : path, false);
  const tab = activeTab(useTabs.getState()) as FolderTab;
  render(<Host tab={tab} />);
  await waitFor(() =>
    expect(
      screen.queryByTestId("folder-list") ?? screen.queryByTestId("folder-empty")
    ).not.toBeNull()
  );
  if (entries.length > 0) {
    await waitFor(() => expect(screen.queryAllByTestId("file-row").length).toBeGreaterThan(0));
  }
  return tab;
}

const rows = () => screen.getAllByTestId("file-row");
const rowNamed = (name: string) => rows().find((r) => r.getAttribute("data-name") === name)!;
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: k, ...init });
/** Selects the rows with these names. */
const select = (...names: string[]) => {
  names.forEach((n, i) => fireEvent.click(rowNamed(n), { ctrlKey: i > 0 }));
};
const done = (op: number, report: Partial<WireReport> = {}): OpDoneEvent => ({
  op,
  report: {
    done: [],
    skipped: [],
    failed: [],
    warnings: [],
    cancelled: false,
    not_reached: [],
    ...report,
  },
  properties: null,
  scan: null,
  error: null,
});

beforeEach(() => {
  restoreLayout = stubLayout();
  hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  handlers = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    handlers[name] = h;
    return Promise.resolve(() => undefined);
  });
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  ipc.settingsSet.mockImplementation((patch: Partial<Settings>) =>
    Promise.resolve({ ...SETTINGS, ...patch })
  );
  ipc.thumbRequest.mockResolvedValue(undefined);
  ipc.thumbCancel.mockResolvedValue(undefined);
  ipc.userDirs.mockResolvedValue({ home: p("/home/u"), dirs: [] });
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  ipc.startOp.mockResolvedValue(1);
  ipc.clipSet.mockResolvedValue(undefined);
  ipc.dragOut.mockResolvedValue(undefined);
  useViewSettings.setState({ loaded: false, error: null });
  useFolderUi.setState({ sort: {} });
  useFolderStatus.setState({ byTab: {} });
  useOps.getState().reset();
});

afterEach(async () => {
  cleanup();
  hasFocus.mockRestore();
  await Promise.resolve();
  restoreLayout();
  for (const m of Object.values(ipc)) m.mockReset();
});

// ---- the selection, and only the selection ----

test("keys_that_act_on_files_do_nothing_when_an_item_is_only_outlined", async () => {
  await mount([entry("a"), entry("b")]);
  act(() => screen.getByTestId("folder-list").focus());
  // The first row is outlined, nothing is selected.
  expect(rowNamed("a")).toHaveClass("kern-cursor");
  expect(rowNamed("a")).toHaveAttribute("aria-selected", "false");
  key("Delete");
  key("Delete", { shiftKey: true });
  key("c", { ctrlKey: true });
  key("x", { ctrlKey: true });
  key("F2");
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(ipc.clipSet).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
});

test("the_file_actions_are_greyed_in_the_menu_when_only_an_item_is_outlined", async () => {
  await mount([entry("a")]);
  act(() => screen.getByTestId("folder-list").focus());
  fireEvent.contextMenu(screen.getByTestId("folder-scroll"));
  const menu = await screen.findByTestId("action-menu");
  for (const name of [/^Cut/, /^Copy/, /^Rename/, /^Move to Trash/, /^Delete permanently/]) {
    expect(within(menu).getByRole("menuitem", { name })).toBeDisabled();
  }
  // Creating and pasting need no selection.
  expect(within(menu).getByRole("menuitem", { name: /^New folder/ })).toBeEnabled();
  expect(within(menu).getByRole("menuitem", { name: /^Paste/ })).toBeEnabled();
});

test("delete_moves_the_selected_items_to_the_trash_without_asking", async () => {
  await mount([entry("a"), entry("b"), entry("c")]);
  select("a", "c");
  key("Delete");
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("trash", [p("/d/a"), p("/d/c")], undefined);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("shift_delete_asks_names_the_items_and_says_it_cannot_be_undone", async () => {
  await mount([entry("a"), entry("b")]);
  select("a", "b");
  key("Delete", { shiftKey: true });
  const ask = await screen.findByRole("alertdialog", { name: "Delete permanently" });
  expect(ask).toHaveTextContent("a, b");
  expect(ask).toHaveTextContent(/cannot be undone/i);
  expect(ipc.startOp).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Delete 2 items" }));
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("delete", [p("/d/a"), p("/d/b")], undefined);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("the_delete_question_is_about_the_items_it_named_whatever_is_selected_later", async () => {
  await mount([entry("a"), entry("b"), entry("c")]);
  select("a");
  key("Delete", { shiftKey: true });
  const ask = await screen.findByRole("alertdialog");
  // The selection moves to another item while the question is open.
  fireEvent.click(rowNamed("c"));
  expect(rowNamed("c")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(within(ask).getByRole("button", { name: "Delete 1 item" }));
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("delete", [p("/d/a")], undefined);
});

test("cancel_and_escape_answer_no_to_a_permanent_delete", async () => {
  await mount([entry("a")]);
  select("a");
  key("Delete", { shiftKey: true });
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  key("Delete", { shiftKey: true });
  await screen.findByRole("alertdialog");
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(ipc.startOp).not.toHaveBeenCalled();
});

// ---- clipboard ----

test("copy_and_cut_put_the_selected_items_on_the_system_clipboard", async () => {
  await mount([entry("a"), entry("b")]);
  select("a", "b");
  key("c", { ctrlKey: true });
  await waitFor(() => expect(ipc.clipSet).toHaveBeenCalledWith("copy", [p("/d/a"), p("/d/b")]));
  expect(useOps.getState().notice?.text).toBe("Copied 2 items to the clipboard");
  key("x", { ctrlKey: true });
  await waitFor(() => expect(ipc.clipSet).toHaveBeenLastCalledWith("cut", [p("/d/a"), p("/d/b")]));
  expect(useOps.getState().notice?.text).toBe("Cut 2 items to the clipboard");
  // Neither takes anything away.
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("a_clipboard_that_cannot_be_written_is_shown", async () => {
  await mount([entry("a")]);
  ipc.clipSet.mockRejectedValue(err("NoFocus", "Kern's window does not have focus"));
  select("a");
  key("c", { ctrlKey: true });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "NoFocus: Kern's window does not have focus"
  );
});

test("paste_copies_the_clipboard_files_into_the_folder", async () => {
  await mount([entry("a")]);
  ipc.clipGet.mockResolvedValue({ op: "copy", paths: [p("/other/x"), p("/other/y")] });
  key("v", { ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/other/x"), p("/other/y")], p("/d"));
});

test("paste_after_a_cut_moves_them", async () => {
  await mount([entry("a")]);
  ipc.clipGet.mockResolvedValue({ op: "cut", paths: [p("/other/x")] });
  key("v", { ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("move", [p("/other/x")], p("/d")));
});

test("paste_with_no_files_on_the_clipboard_says_so", async () => {
  await mount([entry("a")]);
  ipc.clipGet.mockResolvedValue(null);
  key("v", { ctrlKey: true });
  await waitFor(() => expect(useOps.getState().notice?.text).toBe("The clipboard holds no files."));
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("a_clipboard_that_cannot_be_read_is_shown", async () => {
  await mount([entry("a")]);
  ipc.clipGet.mockRejectedValue(err("Clipboard", "the clipboard's text/uri-list is not usable"));
  key("v", { ctrlKey: true });
  expect(await screen.findByRole("alert")).toHaveTextContent("not usable");
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("what_was_pasted_is_selected_once_the_folder_lists_it", async () => {
  await mount([entry("a")]);
  ipc.clipGet.mockResolvedValue({ op: "copy", paths: [p("/other/x")] });
  key("v", { ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalled());
  await waitFor(() => expect(handlers["kernkraft://op-done"]).toBeDefined());
  await act(async () => {});
  ipc.listDir.mockResolvedValue([entry("a"), entry("x")]);
  act(() => {
    handlers["kernkraft://op-done"]!(
      done(1, { done: [{ source: p("/other/x"), dest: p("/d/x") }] })
    );
  });
  await waitFor(() => expect(rowNamed("x")).toHaveAttribute("aria-selected", "true"));
  expect(rowNamed("a")).toHaveAttribute("aria-selected", "false");
});

// ---- rename in place ----

test("f2_edits_the_name_in_place_and_renames_the_item_by_its_path", async () => {
  await mount([entry("notes.md"), entry("b")]);
  select("notes.md");
  key("F2");
  const input = (await screen.findByRole("textbox", {
    name: "Rename notes.md",
  })) as HTMLInputElement;
  expect(input).toHaveFocus();
  // The name without its extension is selected.
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, "notes".length]);
  ipc.rename.mockResolvedValue(p("/d/todo.md"));
  ipc.listDir.mockResolvedValue([entry("todo.md"), entry("b")]);
  fireEvent.change(input, { target: { value: "todo.md" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(ipc.rename).toHaveBeenCalledExactlyOnceWith(p("/d/notes.md"), "todo.md")
  );
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull());
  await waitFor(() => expect(rowNamed("todo.md")).toHaveAttribute("aria-selected", "true"));
});

test("a_folder_is_renamed_with_its_whole_name_selected", async () => {
  await mount([dir("v1.2")]);
  select("v1.2");
  key("F2");
  const input = (await screen.findByRole("textbox", { name: /rename/i })) as HTMLInputElement;
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, "v1.2".length]);
});

test("a_name_that_is_not_utf8_is_renamed_by_its_bytes", async () => {
  // "/d/bad<0xFF>.txt": the listing shows U+FFFD, the path holds the real byte.
  const raw: WirePath = { k: "Bytes", v: btoa("/d/bad\xff.txt") };
  await mount([entry("bad\ufffd.txt", { path: raw })]);
  select("bad\ufffd.txt");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  ipc.rename.mockResolvedValue(p("/d/good.txt"));
  fireEvent.change(input, { target: { value: "good.txt" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(ipc.rename).toHaveBeenCalledExactlyOnceWith(raw, "good.txt"));
});

test("the_replacement_character_of_a_name_that_is_not_utf8_cannot_be_typed_back", async () => {
  const raw: WirePath = { k: "Bytes", v: btoa("/d/bad\xff.txt") };
  await mount([entry("bad\ufffd.txt", { path: raw })]);
  select("bad\ufffd.txt");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: "bad\ufffd2.txt" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(/not text/);
  expect(ipc.rename).not.toHaveBeenCalled();
  // The editor stays open to be corrected.
  expect(screen.getByRole("textbox", { name: /rename/i })).toBeInTheDocument();
});

test("the_replacement_character_is_fine_when_only_a_folder_above_is_not_utf8", async () => {
  const raw: WirePath = { k: "Bytes", v: btoa("/\xf6/a.txt") };
  await mount([entry("a.txt", { path: raw })], { k: "Bytes", v: btoa("/\xf6") });
  select("a.txt");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  ipc.rename.mockResolvedValue(raw);
  fireEvent.change(input, { target: { value: "\ufffd.txt" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(ipc.rename).toHaveBeenCalledExactlyOnceWith(raw, "\ufffd.txt"));
});

test("an_unchanged_name_is_not_sent", async () => {
  await mount([entry("a")]);
  select("a");
  key("F2");
  fireEvent.keyDown(await screen.findByRole("textbox", { name: /rename/i }), { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull());
  expect(ipc.rename).not.toHaveBeenCalled();
});

test("escape_leaves_the_name_alone_and_gives_the_list_the_keyboard", async () => {
  await mount([entry("a")]);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: "zzz" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
  expect(ipc.rename).not.toHaveBeenCalled();
  expect(screen.getByTestId("folder-list")).toHaveFocus();
});

test.each([
  ["", /empty/i],
  ["a/b", /\//],
  ["..", /"\.\."/],
])("the_name_%j_is_refused_in_place", async (name, why) => {
  await mount([entry("a")]);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent(why);
  expect(ipc.rename).not.toHaveBeenCalled();
});

test("a_refusal_from_the_backend_is_shown_and_the_editor_stays_open", async () => {
  await mount([entry("a"), entry("b")]);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  ipc.rename.mockRejectedValue(err("Exists", "/d/b already exists"));
  fireEvent.change(input, { target: { value: "b" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Exists: /d/b already exists");
  expect(screen.getByRole("textbox", { name: /rename/i })).toHaveValue("b");
});

test("leaving_the_field_applies_the_name_unless_the_whole_window_lost_the_focus", async () => {
  await mount([entry("a")]);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: "c" } });
  ipc.rename.mockResolvedValue(p("/d/c"));
  hasFocus.mockReturnValue(false);
  fireEvent.blur(input);
  expect(ipc.rename).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: /rename/i })).toBeInTheDocument();
  hasFocus.mockReturnValue(true);
  fireEvent.blur(input);
  await waitFor(() => expect(ipc.rename).toHaveBeenCalledWith(p("/d/a"), "c"));
});

test("f2_needs_exactly_one_selected_item", async () => {
  await mount([entry("a"), entry("b")]);
  select("a", "b");
  key("F2");
  await act(async () => {});
  expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
});

test("the_keys_typed_in_the_name_field_are_the_fields_own", async () => {
  await mount([entry("a"), entry("b")]);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  for (const init of [
    { key: "Delete" },
    { key: "c", ctrlKey: true },
    { key: "z", ctrlKey: true },
    { key: "Enter" },
  ]) {
    if (init.key !== "Enter") fireEvent.keyDown(input, init);
  }
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(ipc.clipSet).not.toHaveBeenCalled();
  expect(ipc.undo).not.toHaveBeenCalled();
});

// ---- create ----

test("ctrl_shift_n_asks_for_a_name_and_creates_the_folder_and_selects_it", async () => {
  await mount([entry("a")]);
  key("N", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByRole("dialog", { name: "New folder" });
  const input = within(dialog).getByRole("textbox", { name: "Name" });
  expect(input).toHaveValue("New folder");
  ipc.createDir.mockResolvedValue(p("/d/docs"));
  ipc.listDir.mockResolvedValue([dir("docs"), entry("a")]);
  fireEvent.change(input, { target: { value: "docs" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(ipc.createDir).toHaveBeenCalledExactlyOnceWith(p("/d"), "docs"));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(rowNamed("docs")).toHaveAttribute("aria-selected", "true"));
});

test("new_file_is_in_the_context_menu_and_creates_an_empty_file", async () => {
  await mount([entry("a")]);
  fireEvent.contextMenu(screen.getByTestId("folder-scroll"));
  fireEvent.click(await screen.findByRole("menuitem", { name: /^New file/ }));
  const dialog = await screen.findByRole("dialog", { name: "New file" });
  ipc.createFile.mockResolvedValue(p("/d/New file"));
  fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Name" }), { key: "Enter" });
  await waitFor(() => expect(ipc.createFile).toHaveBeenCalledExactlyOnceWith(p("/d"), "New file"));
});

test("a_folder_that_is_not_utf8_is_created_in_through_its_path", async () => {
  const folder: WirePath = { k: "Bytes", v: btoa("/\xf6") };
  await mount([], folder);
  key("N", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByRole("dialog", { name: "New folder" });
  ipc.createDir.mockResolvedValue({ k: "Bytes", v: btoa("/\xf6/x") });
  fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Name" }), { key: "Enter" });
  await waitFor(() => expect(ipc.createDir).toHaveBeenCalledWith(folder, "New folder"));
});

test("a_name_the_backend_refuses_is_shown_in_the_dialog", async () => {
  await mount([entry("a")]);
  key("N", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByRole("dialog");
  ipc.createDir.mockRejectedValue(err("Exists", "/d/New folder already exists"));
  fireEvent.keyDown(within(dialog).getByRole("textbox", { name: "Name" }), { key: "Enter" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("already exists");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("the_shortcuts_behind_the_new_name_dialog_do_not_fire", async () => {
  await mount([entry("a")]);
  select("a");
  key("N", { ctrlKey: true, shiftKey: true });
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByRole("textbox", { name: "Name" });
  fireEvent.keyDown(input, { key: "Delete" });
  fireEvent.keyDown(dialog, { key: "F2" });
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
});

// ---- undo and redo ----

test("ctrl_z_undoes_and_ctrl_y_and_ctrl_shift_z_redo", async () => {
  await mount([entry("a")]);
  useOps.setState({ undoLabel: "Undo trash of a", redoLabel: "Redo copy of b" });
  ipc.undo.mockResolvedValue({ done: [p("/d/a")], warnings: [] });
  ipc.redo.mockResolvedValue({ done: [p("/d/b")], warnings: [] });
  key("z", { ctrlKey: true });
  await waitFor(() => expect(ipc.undo).toHaveBeenCalledTimes(1));
  useOps.setState({ redoLabel: "Redo copy of b" });
  key("y", { ctrlKey: true });
  await waitFor(() => expect(ipc.redo).toHaveBeenCalledTimes(1));
  useOps.setState({ redoLabel: "Redo copy of b" });
  key("Z", { ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(ipc.redo).toHaveBeenCalledTimes(2));
});

test("with_nothing_to_undo_the_keys_do_nothing", async () => {
  await mount([entry("a")]);
  key("z", { ctrlKey: true });
  key("y", { ctrlKey: true });
  await act(async () => {});
  expect(ipc.undo).not.toHaveBeenCalled();
  expect(ipc.redo).not.toHaveBeenCalled();
});

test("the_edit_menu_names_what_undo_and_redo_would_do", async () => {
  await mount([entry("a")]);
  useOps.setState({ undoLabel: "Undo rename of notes.md", redoLabel: null });
  fireEvent.contextMenu(screen.getByTestId("folder-scroll"));
  const menu = await screen.findByTestId("action-menu");
  expect(within(menu).getByRole("menuitem", { name: /^Undo rename of notes\.md/ })).toBeEnabled();
  const redo = within(menu).getByRole("menuitem", { name: /^Redo/ });
  expect(redo).toBeDisabled();
  expect(redo).toHaveTextContent("Ctrl+Y");
});

test("undo_while_an_operation_runs_shows_the_busy_message", async () => {
  await mount([entry("a")]);
  useOps.setState({ undoLabel: "Undo copy of a" });
  ipc.undo.mockRejectedValue(err("Busy", "busy: a file operation is running"));
  key("z", { ctrlKey: true });
  await waitFor(() => expect(useOps.getState().notice?.text).toMatch(/while a file operation/));
});

// ---- dragging ----

function pointer(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  target: Element | Window,
  init: PointerEventInit
) {
  fireEvent[type](target, { button: 0, ...init });
}

/** Makes `elementFromPoint` answer with the element `at` names for the point. */
function hover(at: (x: number, y: number) => Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(at),
  });
}
afterEach(() => {
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

test("folder_rows_and_cards_are_drop_targets_and_files_are_not", async () => {
  await mount([dir("sub"), entry("a")]);
  expect(rowNamed("sub")).toHaveAttribute("data-drop-target");
  expect(rowNamed("a")).not.toHaveAttribute("data-drop-target");
});

test("ctrl_drag_onto_a_folder_copies_and_shift_drag_moves", async () => {
  await mount([dir("sub"), entry("a"), entry("b")]);
  select("a", "b");
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  expect(rowNamed("sub")).toHaveClass("kern-drop-over");
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenLastCalledWith("copy", [p("/d/a"), p("/d/b")], p("/d/sub"));
  expect(rowNamed("sub")).not.toHaveClass("kern-drop-over");

  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, shiftKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(2));
  expect(ipc.startOp).toHaveBeenLastCalledWith("move", [p("/d/a"), p("/d/b")], p("/d/sub"));
});

test("a_drag_with_no_modifier_asks_whether_to_move_or_copy_and_the_answer_decides", async () => {
  await mount([dir("sub"), entry("a")]);
  select("a");
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40 });
  const ask = await screen.findByRole("alertdialog", { name: "Copy or move" });
  expect(ask).toHaveTextContent("Move or copy a into sub?");
  expect(ipc.startOp).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Copy here" }));
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/d/a")], p("/d/sub")));
});

test("dragging_an_item_that_is_not_selected_drags_only_it", async () => {
  await mount([dir("sub"), entry("a"), entry("b")]);
  select("a");
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("b"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/d/b")], p("/d/sub")));
  expect(rowNamed("b")).toHaveAttribute("aria-selected", "true");
  expect(rowNamed("a")).toHaveAttribute("aria-selected", "false");
});

test("a_press_that_hardly_moves_is_not_a_drag", async () => {
  await mount([dir("sub"), entry("a")]);
  select("a");
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 12, clientY: 12 });
  pointer("pointerUp", window, { clientX: 12, clientY: 12, ctrlKey: true });
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("a_folder_cannot_be_dropped_on_itself_and_nothing_else_is_a_target", async () => {
  await mount([dir("sub"), entry("a")]);
  select("sub");
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("sub"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  expect(rowNamed("sub")).not.toHaveClass("kern-drop-over");
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  hover(() => rowNamed("a"));
  select("sub");
  pointer("pointerDown", rowNamed("sub"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("a_drag_that_leaves_the_window_becomes_a_native_drag_of_the_same_items", async () => {
  await mount([entry("a"), entry("b")]);
  select("a", "b");
  hover(() => null);
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerMove", window, { clientX: -3, clientY: 40 });
  await waitFor(() => expect(ipc.dragOut).toHaveBeenCalledExactlyOnceWith([p("/d/a"), p("/d/b")]));
  // Kern's own drag is over: letting go later drops nothing here.
  pointer("pointerUp", window, { clientX: -3, clientY: 40, ctrlKey: true });
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("a_native_drag_that_cannot_start_is_shown", async () => {
  await mount([entry("a")]);
  select("a");
  hover(() => null);
  ipc.dragOut.mockRejectedValue(err("Drag", "GTK would not start the drag"));
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerMove", window, { clientX: -3, clientY: 40 });
  expect(await screen.findByRole("alert")).toHaveTextContent("GTK would not start the drag");
});

test("the_press_on_the_name_field_while_renaming_starts_no_drag", async () => {
  await mount([entry("a")]);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  pointer("pointerDown", input, { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: -3, clientY: 40 });
  await act(async () => {});
  expect(ipc.dragOut).not.toHaveBeenCalled();
});

test("a_drop_from_another_application_asks_and_lands_on_the_folder_under_it", async () => {
  await mount([dir("sub"), entry("a")]);
  hover(() => rowNamed("sub"));
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  // The position is in physical pixels; the test's pixel ratio is 1 and the zoom 1.
  act(() => {
    handlers["kern://drop"]!({ paths: [p("/x/f"), p("/x/g")], position: { x: 40, y: 40 } });
  });
  const ask = await screen.findByRole("alertdialog", { name: "Copy or move" });
  expect(ask).toHaveTextContent("Move or copy f, g into sub?");
  fireEvent.click(within(ask).getByRole("button", { name: "Move here" }));
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledWith("move", [p("/x/f"), p("/x/g")], p("/d/sub"))
  );
});

test("a_drop_on_the_empty_part_of_the_view_lands_in_the_folder_itself", async () => {
  await mount([entry("a")]);
  hover(() => null);
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => {
    handlers["kern://drop"]!({ paths: [p("/x/f")], position: { x: 400, y: 400 } });
  });
  const ask = await screen.findByRole("alertdialog", { name: "Copy or move" });
  expect(ask).toHaveTextContent("into d?");
  fireEvent.click(within(ask).getByRole("button", { name: "Copy here" }));
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/x/f")], p("/d")));
});

test("a_second_drop_replaces_the_question_and_the_answer_is_about_what_the_question_names", async () => {
  await mount([entry("a")]);
  hover(() => null);
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => handlers["kern://drop"]!({ paths: [p("/x/f")], position: { x: 1, y: 1 } }));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("Move or copy f into d?");
  act(() => handlers["kern://drop"]!({ paths: [p("/x/other")], position: { x: 1, y: 1 } }));
  await waitFor(() =>
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Move or copy other into d?")
  );
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Copy here" })
  );
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/x/other")], p("/d"));
});

test("f2_edits_the_name_in_the_grid_too", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  ipc.listDir.mockResolvedValue([entry("notes.md")]);
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(p("/d"), false);
  render(<Host tab={activeTab(useTabs.getState()) as FolderTab} />);
  const card = await screen.findByTestId("file-card");
  fireEvent.click(card);
  key("F2");
  const input = (await screen.findByRole("textbox", {
    name: "Rename notes.md",
  })) as HTMLInputElement;
  expect(card).toContainElement(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, "notes".length]);
  ipc.rename.mockResolvedValue(p("/d/todo.md"));
  fireEvent.change(input, { target: { value: "todo.md" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(ipc.rename).toHaveBeenCalledWith(p("/d/notes.md"), "todo.md"));
});

test("folder_cards_are_drop_targets_in_the_grid", async () => {
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, view_mode: "grid" });
  ipc.listDir.mockResolvedValue([dir("sub"), entry("a")]);
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(p("/d"), false);
  render(<Host tab={activeTab(useTabs.getState()) as FolderTab} />);
  await screen.findAllByTestId("file-card");
  const byName = (n: string) =>
    screen.getAllByTestId("file-card").find((c) => c.getAttribute("data-name") === n)!;
  expect(byName("sub")).toHaveAttribute("data-drop-target");
  expect(byName("a")).not.toHaveAttribute("data-drop-target");
});

test("the_folders_above_the_one_on_show_are_drop_targets_in_the_breadcrumb", async () => {
  await mount([entry("a")], "/home/u/docs");
  const crumbs = screen.getByRole("navigation", { name: "Path" });
  const targets = [...crumbs.querySelectorAll("[data-drop-target]")].map((e) =>
    JSON.parse(e.getAttribute("data-drop-target")!)
  );
  expect(targets).toEqual([p("/"), p("/home"), p("/home/u")]);
});

test("an_item_dropped_on_a_breadcrumb_folder_goes_there", async () => {
  await mount([entry("a", {}, "/home/u/docs")], "/home/u/docs");
  select("a");
  const home = screen.getByRole("button", { name: "home" });
  hover(() => home);
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, shiftKey: true });
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledWith("move", [p("/home/u/docs/a")], p("/home"))
  );
});
