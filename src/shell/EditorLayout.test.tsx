// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WireEntry, WirePath } from "../ipc";
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

import { actions, currentContext, getAction, isEnabled, runAction } from "../keys/actions";
import { useTreeMenu } from "../files/tree-menu-store";
import { useOps } from "../ops/useOps";
import { useLayout } from "../store/layout";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import { useViewSettings } from "../files/view-settings";
import MainWindow from "./MainWindow";
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
  useUserDirs.getState().reset();
  usePinnedRecent.getState().reset();
  useCloseGuard.getState().reset();
  useLayout.getState().reset();
  useTreeMenu.getState().setCurrent(null);
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
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, layout: "editor", tree_root: HOME });
  ipc.layoutSet.mockImplementation((patch: object) => Promise.resolve({ ...NO_LAYOUT, ...patch }));
  ipc.settingsGet.mockResolvedValue(SETTINGS);
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
  // No stubs for the left side; Pinned and Recent are folded to the right stub.
  expect(screen.queryByTestId("stub-left")).toBeNull();
  expect(screen.getByTestId("stub-right")).toBeInTheDocument();
  expect(screen.queryByTestId("side-panel")).toBeNull();
  // The folder tab: the tree is still there, and the folder view is the centre.
  fireEvent.click(screen.getAllByRole("tab")[0]!);
  expect(screen.getByTestId("editor-left")).toContainElement(screen.getByTestId("folder-tree"));
  expect(screen.getByTestId("folder-area")).toBeInTheDocument();
});

test("the_file_manager_layout_has_no_tree_and_folds_the_left_panel_to_a_stub_beside_a_document", async () => {
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, layout: "file_manager" });
  useTabs.getState().openFolder(HOME, false);
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  render(<MainWindow />);
  await screen.findByTestId("stub-left");
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

test("the_toggle_action_is_the_columns_in_the_editor_layout_and_greyed_in_the_other", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  const toggle = getAction("layout.left.toggle");
  expect(isEnabled(toggle, currentContext())).toBe(true);
  // The menu entry that folds the left panel is the same column in this layout.
  act(() => void runAction(getAction("panel.left.toggle"), currentContext()));
  expect(screen.queryByTestId("editor-left")).toBeNull();
  expect(usePanelsStore.getState().leftSlid).toBe(false);
  useLayout.getState().setLayout("file_manager");
  expect(isEnabled(toggle, currentContext())).toBe(false);
});

test("pinned_and_recent_fold_to_the_right_stub_for_every_tab", async () => {
  useTabs.getState().openFolder(HOME, false);
  await editorWindow();
  const stub = screen.getByRole("button", { name: "Pinned and Recent panel" });
  expect(stub).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(stub);
  expect(await screen.findByTestId("side-panel")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pinned and Recent panel" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
});

test("a_place_roots_the_tree_and_opens_no_folder_tab", async () => {
  await editorWindow();
  const strip = screen.getByTestId("places-strip");
  fireEvent.click(await within(strip).findByRole("button", { name: "Documents" }));
  await waitFor(() => expect(useLayout.getState().treeRoot).toEqual(p("/home/a/Documents")));
  expect(useTabs.getState().tabs).toHaveLength(0);
  await waitFor(() =>
    expect(screen.getByRole("tree")).toHaveAccessibleName("Folders of Documents")
  );
  expect(within(strip).getByRole("button", { name: "Documents" })).toHaveAttribute(
    "aria-current",
    "page"
  );
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

test("switching_layout_roots_the_tree_at_the_folder_shown_and_back_again", async () => {
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, layout: "file_manager" });
  useTabs.getState().openFolder(p("/home/a/work"), false);
  render(<MainWindow />);
  await screen.findByTestId("places-strip");
  await waitFor(() => expect(useLayout.getState().loaded).toBe(true));
  const toEditor = getAction("layout.editor");
  const toFiles = getAction("layout.fileManager");
  expect(isEnabled(toEditor, currentContext())).toBe(true);
  expect(isEnabled(toFiles, currentContext())).toBe(false);
  act(() => void runAction(toEditor, currentContext()));
  await screen.findByTestId("folder-tree");
  // The folder tab on show is where the tree starts.
  expect(useLayout.getState().treeRoot).toEqual(p("/home/a/work"));
  expect(isEnabled(toEditor, currentContext())).toBe(false);
  act(() => void runAction(toFiles, currentContext()));
  await waitFor(() => expect(screen.queryByTestId("folder-tree")).toBeNull());
  expect(screen.getByTestId("main-grid")).toHaveAttribute("data-layout", "folder");
});

test("the_tree_starts_at_home_when_no_folder_is_shown", async () => {
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, layout: "editor", tree_root: null });
  render(<MainWindow />);
  await screen.findByRole("tree", { name: "Folders of a" });
  expect(useLayout.getState().treeRoot).toEqual(HOME);
});

test("a_layout_cannot_be_chosen_before_the_stored_one_is_read", async () => {
  expect(isEnabled(getAction("layout.editor"), currentContext())).toBe(false);
  expect(isEnabled(getAction("layout.fileManager"), currentContext())).toBe(false);
});

test("a_right_click_on_a_folder_of_the_tree_offers_open_as_editor", async () => {
  await editorWindow();
  const work = await screen.findByRole("treeitem", { name: /^work/ });
  fireEvent.contextMenu(work, { clientX: 5, clientY: 6 });
  const menu = await screen.findByTestId("action-menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: /Open as editor/ }));
  expect(ipc.openEditor).toHaveBeenCalledExactlyOnceWith(p("/home/a/work"));
  // A file offers nothing to open as an editor: the entry is greyed.
  fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /^notes/ }), {
    clientX: 5,
    clientY: 6,
  });
  const second = await screen.findByTestId("action-menu");
  expect(within(second).getByRole("menuitem", { name: /Open as editor/ })).toBeDisabled();
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
  ipc.layoutGet.mockResolvedValue({ ...NO_LAYOUT, layout: "editor", tree_root: p("/home/a/gone") });
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

test("every_layout_action_is_in_the_main_menu", async () => {
  useTabs.getState().openDoc(p("/home/a/notes.md"));
  await editorWindow();
  fireEvent.click(screen.getByRole("button", { name: "Main menu" }));
  const menu = screen.getByTestId("action-menu");
  for (const id of ["layout.editor", "layout.fileManager", "layout.left.toggle"]) {
    expect(menu.querySelector(`[data-action-id="${id}"]`), id).not.toBeNull();
  }
  expect(actions.filter((a) => a.area === "Layout")).toHaveLength(3);
});
