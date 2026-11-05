// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test, vi } from "vitest";

const win = vi.hoisted(() => ({ main: false }));
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  isMainWindow: () => win.main,
}));

import { useLayout } from "../store/layout";
import { entry } from "./test-entries";
import { everyTreeAction, treeMenu } from "./tree-menu";

const folder = entry("work", { kind: "dir", target_is_dir: true }, "/home/a");
const ids = (main: boolean) => {
  win.main = main;
  return treeMenu(folder).flatMap((s) => s.actions.map((a) => a.id));
};

test("open_in_file_manager_is_offered_wherever_it_opens_a_folder_tab", () => {
  // An editor window: the folder goes to a tab of the main window.
  expect(ids(false)).toContain("tree.openInFileManager");
  // The main window in the file manager layout has folder tabs too.
  useLayout.getState().setLayout("file_manager");
  expect(ids(true)).toContain("tree.openInFileManager");
  // The main window in the editor layout holds none: the folder would only root the tree.
  useLayout.getState().setLayout("editor");
  expect(ids(true)).not.toContain("tree.openInFileManager");
});

test("every_tree_action_is_in_some_form_of_the_menu", () => {
  expect(everyTreeAction().every((a) => a.when === "tree")).toBe(true);
  expect(new Set(everyTreeAction().map((a) => a.id)).size).toBe(everyTreeAction().length);
});
