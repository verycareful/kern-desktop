// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import type { OpDoneEvent, Settings, WireEntry, WireError, WirePath, WireReport } from "../ipc";
import { useShortcuts } from "../keys/useShortcuts";
import { OpsHost } from "../ops/OpsHost";
import { useOps } from "../ops/useOps";
import { activeTab, useTabs, type FolderTab } from "../store/tabs";
import { folderController } from "./folder-controller";
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
  clipClearIf: vi.fn(),
  webviewWidth: vi.fn(),
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

/** `ops` adds the window's dialogs for operations; `strip` a pane beside the view, like the Places strip. */
function Host(props: { tab: FolderTab; ops?: boolean; strip?: boolean }) {
  useShortcuts();
  const tab = useTabs((s) => activeTab(s)) as FolderTab | null;
  return (
    <>
      {props.strip && (
        <nav aria-label="Strip">
          <button type="button">Strip button</button>
        </nav>
      )}
      <FolderView key={props.tab.id} tab={tab ?? props.tab} />
      {props.ops && <OpsHost />}
    </>
  );
}

async function mount(
  entries: WireEntry[],
  path: string | WirePath = "/d",
  extra: { ops?: boolean; strip?: boolean } = {}
) {
  ipc.listDir.mockResolvedValue(entries);
  useTabs.setState({ tabs: [], activeId: null });
  useTabs.getState().openFolder(typeof path === "string" ? p(path) : path, false);
  const tab = activeTab(useTabs.getState()) as FolderTab;
  render(<Host tab={tab} {...extra} />);
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
  ipc.clipClearIf.mockResolvedValue(true);
  ipc.answerConflict.mockResolvedValue(undefined);
  ipc.cancelOp.mockResolvedValue(undefined);
  // One CSS pixel per physical pixel unless a test says otherwise.
  ipc.webviewWidth.mockImplementation(() => Promise.resolve(window.innerWidth));
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

// ---- the selection and nothing else, through the controller as well as the keys ----

// A menu entry is greyed by the selection, but the controller is what runs: each of its file
// operations must itself take the selection and never the outlined item.

/** Focuses the list so the first row is outlined, with nothing selected. */
async function outlineOnly(entries: WireEntry[]) {
  const tab = await mount(entries);
  act(() => screen.getByTestId("folder-list").focus());
  expect(rows()[0]).toHaveClass("kern-cursor");
  expect(rows()[0]).toHaveAttribute("aria-selected", "false");
  return folderController(tab.id)!;
}

test("trash_takes_no_outlined_item", async () => {
  const c = await outlineOnly([entry("a"), entry("b")]);
  act(() => c.trash());
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("delete_for_good_asks_about_no_outlined_item", async () => {
  const c = await outlineOnly([entry("a"), entry("b")]);
  act(() => c.askDelete());
  await act(async () => {});
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("copy_puts_no_outlined_item_on_the_clipboard", async () => {
  const c = await outlineOnly([entry("a"), entry("b")]);
  act(() => c.copy());
  await act(async () => {});
  expect(ipc.clipSet).not.toHaveBeenCalled();
});

test("cut_puts_no_outlined_item_on_the_clipboard", async () => {
  const c = await outlineOnly([entry("a"), entry("b")]);
  act(() => c.cut());
  await act(async () => {});
  expect(ipc.clipSet).not.toHaveBeenCalled();
});

test("rename_edits_no_outlined_item", async () => {
  const c = await outlineOnly([entry("a"), entry("b")]);
  expect(c.canRename()).toBe(false);
  act(() => c.rename());
  await act(async () => {});
  expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
});

test("the_controller_acts_on_the_selection_when_there_is_one", async () => {
  const tab = await mount([entry("a"), entry("b")]);
  select("b");
  const c = folderController(tab.id)!;
  act(() => c.trash());
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("trash", [p("/d/b")], undefined));
  act(() => c.copy());
  await waitFor(() => expect(ipc.clipSet).toHaveBeenCalledWith("copy", [p("/d/b")]));
  act(() => c.cut());
  await waitFor(() => expect(ipc.clipSet).toHaveBeenLastCalledWith("cut", [p("/d/b")]));
  act(() => c.askDelete());
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("b");
});

// ---- a dialog that takes the focus does not apply a half-typed name ----

/** A name conflict of another operation, delivered the way the plugin does. */
async function conflictOfAnotherOperation() {
  ipc.startOp.mockResolvedValueOnce(7);
  act(() => {
    void useOps.getState().start({ kind: "copy", sources: [p("/x/f")], dest: p("/e") });
  });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() =>
    handlers["kernkraft://op-conflict"]!({
      op: 7,
      conflict: 1,
      source: p("/x/f"),
      existing: p("/e/f"),
      source_entry: null,
      existing_entry: null,
    })
  );
  return screen.findByRole("alertdialog", { name: "Name already taken" });
}

test("a_conflict_of_another_operation_does_not_apply_a_half_typed_name_and_the_edit_comes_back", async () => {
  await mount([entry("a"), entry("b")], "/d", { ops: true });
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: "half" } });
  const dialog = await conflictOfAnotherOperation();
  expect(dialog).toBeInTheDocument();
  expect(ipc.rename).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  const again = screen.getByRole("textbox", { name: /rename/i });
  expect(again).toHaveValue("half");
  expect(again).toHaveFocus();
  expect(ipc.rename).not.toHaveBeenCalled();
  // The edit is still the user's: Enter applies it now.
  ipc.rename.mockResolvedValue(p("/d/half"));
  fireEvent.keyDown(again, { key: "Enter" });
  await waitFor(() => expect(ipc.rename).toHaveBeenCalledExactlyOnceWith(p("/d/a"), "half"));
});

test("a_report_of_another_operation_does_not_apply_a_half_typed_name", async () => {
  await mount([entry("a")], "/d", { ops: true });
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: "half" } });
  act(() => {
    useOps.getState().report({ title: "Copy of x", report: null, error: err("Io", "disk full") });
  });
  expect(await screen.findByRole("dialog", { name: /Report/ })).toBeInTheDocument();
  expect(ipc.rename).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: /rename/i })).toHaveValue("half");
  expect(screen.getByRole("textbox", { name: /rename/i })).toHaveFocus();
});

test("a_drop_question_does_not_apply_a_half_typed_name_and_the_edit_comes_back", async () => {
  await mount([entry("a")]);
  hover(() => null);
  select("a");
  key("F2");
  const input = await screen.findByRole("textbox", { name: /rename/i });
  fireEvent.change(input, { target: { value: "half" } });
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => handlers["kern://drop"]!({ paths: [p("/x/f")], position: { x: 1, y: 1 } }));
  const ask = await screen.findByRole("alertdialog", { name: "Copy or move" });
  expect(ipc.rename).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: /rename/i })).toHaveValue("half");
  expect(screen.getByRole("textbox", { name: /rename/i })).toHaveFocus();
  expect(ipc.rename).not.toHaveBeenCalled();
});

// ---- a drag follows the item that was pressed, not the index it had ----

test("a_relist_between_the_press_and_the_drag_drags_the_pressed_item", async () => {
  const tab = await mount([dir("sub"), entry("a"), entry("b"), entry("c")]);
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("c"), { clientX: 10, clientY: 10 });
  // A file appears above the pressed one: every index after it moves by one.
  ipc.listDir.mockResolvedValue([dir("sub"), entry("0new"), entry("a"), entry("b"), entry("c")]);
  act(() => handlers["kernkraft://dir-changed"]!({ key: tab.id }));
  await waitFor(() => expect(rowNamed("0new")).toBeDefined());
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/d/c")], p("/d/sub"));
  expect(rowNamed("c")).toHaveAttribute("aria-selected", "true");
});

test("a_selected_item_is_found_by_its_path_when_the_indices_moved", async () => {
  const tab = await mount([dir("sub"), entry("a"), entry("b"), entry("c")]);
  select("a", "b");
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("a"), { clientX: 10, clientY: 10 });
  ipc.listDir.mockResolvedValue([dir("sub"), entry("0new"), entry("a"), entry("b"), entry("c")]);
  act(() => handlers["kernkraft://dir-changed"]!({ key: tab.id }));
  await waitFor(() => expect(rowNamed("0new")).toBeDefined());
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  // The selection is a and b whatever their indices are now; the new file is not part of it.
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledTimes(1));
  expect(ipc.startOp).toHaveBeenCalledWith("copy", [p("/d/a"), p("/d/b")], p("/d/sub"));
});

test("an_item_that_went_away_before_the_drag_began_drags_nothing", async () => {
  const tab = await mount([dir("sub"), entry("a"), entry("b")]);
  hover(() => rowNamed("sub"));
  pointer("pointerDown", rowNamed("b"), { clientX: 10, clientY: 10 });
  ipc.listDir.mockResolvedValue([dir("sub"), entry("a")]);
  act(() => handlers["kernkraft://dir-changed"]!({ key: tab.id }));
  await waitFor(() => expect(rows()).toHaveLength(2));
  pointer("pointerMove", window, { clientX: 40, clientY: 40 });
  pointer("pointerUp", window, { clientX: 40, clientY: 40, ctrlKey: true });
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

// ---- a cut that was pasted is cleared from the clipboard ----

/** Pastes a cut of `paths` and ends the move with `report`. */
async function pasteCutThatEnds(paths: WirePath[], report: Partial<WireReport>) {
  await mount([entry("a")]);
  ipc.clipGet.mockResolvedValue({ op: "cut", paths });
  key("v", { ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() => handlers["kernkraft://op-done"]!(done(1, report)));
}

test("a_cut_that_moved_everything_is_cleared_from_the_clipboard_if_it_is_still_that_cut", async () => {
  const paths = [p("/o/x"), p("/o/y")];
  await pasteCutThatEnds(paths, {
    done: paths.map((s) => ({ source: s, dest: p(`/d/${s.v.slice(3)}`) })),
  });
  await waitFor(() => expect(ipc.clipClearIf).toHaveBeenCalledExactlyOnceWith("cut", paths));
});

test.each([
  ["a_failure", { failed: [{ path: p("/o/y"), error: err("Io", "no") }] }],
  ["a_skipped_item", { skipped: [p("/o/y")] }],
  ["a_cancel", { cancelled: true, not_reached: [p("/o/y")] }],
])("a_cut_that_left_%s_stays_on_the_clipboard_to_be_pasted_again", async (_name, report) => {
  const paths = [p("/o/x"), p("/o/y")];
  await pasteCutThatEnds(paths, { done: [{ source: p("/o/x"), dest: p("/d/x") }], ...report });
  await act(async () => {});
  expect(ipc.clipClearIf).not.toHaveBeenCalled();
});

test("a_copy_is_never_cleared", async () => {
  await mount([entry("a")]);
  ipc.clipGet.mockResolvedValue({ op: "copy", paths: [p("/o/x")] });
  key("v", { ctrlKey: true });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  act(() =>
    handlers["kernkraft://op-done"]!(done(1, { done: [{ source: p("/o/x"), dest: p("/d/x") }] }))
  );
  await act(async () => {});
  expect(ipc.clipClearIf).not.toHaveBeenCalled();
});

test("a_clipboard_that_cannot_be_cleared_is_shown", async () => {
  ipc.clipClearIf.mockRejectedValue(err("NoFocus", "Kern's window does not have focus"));
  await pasteCutThatEnds([p("/o/x")], { done: [{ source: p("/o/x"), dest: p("/d/x") }] });
  expect(await screen.findByRole("alert")).toHaveTextContent("NoFocus");
});

// ---- where a drop from another application lands ----

test("the_position_of_a_drop_is_scaled_by_the_webviews_own_size_against_the_window_width", async () => {
  await mount([dir("sub"), entry("a")]);
  // The webview is 1.25 times as many physical pixels wide as the page is CSS pixels wide.
  ipc.webviewWidth.mockResolvedValue(window.innerWidth * 1.25);
  const at = vi.fn(() => rowNamed("sub"));
  hover(at);
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => handlers["kern://drop"]!({ paths: [p("/x/f")], position: { x: 100, y: 50 } }));
  await screen.findByRole("alertdialog", { name: "Copy or move" });
  expect(at).toHaveBeenCalledWith(80, 40);
  expect(screen.getByRole("alertdialog")).toHaveTextContent("into sub?");
});

test("a_drop_whose_scale_cannot_be_measured_says_so_and_lands_in_the_folder_not_on_a_guess", async () => {
  await mount([dir("sub"), entry("a")]);
  ipc.webviewWidth.mockRejectedValue(err("Webview", "no size"));
  hover(() => rowNamed("sub"));
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => handlers["kern://drop"]!({ paths: [p("/x/f")], position: { x: 100, y: 50 } }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Webview: no size");
  const ask = await screen.findByRole("alertdialog", { name: "Copy or move" });
  expect(ask).toHaveTextContent("into d?");
});

// ---- a question that is replaced says so ----

test("a_drop_that_replaces_an_open_question_says_so", async () => {
  await mount([entry("a")]);
  hover(() => null);
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => handlers["kern://drop"]!({ paths: [p("/x/f")], position: { x: 1, y: 1 } }));
  await screen.findByRole("alertdialog");
  expect(useOps.getState().notice).toBeNull();
  act(() => handlers["kern://drop"]!({ paths: [p("/x/g")], position: { x: 1, y: 1 } }));
  await waitFor(() => expect(useOps.getState().notice?.text).toMatch(/replaced/i));
  expect(useOps.getState().notice?.text).toContain("Move or copy f into d");
});

test("a_drop_that_replaces_a_delete_question_says_which_delete_was_dropped", async () => {
  await mount([entry("a"), entry("b")]);
  hover(() => null);
  select("a");
  key("Delete", { shiftKey: true });
  await screen.findByRole("alertdialog", { name: "Delete permanently" });
  await waitFor(() => expect(handlers["kern://drop"]).toBeDefined());
  act(() => handlers["kern://drop"]!({ paths: [p("/x/g")], position: { x: 1, y: 1 } }));
  await waitFor(() => expect(useOps.getState().notice?.text).toMatch(/replaced/i));
  expect(useOps.getState().notice?.text).toContain("Delete a for good");
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("the_first_question_leaves_no_notice", async () => {
  await mount([entry("a")]);
  select("a");
  key("Delete", { shiftKey: true });
  await screen.findByRole("alertdialog");
  expect(useOps.getState().notice).toBeNull();
});

// ---- the file keys belong to the folder view ----

test("file_keys_do_nothing_while_the_focus_is_in_a_pane_beside_the_view", async () => {
  await mount([entry("a"), entry("b")], "/d", { strip: true });
  select("a");
  const strip = screen.getByRole("button", { name: "Strip button" });
  strip.focus();
  fireEvent.keyDown(strip, { key: "Delete" });
  fireEvent.keyDown(strip, { key: "Delete", shiftKey: true });
  fireEvent.keyDown(strip, { key: "c", ctrlKey: true });
  fireEvent.keyDown(strip, { key: "x", ctrlKey: true });
  fireEvent.keyDown(strip, { key: "v", ctrlKey: true });
  fireEvent.keyDown(strip, { key: "F2" });
  fireEvent.keyDown(strip, { key: "N", ctrlKey: true, shiftKey: true });
  await act(async () => {});
  expect(ipc.startOp).not.toHaveBeenCalled();
  expect(ipc.clipSet).not.toHaveBeenCalled();
  expect(ipc.clipGet).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("textbox", { name: /rename/i })).toBeNull();
  // The same keys act once the focus is in the view.
  fireEvent.keyDown(screen.getByTestId("folder-list"), { key: "Delete" });
  await waitFor(() => expect(ipc.startOp).toHaveBeenCalledWith("trash", [p("/d/a")], undefined));
});

test("a_key_in_the_pane_is_left_to_the_pane", async () => {
  await mount([entry("a")], "/d", { strip: true });
  select("a");
  const strip = screen.getByRole("button", { name: "Strip button" });
  const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
  strip.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

test("undo_and_redo_are_not_tied_to_the_view", async () => {
  await mount([entry("a")], "/d", { strip: true });
  useOps.setState({ undoLabel: "Undo trash of a" });
  ipc.undo.mockResolvedValue({ done: [], warnings: [] });
  const strip = screen.getByRole("button", { name: "Strip button" });
  fireEvent.keyDown(strip, { key: "z", ctrlKey: true });
  await waitFor(() => expect(ipc.undo).toHaveBeenCalledTimes(1));
});

// ---- Delete permanently lists every item it was asked about ----

test("a_long_delete_question_has_a_show_all_that_lists_every_item", async () => {
  const names = ["a", "b", "c", "d", "e"];
  await mount(names.map((n) => entry(n)));
  select(...names);
  key("Delete", { shiftKey: true });
  const ask = await screen.findByRole("alertdialog", { name: "Delete permanently" });
  const summary = within(ask).getByText("Show all 5 items");
  const details = summary.closest("details")!;
  expect(details).not.toHaveAttribute("open");
  expect(details.querySelectorAll("li")).toHaveLength(0);
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect([...details.querySelectorAll("li")].map((li) => li.textContent)).toEqual(names);
});

test("a_short_delete_question_names_its_items_and_has_no_disclosure", async () => {
  await mount([entry("a"), entry("b")]);
  select("a", "b");
  key("Delete", { shiftKey: true });
  const ask = await screen.findByRole("alertdialog", { name: "Delete permanently" });
  expect(ask.querySelector("details")).toBeNull();
  expect(ask).toHaveTextContent("a, b");
});

test("the_disclosure_lists_the_frozen_items_not_the_current_selection", async () => {
  const names = ["a", "b", "c", "d", "e", "f"];
  await mount(names.map((n) => entry(n)));
  select(...names.slice(0, 5));
  key("Delete", { shiftKey: true });
  const ask = await screen.findByRole("alertdialog");
  fireEvent.click(rowNamed("f"));
  const details = within(ask).getByText("Show all 5 items").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect([...details.querySelectorAll("li")].map((li) => li.textContent)).toEqual(
    names.slice(0, 5)
  );
});
