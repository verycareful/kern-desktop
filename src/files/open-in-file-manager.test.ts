// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test, vi } from "vitest";

// Open in file manager from an editor window: a folder, the folder of a file with the file
// selected, or the window's own folder, each in a folder tab of the main window.

const ipc = vi.hoisted(() => ({
  openPaths: vi.fn(),
  showInFolder: vi.fn(),
  isEditorWindow: vi.fn(() => true),
  isMainWindow: vi.fn(() => false),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import type { WirePath } from "../ipc";
import { currentContext, getAction, isEnabled, menuSections, runAction } from "../keys/actions";
import { useLayout } from "../store/layout";
import { useOps } from "../ops/useOps";
import { useTreeMenu } from "./tree-menu-store";
import { dir, entry } from "./test-entries";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const ROOT = p("/w");
const tree = () => getAction("tree.openInFileManager");
const menu = () => getAction("editor.openInFileManager");

beforeEach(() => {
  ipc.openPaths
    .mockReset()
    .mockResolvedValue([{ path: ROOT, action: "folder_tab", location: null, error: null }]);
  ipc.showInFolder.mockReset().mockResolvedValue([]);
  ipc.isEditorWindow.mockReturnValue(true);
  useLayout.getState().reset();
  useTreeMenu.setState({ current: null, root: ROOT });
});

test("a_folder_opens_as_a_folder_tab", async () => {
  useTreeMenu.getState().setCurrent(dir("sub"));
  expect(isEnabled(tree(), currentContext())).toBe(true);
  runAction(tree(), currentContext());
  await vi.waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([p("/d/sub")], "inside", "default")
  );
  expect(ipc.showInFolder).not.toHaveBeenCalled();
});

test("a_file_opens_its_folder_with_the_file_selected", async () => {
  useTreeMenu.getState().setCurrent(entry("a.txt"));
  expect(isEnabled(tree(), currentContext())).toBe(true);
  runAction(tree(), currentContext());
  await vi.waitFor(() => expect(ipc.showInFolder).toHaveBeenCalledExactlyOnceWith([p("/d/a.txt")]));
  expect(ipc.openPaths).not.toHaveBeenCalled();
});

test("the_empty_part_opens_the_trees_root", async () => {
  useTreeMenu.getState().setCurrent(null, ROOT);
  runAction(tree(), currentContext());
  await vi.waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([ROOT], "inside", "default")
  );
});

test("a_file_not_shown_says_why", async () => {
  ipc.showInFolder.mockResolvedValue([
    { kind: "NotFound", message: "gone", path: null, details: null },
  ]);
  const note = vi.fn();
  useTreeMenu.getState().setOps({
    newFolder: vi.fn(),
    newFile: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    trash: vi.fn(),
    askDelete: vi.fn(),
    note,
  });
  useTreeMenu.getState().setCurrent(entry("a.txt"));
  runAction(tree(), currentContext());
  await vi.waitFor(() => expect(note).toHaveBeenCalledOnce());
  expect(note.mock.calls[0]![0]).toMatch(/^a\.txt was not shown in its folder: /);
  useTreeMenu.getState().setOps(null);
});

test("the_main_menu_opens_the_windows_folder_in_an_editor_window_only", async () => {
  useLayout.getState().setLayout("editor");
  useLayout.getState().setTreeRoot(ROOT);
  expect(isEnabled(menu(), currentContext())).toBe(true);
  expect(menuSections(null).some((s) => s.actions.includes(menu()))).toBe(true);
  runAction(menu(), currentContext());
  await vi.waitFor(() =>
    expect(ipc.openPaths).toHaveBeenCalledExactlyOnceWith([ROOT], "inside", "default")
  );
  // No folder yet: nothing to open.
  useLayout.getState().setTreeRoot(null);
  expect(isEnabled(menu(), currentContext())).toBe(false);
  // The main window shows its folders in folder tabs already.
  ipc.isEditorWindow.mockReturnValue(false);
  useLayout.getState().setTreeRoot(ROOT);
  expect(isEnabled(menu(), currentContext())).toBe(false);
  expect(useOps.getState().notice).toBeNull();
});
