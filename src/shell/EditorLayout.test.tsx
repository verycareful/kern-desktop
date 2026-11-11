// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireEntry, WirePath } from "../ipc";
import { useBinds } from "../keys/binds";
import { entry } from "../files/test-entries";
import { stubLayout } from "../files/test-layout";
import { NO_LAYOUT, SETTINGS } from "../settings/test-settings";

const ipc = vi.hoisted(() => ({
  listDir: vi.fn(),
  watchDir: vi.fn(),
  unwatchDir: vi.fn(),
  fileIdentity: vi.fn(),
  openPaths: vi.fn(),
  openEditor: vi.fn(),
  layoutGet: vi.fn(),
  layoutSet: vi.fn(),
  settingsGet: vi.fn(),
  userDirs: vi.fn(),
  volumesList: vi.fn(),
  volumesProblemsTake: vi.fn(),
  on: vi.fn(),
  undoState: vi.fn(),
  prune: vi.fn(),
  pinsGet: vi.fn(),
  storeErrorsTake: vi.fn(),
  textOpen: vi.fn(),
  textCheck: vi.fn(),
  recentTouch: vi.fn(),
  docOpened: vi.fn(),
  docClosed: vi.fn(),
  docOpenElsewhere: vi.fn(),
  createFile: vi.fn(),
  createDir: vi.fn(),
  rename: vi.fn(),
  docMoved: vi.fn(),
  clipSet: vi.fn(),
  clipGet: vi.fn(),
  clipText: vi.fn(),
  startOp: vi.fn(),
  openTerminal: vi.fn(),
  search: vi.fn(),
  cancelOp: vi.fn(),
  settingsSet: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));
vi.mock("../files/sort-async", async () => {
  const { sortEntries } = await import("../files/sort");
  return {
    SORT_IN_WORKER_ABOVE: 5000,
    createSorter: () => ({
      sort: (e: WireEntry[], by: "name", dir: "asc") => Promise.resolve(sortEntries(e, by, dir)),
      dispose: () => undefined,
    }),
  };
});

import {
  actions,
  currentContext,
  findDuplicateBindings,
  getAction,
  isEnabled,
  runAction,
} from "../keys/actions";
import { useTreeHover } from "../files/tree-hover";
import { useTreeMenu } from "../files/tree-menu-store";
import { DEFAULT_TREE_SORT, useTreeSort } from "../files/tree-sort";
import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import { useViewSettings } from "../files/view-settings";
import { EDITOR_WINDOW_KEYS } from "./EditorWindow";
import MainWindow from "./MainWindow";
import { switchLayout } from "./layout-switch";
import { EMPTY_PRUNE } from "./test-pinned-recent";
import { usePinnedRecent } from "./pinned-recent-store";
import { useUserDirs } from "./user-dirs-store";
import { useCloseGuard } from "./useCloseGuard";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const HOME = p("/home/a");
let restoreLayout: () => void;

const folder = (parent: string, name: string): WireEntry =>
  entry(name, { kind: "dir", target_is_dir: true }, parent);

beforeEach(() => {
  restoreLayout = stubLayout();
  ipc.docMoved.mockResolvedValue({ kept: [] });
  useUserDirs.getState().reset();
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useLayout.getState().reset();
  useTreeMenu.getState().setCurrent(null);
  useTreeSort.setState({ sort: DEFAULT_TREE_SORT });
  useTreeHover.getState().set(null);
  useOps.setState({ notice: null });
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
  useViewSettings.setState({ loaded: true, showHidden: false });
  ipc.listDir.mockImplementation((path: WirePath) =>
    Promise.resolve(
      path.v === "/home/a"
        ? [folder("/home/a", "work"), entry("notes.md", {}, "/home/a")]
        : path.v === "/home/a/work"
          ? [entry("todo.md", {}, "/home/a/work")]
          : []
    )
  );
  ipc.watchDir.mockResolvedValue(undefined);
  ipc.unwatchDir.mockResolvedValue(undefined);
  ipc.fileIdentity.mockResolvedValue([]);
  ipc.openPaths.mockResolvedValue([]);
  ipc.openEditor.mockResolvedValue("editor-1");
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, tree_root: HOME });
  ipc.layoutSet.mockImplementation((patch: object) => Promise.resolve({ ...NO_LAYOUT, ...patch }));
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, default_layout: "editor" });
  ipc.userDirs.mockResolvedValue({
    home: HOME,
    dirs: [{ name: "documents", path: p("/home/a/Documents") }],
  });
  ipc.volumesList.mockResolvedValue({ mounted: [], unmounted: [], problems: [] });
  ipc.volumesProblemsTake.mockResolvedValue([]);
  ipc.on.mockResolvedValue(() => undefined);
  ipc.undoState.mockResolvedValue({ undo: null, redo: null });
  ipc.prune.mockResolvedValue(EMPTY_PRUNE);
  ipc.pinsGet.mockResolvedValue({ entries: [] });
  ipc.storeErrorsTake.mockResolvedValue([]);
  ipc.textOpen.mockImplementation((path: WirePath) =>
    Promise.resolve({
      path,
      text: "hello",
      ending: "lf",
      bom: false,
      read_only: null,
      stamp: "s1:5:0:1:1:0",
    })
  );
  ipc.textCheck.mockResolvedValue("same");
  ipc.recentTouch.mockResolvedValue({ entries: [] });
  ipc.docOpened.mockResolvedValue(undefined);
  ipc.docClosed.mockResolvedValue(undefined);
  ipc.docOpenElsewhere.mockResolvedValue({ state: "free" });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  restoreLayout();
  vi.clearAllMocks();
});

async function editorWindow() {
  const view = render(<MainWindow />);
  await screen.findByTestId("folder-tree");
  return view;
}

test("editor_layout_keeps_tree_docked_in_doc_tab", async () => {
  useTabs.getState().openFolder(p("/home/a/work"), false);
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  const main = screen.getByTestId("main-grid");
  expect(main).toHaveAttribute("data-layout", "editor");
  // The document tab is shown, and the strip over the tree is docked beside it.
  const left = screen.getByTestId("editor-left");
  expect(within(left).getByTestId("places-strip")).toBeInTheDocument();
  expect(within(left).getByTestId("folder-tree")).toBeInTheDocument();
  expect(await within(left).findByRole("treeitem", { name: /^work/ })).toBeInTheDocument();
  expect(screen.getByTestId("doc-area")).not.toHaveAttribute("hidden");
  // The column's button and Pinned and Recent's button are on the tab row; no edge columns.
  const row = screen.getByTestId("tab-bar");
  expect(within(row).getByRole("button", { name: "Folder column" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  expect(within(row).getByRole("button", { name: "Pinned and Recent panel" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  expect(screen.queryByTestId("side-panel")).toBeNull();
  // The folder tab is closed: the editor layout holds documents, the tree the folders.
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
  expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["doc"]);
  expect(screen.queryByTestId("folder-area")).toBeNull();
});

test("the_editor_layout_has_no_new_tab_buttons_and_its_keys_say_why", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  const row = screen.getByTestId("tab-bar");
  expect(within(row).queryByRole("button", { name: "New tab" })).toBeNull();
  expect(within(row).queryByRole("button", { name: "New tab here" })).toBeNull();
  await waitFor(() => expect(useViewSettings.getState().loaded).toBe(true));
  fireEvent.keyDown(window, { key: "t", ctrlKey: true });
  expect(useOps.getState().notice?.text).toBe(
    "The editor layout has no folder tabs: the folder tree on the left shows the folders"
  );
  expect(useTabs.getState().tabs).toHaveLength(1);
});

test("the_file_manager_layout_has_no_tree_and_folds_the_left_panel_away_beside_a_document", async () => {
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  useTabs.getState().openFolder(HOME, false);
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  render(<MainWindow />);
  await screen.findByRole("button", { name: "File manager panel" });
  expect(screen.queryByTestId("folder-tree")).toBeNull();
  expect(screen.getByTestId("main-grid")).toHaveAttribute("data-layout", "doc");
});

test("welcome_pane_when_no_doc", async () => {
  await editorWindow();
  const welcome = screen.getByTestId("welcome-pane");
  expect(welcome).toHaveTextContent("No document open");
  // A document replaces it.
  act(() => useTabs.getState().openDoc(p("/home/a/notes.md")));
  await waitFor(() => expect(screen.queryByTestId("welcome-pane")).toBeNull());
  // Closing the last tab brings it back; the main window does not open Home in this layout.
  act(() => useTabs.getState().close(useTabs.getState().tabs[0]!.id));
  expect(await screen.findByTestId("welcome-pane")).toBeInTheDocument();
});

test("the_welcome_pane_waits_while_the_window_is_starting", async () => {
  render(<MainWindow starting />);
  await screen.findByTestId("folder-tree");
  expect(screen.queryByTestId("welcome-pane")).toBeNull();
  expect(screen.getByTestId("no-tab")).toHaveTextContent("Starting");
});

test("ctrl_b_toggles_left_column", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  expect(screen.getByTestId("editor-left")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(screen.queryByTestId("editor-left")).toBeNull();
  expect(screen.queryByTestId("column-splitter")).toBeNull();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(screen.getByTestId("editor-left")).toBeInTheDocument();
  // Inside the text of a document too: CodeMirror does not bind the key.
  await waitFor(() => expect(document.querySelector(".cm-content")).not.toBeNull());
  const content = document.querySelector<HTMLElement>(".cm-content")!;
  fireEvent.keyDown(content, { key: "b", ctrlKey: true });
  expect(screen.queryByTestId("editor-left")).toBeNull();
});

test("the_left_toggle_is_the_column_in_the_editor_layout_and_the_slid_panel_beside_a_document", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  const toggle = getAction("panel.left.toggle");
  expect(isEnabled(toggle, currentContext())).toBe(true);
  // In this layout it shows and hides the docked column, and slides nothing.
  act(() => void runAction(toggle, currentContext()));
  expect(screen.queryByTestId("editor-left")).toBeNull();
  expect(usePanelsStore.getState().leftSlid).toBe(false);
  // Beside a document in the file manager layout it slides the file manager panel.
  useLayout.getState().setLayout("file_manager");
  expect(isEnabled(toggle, currentContext())).toBe(true);
  act(() => void runAction(toggle, currentContext()));
  expect(usePanelsStore.getState().leftSlid).toBe(true);
});

test("pinned_and_recent_fold_away_behind_their_tab_row_button_for_every_tab", async () => {
  useTabs.getState().openFolder(HOME, false);
  await editorWindow();
  const button = screen.getByRole("button", { name: "Pinned and Recent panel" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  expect(await screen.findByTestId("side-panel")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pinned and Recent panel" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
});

// A place or a volume would move the tree's root away from the folder being edited.
test("the_editor_column_shows_the_logo_but_no_places_or_volumes", async () => {
  await editorWindow();
  const strip = screen.getByTestId("places-strip");
  expect(within(strip).getByRole("button", { name: "About Kern" })).toBeInTheDocument();
  expect(within(strip).queryByRole("heading", { name: "Places" })).toBeNull();
  expect(within(strip).queryByRole("button", { name: "Documents" })).toBeNull();
  expect(within(strip).queryByText("Volumes")).toBeNull();
});

test("the_tree_follows_the_hidden_choice_of_the_window", async () => {
  await editorWindow();
  expect(ipc.listDir).toHaveBeenCalledWith(HOME, false);
  act(() => useViewSettings.setState({ showHidden: true }));
  await waitFor(() => expect(ipc.listDir).toHaveBeenLastCalledWith(HOME, true));
});

test("the_divider_moves_with_the_keys_and_the_pointer_between_the_limits", async () => {
  await editorWindow();
  const sep = screen.getByRole("separator", { name: "Resize the folder column" });
  expect(sep).toHaveAttribute("aria-valuenow", "280");
  expect(sep).toHaveAttribute("aria-valuemin", "180");
  expect(sep).toHaveAttribute("aria-valuemax", "640");
  fireEvent.keyDown(sep, { key: "ArrowRight" });
  expect(useLayout.getState().leftWidth).toBe(296);
  fireEvent.keyDown(sep, { key: "ArrowLeft", shiftKey: true });
  expect(useLayout.getState().leftWidth).toBe(232);
  fireEvent.keyDown(sep, { key: "Home" });
  expect(useLayout.getState().leftWidth).toBe(180);
  fireEvent.keyDown(sep, { key: "ArrowLeft" });
  expect(useLayout.getState().leftWidth).toBe(180);
  fireEvent.keyDown(sep, { key: "End" });
  expect(useLayout.getState().leftWidth).toBe(640);
  expect(screen.getByTestId("main-grid").style.getPropertyValue("--editor-left-width")).toBe(
    "640px"
  );
  // A drag: the pointer's distance from where it went down.
  fireEvent.pointerDown(sep, { button: 0, clientX: 640 });
  fireEvent.pointerMove(window, { clientX: 500 });
  expect(useLayout.getState().leftWidth).toBe(500);
  fireEvent.pointerMove(window, { clientX: 0 });
  expect(useLayout.getState().leftWidth).toBe(180);
  fireEvent.pointerUp(window);
  fireEvent.pointerMove(window, { clientX: 400 });
  expect(useLayout.getState().leftWidth).toBe(180);
});

test("switching_layout_roots_the_tree_at_the_folder_shown_closes_folder_tabs_and_back_again", async () => {
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  ipc.layoutGet.mockResolvedValue(NO_LAYOUT);
  useTabs.getState().openFolder(p("/home/a/work"), false);
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  useTabs.getState().activate(useTabs.getState().tabs[0]!.id);
  render(<MainWindow />);
  await screen.findByTestId("places-strip");
  await waitFor(() => expect(useLayout.getState().loaded).toBe(true));
  await act(() => switchLayout("editor"));
  await screen.findByTestId("folder-tree");
  // The folder tab on show is where the tree starts; folder tabs close, the document stays.
  expect(useLayout.getState().treeRoot).toEqual(p("/home/a/work"));
  expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["doc"]);
  await act(() => switchLayout("file_manager"));
  await waitFor(() => expect(screen.queryByTestId("folder-tree")).toBeNull());
  expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(["doc"]);
});

test("the_tree_starts_at_home_when_no_folder_is_shown", async () => {
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, tree_root: null });
  render(<MainWindow />);
  await screen.findByRole("tree", { name: "Folders of a" });
  expect(useLayout.getState().treeRoot).toEqual(HOME);
});

test("a_right_click_on_a_folder_of_the_tree_offers_open_as_editor", async () => {
  await editorWindow();
  const work = await screen.findByRole("treeitem", { name: /^work/ });
  fireEvent.contextMenu(work, { clientX: 5, clientY: 6 });
  const menu = await screen.findByTestId("action-menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Open as editor/ }));
  expect(ipc.openEditor).toHaveBeenCalledExactlyOnceWith(p("/home/a/work"));
  // A file has no folder to open as an editor: its menu leaves the entry out.
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /^notes/ }), {
    clientX: 5,
    clientY: 6,
  });
  const second = await screen.findByTestId("action-menu");
  expect(within(second).queryByRole("menuitem", { name: /Open as editor/ })).toBeNull();
});

/** Right-clicks a row of the tree, or the empty part below the rows, and returns the menu. */
async function treeMenuOn(name: RegExp | null) {
  const target = name
    ? await screen.findByRole("treeitem", { name })
    : await screen.findByTestId("tree-scroll");
  fireEvent.contextMenu(target, { clientX: 5, clientY: 6 });
  return screen.findByTestId("action-menu");
}
const labels = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole("menuitem")
    .map((m) => m.textContent);
const choose = (menu: HTMLElement, name: RegExp) =>
  fireEvent.click(within(menu).getByRole("menuitem", { name }));

test("the_tree_menu_lists_what_applies_to_a_folder_a_file_and_the_empty_part", async () => {
  await editorWindow();
  // The main window in the editor layout holds no folder tabs: no Open in file manager.
  expect(labels(await treeMenuOn(/^work/))).toEqual([
    "Open as editor",
    "Pin as editor",
    "Open terminal here",
    "New file",
    "New folder",
    "CutCtrl+X",
    "CopyCtrl+C",
    "PasteCtrl+V",
    "RenameF2",
    "Copy path",
    "Move to TrashDelete",
    "Delete permanentlyShift+Delete",
  ]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(labels(await treeMenuOn(/^notes/))).toEqual([
    "Open",
    "Open terminal here",
    "CutCtrl+X",
    "CopyCtrl+C",
    "RenameF2",
    "Copy path",
    "Move to TrashDelete",
    "Delete permanentlyShift+Delete",
  ]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(labels(await treeMenuOn(null))).toEqual([
    "New file",
    "New folder",
    "PasteCtrl+V",
    "Open terminal here",
    "Copy path",
  ]);
});

test("new_file_from_the_empty_part_is_made_in_the_root_and_from_a_folder_in_that_folder", async () => {
  ipc.createFile.mockImplementation((dir: WirePath, name: string) =>
    Promise.resolve(p(`${dir.v}/${name}`))
  );
  ipc.createDir.mockImplementation((dir: WirePath, name: string) =>
    Promise.resolve(p(`${dir.v}/${name}`))
  );
  await editorWindow();
  choose(await treeMenuOn(null), /^New file/);
  const dialog = await screen.findByTestId("name-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "a.txt" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(ipc.createFile).toHaveBeenCalledExactlyOnceWith(HOME, "a.txt"));
  await waitFor(() => expect(screen.queryByTestId("name-dialog")).toBeNull());

  choose(await treeMenuOn(/^work/), /^New folder/);
  const second = await screen.findByTestId("name-dialog");
  fireEvent.change(within(second).getByRole("textbox"), { target: { value: "sub" } });
  fireEvent.click(within(second).getByRole("button", { name: "Create" }));
  await waitFor(() =>
    expect(ipc.createDir).toHaveBeenCalledExactlyOnceWith(p("/home/a/work"), "sub")
  );
});

test("rename_in_the_tree_asks_for_the_name_with_the_stem_selected", async () => {
  ipc.rename.mockResolvedValue(p("/home/a/ideas.md"));
  await editorWindow();
  choose(await treeMenuOn(/^notes/), /^Rename/);
  const input = within(await screen.findByTestId("name-dialog")).getByRole<HTMLInputElement>(
    "textbox"
  );
  expect(input.value).toBe("notes.md");
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, "notes".length]);
  fireEvent.change(input, { target: { value: "ideas.md" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(ipc.rename).toHaveBeenCalledExactlyOnceWith(p("/home/a/notes.md"), "ideas.md")
  );
  await waitFor(() => expect(screen.queryByTestId("name-dialog")).toBeNull());
  // A tab open on the file follows it.
  expect(ipc.docMoved).toHaveBeenCalledExactlyOnceWith([
    { from: p("/home/a/notes.md"), to: p("/home/a/ideas.md") },
  ]);
});

test("a_refused_rename_is_said_in_the_dialog_which_stays_open", async () => {
  ipc.rename.mockRejectedValue({ kind: "Exists", message: "exists", path: null });
  await editorWindow();
  choose(await treeMenuOn(/^notes/), /^Rename/);
  const dialog = await screen.findByTestId("name-dialog");
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "work" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
  expect(await within(dialog).findByRole("alert")).not.toBeEmptyDOMElement();
  expect(screen.getByTestId("name-dialog")).toBeInTheDocument();
});

test("cut_copy_and_paste_in_the_tree_use_the_file_clipboard", async () => {
  ipc.clipSet.mockResolvedValue(undefined);
  ipc.clipGet.mockResolvedValue({ op: "copy", paths: [p("/home/a/notes.md")] });
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  choose(await treeMenuOn(/^notes/), /^Copy Ctrl\+C$/);
  await waitFor(() =>
    expect(ipc.clipSet).toHaveBeenCalledExactlyOnceWith("copy", [p("/home/a/notes.md")])
  );
  choose(await treeMenuOn(/^work/), /^Cut/);
  await waitFor(() => expect(ipc.clipSet).toHaveBeenLastCalledWith("cut", [p("/home/a/work")]));
  choose(await treeMenuOn(/^work/), /^Paste/);
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledExactlyOnceWith(
      "copy",
      [p("/home/a/notes.md")],
      p("/home/a/work")
    )
  );
});

test("move_to_trash_runs_at_once_and_delete_permanently_asks_first", async () => {
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  choose(await treeMenuOn(/^notes/), /^Move to Trash/);
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledExactlyOnceWith("trash", [p("/home/a/notes.md")], undefined)
  );
  choose(await treeMenuOn(/^work/), /^Delete permanently/);
  const ask = await screen.findByRole("alertdialog", { name: "Delete permanently" });
  expect(ask).toHaveTextContent(/work/);
  expect(ipc.startOp).toHaveBeenCalledTimes(1);
  fireEvent.click(within(ask).getByRole("button", { name: /^Delete 1 item/ }));
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenLastCalledWith("delete", [p("/home/a/work")], undefined)
  );
});

test("open_terminal_here_opens_in_the_folder_the_folder_of_a_file_or_the_root", async () => {
  ipc.openTerminal.mockResolvedValue(undefined);
  await editorWindow();
  choose(await treeMenuOn(/^work/), /^Open terminal here/);
  await waitFor(() =>
    expect(ipc.openTerminal).toHaveBeenLastCalledWith(p("/home/a/work"), undefined)
  );
  choose(await treeMenuOn(/^notes/), /^Open terminal here/);
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenLastCalledWith(HOME, undefined));
  choose(await treeMenuOn(null), /^Open terminal here/);
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledTimes(3));
  expect(ipc.openTerminal).toHaveBeenLastCalledWith(HOME, undefined);
});

test("copy_path_copies_the_entry_or_the_root_and_open_sends_the_file_to_open", async () => {
  ipc.clipText.mockResolvedValue(undefined);
  await editorWindow();
  choose(await treeMenuOn(/^notes/), /^Copy path/);
  await waitFor(() => expect(ipc.clipText).toHaveBeenLastCalledWith("/home/a/notes.md"));
  choose(await treeMenuOn(null), /^Copy path/);
  await waitFor(() => expect(ipc.clipText).toHaveBeenLastCalledWith("/home/a"));
  choose(await treeMenuOn(/^notes/), /^Open$/);
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledWith([p("/home/a/notes.md")], "inside", "default")
  );
});

test("a_failed_open_as_editor_is_said", async () => {
  ipc.openEditor.mockRejectedValue({
    kind: "NotAFolder",
    message: "that is not a folder",
    path: null,
  });
  await editorWindow();
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /^work/ }), {
    clientX: 5,
    clientY: 6,
  });
  fireEvent.click(
    within(await screen.findByTestId("action-menu")).getByRole("menuitem", {
      name: /Open as editor/,
    })
  );
  await waitFor(() =>
    expect(useOps.getState().notice?.text).toMatch(
      /work could not be opened as an editor: .*not a folder/
    )
  );
});

test("a_gone_root_moves_the_tree_to_the_nearest_folder_and_says_so", async () => {
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, tree_root: p("/home/a/gone") });
  ipc.listDir.mockImplementation((path: WirePath) =>
    path.v === "/home/a/gone"
      ? Promise.reject({ kind: "NotFound", message: "gone", path: null, details: null })
      : Promise.resolve([])
  );
  render(<MainWindow />);
  await waitFor(() => expect(useLayout.getState().treeRoot).toEqual(HOME));
  expect(useOps.getState().notice?.text).toBe(
    "/home/a/gone is gone, so the tree now shows /home/a."
  );
});

test("the_main_menu_has_no_panel_toggles_and_no_layout_switch", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
  const menu = screen.getByTestId("action-menu");
  // The panels have their buttons on the tab row and their keys, so the menu leaves them out.
  expect(menu.querySelector(`[data-action-id="panel.left.toggle"]`)).toBeNull();
  expect(menu.querySelector(`[data-action-id="panel.right.toggle"]`)).toBeNull();
  expect(actions.filter((a) => a.area === "Layout")).toEqual([]);
});

const tools = () => within(screen.getByRole("toolbar", { name: "Folder tree" }));

test("the_tree_buttons_open_a_terminal_at_the_root_and_show_hidden_items", async () => {
  ipc.openTerminal.mockResolvedValue(undefined);
  ipc.settingsSet.mockImplementation((patch: object) => Promise.resolve({ ...SETTINGS, ...patch }));
  await editorWindow();
  fireEvent.click(tools().getByRole("button", { name: "Open terminal here" }));
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledExactlyOnceWith(HOME, undefined));
  const hidden = tools().getByRole("button", { name: "Show hidden files" });
  expect(hidden).toHaveAttribute("aria-pressed", "false");
  expect(hidden.querySelector("svg.lucide-eye-off")).not.toBeNull();
  fireEvent.click(hidden);
  await waitFor(() => expect(ipc.settingsSet).toHaveBeenCalledWith({ show_hidden: true }));
  // The eye is open while hidden items show and crossed out while they are hidden.
  await waitFor(() => expect(hidden).toHaveAttribute("aria-pressed", "true"));
  expect(hidden.querySelector("svg.lucide-eye")).not.toBeNull();
  fireEvent.click(hidden);
  await waitFor(() => expect(hidden).toHaveAttribute("aria-pressed", "false"));
  expect(hidden.querySelector("svg.lucide-eye-off")).not.toBeNull();
});

test("in_an_editor_window_the_tree_heading_opens_the_folder_in_the_file_manager", async () => {
  const w = window as { __TAURI_INTERNALS__?: { metadata?: unknown } };
  const kept = w.__TAURI_INTERNALS__;
  w.__TAURI_INTERNALS__ = { ...kept, metadata: { currentWindow: { label: "editor-1" } } };
  try {
    await editorWindow();
    fireEvent.click(tools().getByRole("button", { name: "Open in file manager" }));
    await waitFor(() =>
      expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([HOME], "inside", "default")
    );
  } finally {
    w.__TAURI_INTERNALS__ = kept;
  }
});

test("the_main_windows_tree_heading_has_no_open_in_file_manager", async () => {
  await editorWindow();
  expect(tools().queryByRole("button", { name: "Open in file manager" })).toBeNull();
});

test("one_button_expands_all_when_no_folder_is_open_and_collapses_all_when_one_is", async () => {
  await editorWindow();
  // Nothing is open: the button opens everything, and there is no second button for closing.
  const expand = tools().getByRole("button", { name: "Expand all" });
  expect(tools().queryByRole("button", { name: "Collapse all" })).toBeNull();
  fireEvent.click(expand);
  expect(await screen.findByRole("treeitem", { name: /^todo/ })).toBeInTheDocument();
  // A folder is open: the same button now closes them all.
  const collapse = await tools().findByRole("button", { name: "Collapse all" });
  expect(tools().queryByRole("button", { name: "Expand all" })).toBeNull();
  expect(collapse).toBe(expand);
  fireEvent.click(collapse);
  await waitFor(() => expect(screen.queryByRole("treeitem", { name: /^todo/ })).toBeNull());
  expect(await tools().findByRole("button", { name: "Expand all" })).toBeInTheDocument();
});

test("opening_a_folder_by_hand_turns_the_button_into_collapse_all", async () => {
  await editorWindow();
  expect(tools().getByRole("button", { name: "Expand all" })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("treeitem", { name: /^work/ }));
  expect(await tools().findByRole("button", { name: "Collapse all" })).toBeInTheDocument();
  expect(tools().queryByRole("button", { name: "Expand all" })).toBeNull();
  fireEvent.click(screen.getByRole("treeitem", { name: /^work/ }));
  expect(await tools().findByRole("button", { name: "Expand all" })).toBeInTheDocument();
  expect(tools().queryByRole("button", { name: "Collapse all" })).toBeNull();
});

test("the_tree_search_finds_in_the_root_opens_a_file_and_shows_a_folder_in_the_tree", async () => {
  const handlers: Record<string, ((payload: unknown) => void)[]> = {};
  ipc.on.mockImplementation((name: string, h: (payload: unknown) => void) => {
    (handlers[name] ??= []).push(h);
    return Promise.resolve(() => undefined);
  });
  ipc.search.mockResolvedValue(1);
  ipc.cancelOp.mockResolvedValue(undefined);
  await editorWindow();
  const searchButton = tools().getByRole("button", { name: /^Search in / });
  fireEvent.click(searchButton);
  const box = await screen.findByRole("searchbox");
  fireEvent.change(box, { target: { value: "o" } });
  await waitFor(() =>
    expect(ipc.search).toHaveBeenCalledWith(expect.any(String), [HOME], "o", false)
  );
  const key = ipc.search.mock.lastCall![0] as string;
  const hits = [entry("todo.md", {}, "/home/a/work"), folder("/home/a", "work")];
  act(() =>
    (handlers["kernkraft://search-hit"] ?? []).forEach((h) => h({ key, op: 1, entries: hits }))
  );
  const found = await screen.findAllByTestId("scan-hit");
  // A file found opens as from the tree.
  fireEvent.doubleClick(found[0]!);
  await waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledWith([p("/home/a/work/todo.md")], "inside", "default")
  );
  // A folder found closes the search and is the tree's current row.
  fireEvent.doubleClick(found[1]!);
  await waitFor(() => expect(screen.queryByTestId("search-view")).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole("treeitem", { name: /^work/ })).toHaveAttribute("data-active", "true")
  );
});

test("the_tree_sort_button_opens_a_menu_that_orders_the_tree_and_marks_the_choice", async () => {
  ipc.listDir.mockImplementation((path: WirePath) =>
    Promise.resolve(
      path.v === "/home/a"
        ? [
            folder("/home/a", "work"),
            entry("zebra.txt", { len: 99 }, "/home/a"),
            entry("apple.txt", { len: 1 }, "/home/a"),
          ]
        : []
    )
  );
  await editorWindow();
  const treeNames = () => screen.getAllByTestId("tree-row").map((r) => r.getAttribute("data-name"));
  await waitFor(() => expect(treeNames()).toEqual(["work", "apple.txt", "zebra.txt"]));

  const open = () => {
    fireEvent.click(tools().getByRole("button", { name: "Sort the tree" }));
    return screen.findByRole("menu");
  };
  let menu = await open();
  expect(within(menu).getByRole("menuitemradio", { name: "Name" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  expect(within(menu).getByRole("menuitemradio", { name: "A to Z" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Size" }));
  await waitFor(() => expect(treeNames()).toEqual(["work", "zebra.txt", "apple.txt"]));
  expect(screen.queryByRole("menu")).toBeNull();

  menu = await open();
  expect(within(menu).getByRole("menuitemradio", { name: "Size" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  expect(within(menu).getByRole("menuitemradio", { name: "Largest first" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Smallest first" }));
  await waitFor(() => expect(treeNames()).toEqual(["work", "apple.txt", "zebra.txt"]));
});

test("f4_opens_a_terminal_in_the_tree_root_with_no_tab_open_and_in_the_pointed_row_when_there_is_one", async () => {
  ipc.openTerminal.mockResolvedValue(undefined);
  await editorWindow();
  // Nothing on the right: the welcome pane.
  expect(screen.getByTestId("welcome-pane")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "F4" });
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledExactlyOnceWith(HOME, undefined));

  // The pointer over a folder of the tree: that folder.
  const work = await screen.findByRole("treeitem", { name: /^work/ });
  fireEvent.pointerEnter(work);
  fireEvent.keyDown(window, { key: "F4" });
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledTimes(2));
  expect(ipc.openTerminal).toHaveBeenLastCalledWith(p("/home/a/work"), undefined);

  // Over a file: the folder it is in, here the root.
  fireEvent.pointerLeave(work);
  fireEvent.pointerEnter(screen.getByRole("treeitem", { name: /^notes\.md/ }));
  fireEvent.keyDown(window, { key: "F4" });
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledTimes(3));
  expect(ipc.openTerminal).toHaveBeenLastCalledWith(HOME, undefined);

  // The pointer gone from the tree: the root again.
  fireEvent.pointerLeave(screen.getByTestId("folder-tree"));
  fireEvent.keyDown(window, { key: "F4" });
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledTimes(4));
  expect(ipc.openTerminal).toHaveBeenLastCalledWith(HOME, undefined);
});

test("f4_works_while_the_keyboard_is_in_a_text_field", async () => {
  ipc.openTerminal.mockResolvedValue(undefined);
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  const field = document.createElement("textarea");
  document.body.append(field);
  field.focus();
  fireEvent.keyDown(field, { key: "F4" });
  await waitFor(() => expect(ipc.openTerminal).toHaveBeenCalledExactlyOnceWith(HOME, undefined));
  field.remove();
});

test("f4_does_nothing_in_the_file_manager_layout_where_the_folder_view_owns_it", async () => {
  ipc.openTerminal.mockResolvedValue(undefined);
  ipc.settingsGet.mockResolvedValue({ ...SETTINGS, default_layout: "file_manager" });
  useLayout.getState().setLayout("file_manager");
  const view = render(<MainWindow />);
  await screen.findByTestId("main-grid");
  expect(getAction("editor.terminal").keys).toEqual(["F4"]);
  expect(isEnabled(getAction("editor.terminal"), currentContext())).toBe(false);
  view.unmount();
});

test("an_editor_window_answers_f4", () => {
  expect(EDITOR_WINDOW_KEYS(getAction("editor.terminal"))).toBe(true);
});

test("the_tree_keys_have_their_defaults_and_an_editor_window_answers_them", () => {
  const keys = {
    "tree.cut": ["Ctrl+X"],
    "tree.copy": ["Ctrl+C"],
    "tree.paste": ["Ctrl+V"],
    "tree.rename": ["F2"],
    "tree.trash": ["Delete"],
    "tree.delete": ["Shift+Delete"],
  };
  for (const [id, expected] of Object.entries(keys)) {
    const a = getAction(id);
    expect(a.keys).toEqual(expected);
    expect(a.scope).toBe("tree");
    expect(EDITOR_WINDOW_KEYS(a)).toBe(true);
  }
  expect(findDuplicateBindings()).toEqual([]);
});

test("the_folder_column_is_left_of_the_editor_in_the_default_order", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  const frame = screen.getByTestId("main-grid");
  const kids = [...frame.children].map((c) => c.getAttribute("data-testid") ?? c.className);
  expect(kids.indexOf("editor-left")).toBeLessThan(
    kids.findIndex((k) => k.includes("editor-centre"))
  );
  expect(kids.indexOf("column-splitter")).toBe(kids.indexOf("editor-left") + 1);
  expect(screen.getByTestId("editor-left")).not.toHaveClass("kern-side-right");
});

test("with_pinned_and_recent_first_the_folder_column_and_its_divider_are_right_of_the_editor", async () => {
  ipc.settingsGet.mockResolvedValue({
    ...SETTINGS,
    default_layout: "editor",
    editor_panel_order: ["pinned", "places"],
  });
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  await waitFor(() =>
    expect(useViewSettings.getState().editorPanelOrder).toEqual(["pinned", "places"])
  );
  const frame = screen.getByTestId("main-grid");
  const kids = [...frame.children].map((c) => c.getAttribute("data-testid") ?? c.className);
  const centre = kids.findIndex((k) => k.includes("editor-centre"));
  // The divider sits between the editor and the column: on the column's edge that faces the editor.
  expect(kids.indexOf("column-splitter")).toBeGreaterThan(centre);
  expect(kids.indexOf("editor-left")).toBe(kids.indexOf("column-splitter") + 1);
  expect(screen.getByTestId("editor-left")).toHaveClass("kern-side-right");
});

test("a_column_on_the_right_widens_as_its_divider_moves_left", async () => {
  ipc.settingsGet.mockResolvedValue({
    ...SETTINGS,
    default_layout: "editor",
    editor_panel_order: ["pinned", "places"],
  });
  await editorWindow();
  await waitFor(() =>
    expect(useViewSettings.getState().editorPanelOrder).toEqual(["pinned", "places"])
  );
  const before = useLayout.getState().leftWidth;
  fireEvent.keyDown(screen.getByTestId("column-splitter"), { key: "ArrowLeft" });
  expect(useLayout.getState().leftWidth).toBe(before + 16);
});

test("pinned_and_recent_slide_in_from_the_side_the_editor_order_gives_them", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  fireEvent.click(screen.getByRole("button", { name: "Pinned and Recent panel" }));
  expect(await screen.findByTestId("side-panel")).not.toHaveClass("kern-side-left");
  cleanup();
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
  ipc.settingsGet.mockResolvedValue({
    ...SETTINGS,
    default_layout: "editor",
    editor_panel_order: ["pinned", "places"],
  });
  useViewSettings.setState({ editorPanelOrder: ["places", "pinned"] });
  await editorWindow();
  await waitFor(() =>
    expect(useViewSettings.getState().editorPanelOrder).toEqual(["pinned", "places"])
  );
  fireEvent.click(screen.getByRole("button", { name: "Pinned and Recent panel" }));
  expect(await screen.findByTestId("side-panel")).toHaveClass("kern-side-left");
});

test("the_tab_row_buttons_sit_at_the_end_their_panel_is_on", async () => {
  ipc.settingsGet.mockResolvedValue({
    ...SETTINGS,
    default_layout: "editor",
    editor_panel_order: ["pinned", "places"],
  });
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  await waitFor(() =>
    expect(useViewSettings.getState().editorPanelOrder).toEqual(["pinned", "places"])
  );
  const row = screen.getByTestId("tab-bar");
  const order = within(row)
    .getAllByRole("button")
    .map((b) => b.getAttribute("data-testid"))
    .filter((id) => id?.startsWith("panel-toggle"));
  expect(order).toEqual(["panel-toggle-right", "panel-toggle-left"]);
});

// ---- the keys of the tree's file operations ----

/** Long enough for an operation a key started to reach the backend, to check that none did. */
const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 60)));

/** Puts the tree's keyboard cursor on the row named `name` and returns the tree. */
async function cursorOn(name: RegExp) {
  fireEvent.click(await screen.findByRole("treeitem", { name }));
  const tree = screen.getByRole("tree");
  expect(tree).toHaveFocus();
  return tree;
}

test("the_default_keys_of_the_tree_act_on_its_current_row", async () => {
  ipc.clipSet.mockResolvedValue(undefined);
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  const tree = await cursorOn(/^notes/);
  fireEvent.keyDown(tree, { key: "c", ctrlKey: true });
  await waitFor(() =>
    expect(ipc.clipSet).toHaveBeenLastCalledWith("copy", [p("/home/a/notes.md")])
  );
  fireEvent.keyDown(tree, { key: "x", ctrlKey: true });
  await waitFor(() => expect(ipc.clipSet).toHaveBeenLastCalledWith("cut", [p("/home/a/notes.md")]));
  fireEvent.keyDown(tree, { key: "Delete" });
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledExactlyOnceWith("trash", [p("/home/a/notes.md")], undefined)
  );
});

test("f2_renames_and_shift_delete_asks_for_the_current_row_of_the_tree", async () => {
  await editorWindow();
  const tree = await cursorOn(/^notes/);
  fireEvent.keyDown(tree, { key: "F2" });
  const input = within(await screen.findByTestId("name-dialog")).getByRole<HTMLInputElement>(
    "textbox"
  );
  expect(input.value).toBe("notes.md");
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("name-dialog")).toBeNull());
  fireEvent.keyDown(screen.getByRole("tree"), { key: "Delete", shiftKey: true });
  expect(await screen.findByRole("alertdialog", { name: "Delete permanently" })).toHaveTextContent(
    /notes/
  );
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("ctrl_v_in_the_tree_pastes_into_the_folder_of_its_current_row", async () => {
  ipc.clipGet.mockResolvedValue({ op: "copy", paths: [p("/home/a/notes.md")] });
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  const tree = await cursorOn(/^work/);
  fireEvent.keyDown(tree, { key: "v", ctrlKey: true });
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledExactlyOnceWith(
      "copy",
      [p("/home/a/notes.md")],
      p("/home/a/work")
    )
  );
});

test("the_keys_of_the_tree_do_nothing_when_the_keyboard_is_outside_the_tree", async () => {
  ipc.clipSet.mockResolvedValue(undefined);
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  await cursorOn(/^notes/);
  const outside = screen.getByTestId("tree-scroll").ownerDocument.body;
  fireEvent.keyDown(outside, { key: "c", ctrlKey: true });
  fireEvent.keyDown(outside, { key: "x", ctrlKey: true });
  fireEvent.keyDown(outside, { key: "Delete" });
  fireEvent.keyDown(screen.getByTestId("tab-bar"), { key: "Delete" });
  await settle();
  expect(ipc.clipSet).not.toHaveBeenCalled();
  expect(ipc.startOp).not.toHaveBeenCalled();
});

test("a_key_set_in_settings_runs_the_tree_action_and_the_default_stops", async () => {
  ipc.clipSet.mockResolvedValue(undefined);
  await editorWindow();
  act(() => useBinds.setState({ loaded: true, overrides: { "tree.copy": ["F9"] } }));
  const tree = await cursorOn(/^notes/);
  fireEvent.keyDown(tree, { key: "c", ctrlKey: true });
  await settle();
  expect(ipc.clipSet).not.toHaveBeenCalled();
  fireEvent.keyDown(tree, { key: "F9" });
  await waitFor(() =>
    expect(ipc.clipSet).toHaveBeenCalledExactlyOnceWith("copy", [p("/home/a/notes.md")])
  );
  act(() => useBinds.setState({ overrides: {} }));
});

test("a_mouse_button_set_for_a_tree_action_acts_on_the_row_under_the_pointer", async () => {
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  act(() => useBinds.setState({ loaded: true, overrides: { "tree.trash": ["MiddleClick"] } }));
  // The keyboard's row is `work`; the button is pressed over `notes`.
  await cursorOn(/^work/);
  const row = screen.getByRole("treeitem", { name: /^notes/ });
  fireEvent.pointerEnter(row);
  fireEvent.mouseDown(row, { button: 1 });
  fireEvent.mouseUp(row, { button: 1 });
  await waitFor(() =>
    expect(ipc.startOp).toHaveBeenCalledExactlyOnceWith("trash", [p("/home/a/notes.md")], undefined)
  );
  act(() => useBinds.setState({ overrides: {} }));
});

test("a_mouse_button_set_for_a_tree_action_does_nothing_outside_the_tree", async () => {
  ipc.startOp.mockResolvedValue(7);
  await editorWindow();
  act(() => useBinds.setState({ loaded: true, overrides: { "tree.trash": ["MiddleClick"] } }));
  await cursorOn(/^notes/);
  // A row is under the pointer's last position in the tree, but the button goes down on the tab row.
  fireEvent.pointerEnter(screen.getByRole("treeitem", { name: /^notes/ }));
  const bar = screen.getByTestId("tab-bar");
  fireEvent.mouseDown(bar, { button: 1 });
  fireEvent.mouseUp(bar, { button: 1 });
  await settle();
  expect(ipc.startOp).not.toHaveBeenCalled();
  act(() => useBinds.setState({ overrides: {} }));
});
