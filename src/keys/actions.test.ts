// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { usePanelsStore } from "../store/panels";
import { useLayout } from "../store/layout";
import { useTreeMenu } from "../files/tree-menu-store";
import { dir, entry } from "../files/test-entries";
import { useTabs } from "../store/tabs";
import { useVolumes } from "../shell/volumes-store";
import { useOps } from "../ops/useOps";
import { VOLUME_MENU } from "../shell/volume-menu";
import { ENTRY_MENU } from "../shell/entry-menu";
import { TREE_MENU } from "../files/tree-menu";
import { usePinnedRecent } from "../shell/pinned-recent-store";
import { useProperties } from "../files/properties-store";
import { registerFolder, type FolderController } from "../files/folder-controller";
import { known } from "../shell/test-volumes";
import {
  actions,
  currentContext,
  findDuplicateBindings,
  getAction,
  isEnabled,
  menuSections,
  runAction,
} from "./actions";

const p = (v: string): WirePath => ({ k: "Utf8", v });

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  usePanelsStore.setState({ leftSlid: false, rightSlid: false });
});

test("tab_close_runs_on_the_target_tab_not_the_active_one", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openFolder(p("/b"), true);
  const [a, b] = useTabs.getState().tabs.map((t) => t.id) as [string, string];
  expect(useTabs.getState().activeId).toBe(b);
  expect(runAction(getAction("tab.close"), currentContext(a))).toBe(true);
  expect(useTabs.getState().tabs.map((t) => t.id)).toEqual([b]);
  expect(useTabs.getState().activeId).toBe(b);
  // No target given: the active tab.
  runAction(getAction("tab.close"), currentContext());
  expect(useTabs.getState().tabs).toHaveLength(0);
});

test("every_action_has_an_area", () => {
  for (const a of actions) expect(a.area, a.id).toMatch(/\S/);
});

test("applicability_follows_the_target_tab", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openDoc(p("/a/n.md"));
  const [folder, doc] = useTabs.getState().tabs.map((t) => t.id) as [string, string];
  useTabs.getState().activate(folder);
  // Active is a folder tab, but the menu was opened on the document tab.
  expect(isEnabled(getAction("panel.left.toggle"), currentContext())).toBe(false);
  expect(isEnabled(getAction("panel.left.toggle"), currentContext(doc))).toBe(true);
});

test("folder_actions_apply_to_folder_tabs_only", () => {
  const folderActions = actions.filter((a) => a.id.startsWith("folder."));
  expect(folderActions.length).toBeGreaterThan(10);
  for (const a of folderActions) expect(a.when, a.id).toBe("folder");
  useTabs.getState().openDoc(p("/a/n.md"));
  for (const a of folderActions) expect(isEnabled(a, currentContext()), a.id).toBe(false);
});

test("the_folder_shortcuts_of_design_4_5_are_bound", () => {
  const keyOf = (id: string) => getAction(id).keys;
  expect(keyOf("folder.location")).toContain("Ctrl+L");
  expect(keyOf("folder.hidden.toggle")).toContain("Ctrl+H");
  expect(keyOf("folder.refresh")).toContain("F5");
  expect(keyOf("folder.open")).toContain("Enter");
  expect(keyOf("folder.select.all")).toContain("Ctrl+A");
  expect(keyOf("folder.terminal")).toContain("F4");
  expect(keyOf("folder.copyPath")).toContain("Ctrl+Shift+C");
  expect(keyOf("folder.search")).toContain("Ctrl+F");
});

test("folder_actions_without_a_mounted_folder_view_are_disabled", () => {
  useTabs.getState().openFolder(p("/a"), false);
  expect(isEnabled(getAction("folder.refresh"), currentContext())).toBe(false);
  expect(isEnabled(getAction("folder.select.all"), currentContext())).toBe(false);
  // Settings-backed and sort actions need no controller.
  expect(isEnabled(getAction("folder.hidden.toggle"), currentContext())).toBe(true);
  expect(isEnabled(getAction("folder.sort.size"), currentContext())).toBe(true);
});

test("trash_actions_apply_to_the_trash_tab_only", () => {
  const trash = actions.filter((a) => a.id.startsWith("trash."));
  expect(trash.length).toBeGreaterThan(5);
  for (const a of trash) expect(a.when, a.id).toBe("trash");
  useTabs.getState().openFolder(p("/a"), false);
  for (const a of trash) expect(isEnabled(a, currentContext()), a.id).toBe(false);
  // The Trash tab has no folder actions.
  useTabs.getState().openTrash();
  for (const a of actions.filter((x) => x.id.startsWith("folder."))) {
    expect(isEnabled(a, currentContext()), a.id).toBe(false);
  }
});

test("the_trash_keys_do_not_collide_with_each_other_or_the_any_actions", () => {
  expect(findDuplicateBindings()).toEqual([]);
});

test("volume_actions_are_aimed_at_the_current_volume_and_grey_out_without_one", () => {
  useVolumes.getState().reset();
  const unmount = getAction("volume.unmount");
  const mount = getAction("volume.mount");
  const eject = getAction("volume.eject");
  for (const a of [unmount, mount, eject]) expect(isEnabled(a, currentContext()), a.id).toBe(false);
  const m = (removable: boolean) => ({
    mount_point: p("/mnt/x"),
    identity: known("X"),
    device: "/dev/sdb1",
    fs_type: "ext4",
    label: "X",
    removable,
    read_only: false,
  });
  useVolumes.setState({ mounted: [m(false)], unmounted: [] });
  useVolumes.getState().setCurrent(useVolumes.getState().volumes()[0]!.key);
  expect(isEnabled(unmount, currentContext())).toBe(true);
  // Eject is for removable drives; a fixed disk is only unmounted.
  expect(isEnabled(eject, currentContext())).toBe(false);
  expect(isEnabled(mount, currentContext())).toBe(false);
  useVolumes.setState({ mounted: [m(true)] });
  expect(isEnabled(eject, currentContext())).toBe(true);
  // Busy volumes take no second action.
  useVolumes.setState({ busy: { [useVolumes.getState().current!]: "Ejecting…" } });
  expect(isEnabled(eject, currentContext())).toBe(false);
  // A volume with no identity takes none of the three.
  useVolumes.setState({
    mounted: [{ ...m(true), identity: { state: "unknown", reason: "no diskseq" } }],
    busy: {},
  });
  useVolumes.getState().setCurrent(useVolumes.getState().volumes()[0]!.key);
  expect(isEnabled(unmount, currentContext())).toBe(false);
  expect(isEnabled(eject, currentContext())).toBe(false);
  useVolumes.getState().reset();
});

test("refresh_volumes_is_greyed_while_no_strip_follows_the_volumes", async () => {
  const refresh = getAction("volumes.refresh");
  useVolumes.getState().reset();
  expect(isEnabled(refresh, currentContext())).toBe(false);
  useVolumes.setState({ followers: 1 });
  expect(isEnabled(refresh, currentContext())).toBe(true);
  useVolumes.getState().reset();
});

test("every_action_is_in_a_menu", () => {
  // The main menu of the tab kind the action applies to, or the volume's or entry's own menu.
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openDoc(p("/a/n.md"));
  useTabs.getState().openTrash();
  useTabs.getState().openDocuments();
  const tabs = useTabs.getState().tabs;
  const tabOf = (kind: string) => tabs.find((t) => t.kind === kind) ?? null;
  const missing: string[] = [];
  for (const a of actions) {
    const inMenu =
      a.when === "volume"
        ? VOLUME_MENU.some((s) => s.actions.includes(a))
        : a.when === "entry"
          ? ENTRY_MENU.some((s) => s.actions.includes(a))
          : a.when === "tree"
            ? TREE_MENU.some((s) => s.actions.includes(a))
            : menuSections(a.when === "any" ? null : tabOf(a.when)).some((s) =>
                s.actions.includes(a)
              );
    if (!inMenu) missing.push(a.id);
  }
  expect(missing).toEqual([]);
});

test("the_file_operation_shortcuts_are_bound", () => {
  const keys = (id: string) => getAction(id).keys;
  expect(keys("folder.copy")).toEqual(["Ctrl+C"]);
  expect(keys("folder.cut")).toEqual(["Ctrl+X"]);
  expect(keys("folder.paste")).toEqual(["Ctrl+V"]);
  expect(keys("folder.rename")).toEqual(["F2"]);
  expect(keys("folder.trash")).toEqual(["Delete"]);
  expect(keys("folder.delete")).toEqual(["Shift+Delete"]);
  expect(keys("folder.new.folder")).toEqual(["Ctrl+Shift+N"]);
  expect(keys("folder.undo")).toEqual(["Ctrl+Z"]);
  expect(keys("folder.redo")).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
});

test("the_file_operations_are_folder_tab_actions_in_the_edit_and_create_groups", () => {
  const ids = [
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "rename",
    "trash",
    "delete",
    "new.folder",
    "new.file",
  ].map((s) => `folder.${s}`);
  for (const id of ids) expect(getAction(id).when, id).toBe("folder");
  expect(ids.slice(0, 8).map((id) => getAction(id).area)).toEqual(Array(8).fill("Edit"));
  expect(ids.slice(8).map((id) => getAction(id).area)).toEqual(["Create", "Create"]);
});

test("the_undo_and_redo_labels_come_from_the_undo_state", () => {
  useOps.getState().reset();
  expect(getAction("folder.undo").menuLabel?.()).toBe("Undo");
  expect(getAction("folder.redo").menuLabel?.()).toBe("Redo");
  useOps.setState({ undoLabel: "Undo trash of a.txt", redoLabel: "Redo copy of 3 items" });
  expect(getAction("folder.undo").menuLabel?.()).toBe("Undo trash of a.txt");
  expect(getAction("folder.redo").menuLabel?.()).toBe("Redo copy of 3 items");
  useOps.getState().reset();
});

test("undo_and_redo_are_enabled_only_when_there_is_something_to_undo_or_redo", () => {
  useTabs.getState().openFolder(p("/a"), false);
  useOps.getState().reset();
  expect(isEnabled(getAction("folder.undo"), currentContext())).toBe(false);
  expect(isEnabled(getAction("folder.redo"), currentContext())).toBe(false);
  useOps.setState({ undoLabel: "Undo create of x" });
  expect(isEnabled(getAction("folder.undo"), currentContext())).toBe(true);
  expect(isEnabled(getAction("folder.redo"), currentContext())).toBe(false);
  useOps.getState().reset();
});

test("a_document_tab_leaves_undo_to_its_editor", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  useOps.setState({ undoLabel: "Undo create of x" });
  expect(isEnabled(getAction("folder.undo"), currentContext())).toBe(false);
  useOps.getState().reset();
});

test("ctrl_d_pins_the_selection_and_nothing_else", () => {
  expect(getAction("folder.pin").keys).toContain("Ctrl+D");
  useTabs.getState().openFolder(p("/a"), false);
  const tab = useTabs.getState().tabs[0]!;
  const pinPaths = vi.fn(() => Promise.resolve(true));
  const original = usePinnedRecent.getState().pinPaths;
  usePinnedRecent.setState({ pinPaths });
  let selection: WirePath[] = [];
  const off = registerFolder(tab.id, {
    hasSelection: () => selection.length > 0,
    selectedPaths: () => selection,
  } as Partial<FolderController> as FolderController);
  try {
    // An outlined item alone is not a selection: nothing to pin.
    expect(runAction(getAction("folder.pin"), currentContext())).toBe(false);
    selection = [p("/a/x"), p("/a/y")];
    expect(runAction(getAction("folder.pin"), currentContext())).toBe(true);
    expect(pinPaths).toHaveBeenCalledExactlyOnceWith([p("/a/x"), p("/a/y")]);
  } finally {
    off();
    usePinnedRecent.setState({ pinPaths: original });
  }
});

test("entry_actions_follow_the_entry_the_menu_was_opened_on", () => {
  const ctx = currentContext();
  const enabled = () => ENTRY_MENU[0]!.actions.filter((a) => isEnabled(a, ctx)).map((a) => a.id);
  usePinnedRecent.setState({ pins: [p("/a"), p("/b")], current: null });
  try {
    expect(enabled()).toEqual([]);
    usePinnedRecent.setState({ current: { list: "pinned", path: p("/a") } });
    expect(enabled()).toEqual(["entry.open", "entry.unpin", "entry.down"]);
    usePinnedRecent.setState({ current: { list: "pinned", path: p("/b") } });
    expect(enabled()).toEqual(["entry.open", "entry.unpin", "entry.up"]);
    // A recent entry that is also pinned can be unpinned there, not moved.
    usePinnedRecent.setState({ current: { list: "recent", path: p("/b") } });
    expect(enabled()).toEqual(["entry.open", "entry.unpin"]);
    usePinnedRecent.setState({ current: { list: "recent", path: p("/c") } });
    expect(enabled()).toEqual(["entry.open", "entry.pin"]);
  } finally {
    usePinnedRecent.getState().reset();
  }
});

test("properties_shows_the_selection_or_else_the_folder", () => {
  expect(getAction("folder.properties").keys).toContain("Alt+Enter");
  useTabs.getState().openFolder(p("/a"), false);
  const tab = useTabs.getState().tabs[0]!;
  let selection: WirePath[] = [];
  const off = registerFolder(tab.id, {
    selectedPaths: () => selection,
  } as Partial<FolderController> as FolderController);
  try {
    runAction(getAction("folder.properties"), currentContext());
    expect(useProperties.getState().paths).toEqual([p("/a")]);
    selection = [p("/a/x"), p("/a/y")];
    runAction(getAction("folder.properties"), currentContext());
    expect(useProperties.getState().paths).toEqual([p("/a/x"), p("/a/y")]);
  } finally {
    off();
    useProperties.getState().close();
  }
});

test("open_as_editor_is_a_folder_action_of_the_open_group_that_asks_the_folder_view", () => {
  const a = getAction("folder.openAsEditor");
  expect([a.label, a.area, a.when, a.keys]).toEqual(["Open as editor", "Open", "folder", []]);
  useTabs.getState().openFolder(p("/a"), false);
  const tab = useTabs.getState().tabs[0]!;
  // No folder view mounted: greyed.
  expect(isEnabled(a, currentContext())).toBe(false);
  const openAsEditor = vi.fn();
  let can = false;
  const off = registerFolder(tab.id, {
    canOpenAsEditor: () => can,
    openAsEditor,
  } as Partial<FolderController> as FolderController);
  try {
    expect(runAction(a, currentContext())).toBe(false);
    can = true;
    expect(runAction(a, currentContext())).toBe(true);
    expect(openAsEditor).toHaveBeenCalledTimes(1);
    // It is in the main menu of a folder tab, and so in the folder view's context menu (by area).
    expect(menuSections(tab).some((s) => s.actions.includes(a))).toBe(true);
  } finally {
    off();
  }
});

test("the_layout_actions_belong_to_the_main_window_and_the_column_toggle_to_the_editor_layout", () => {
  useLayout.getState().reset();
  const to = (id: string) => isEnabled(getAction(id), currentContext());
  // Before the stored layout is read nothing can be chosen.
  expect([to("layout.editor"), to("layout.fileManager"), to("layout.left.toggle")]).toEqual([
    false,
    false,
    false,
  ]);
  useLayout
    .getState()
    .apply({ layout: null, left_width: 280, left_open: true, tree_root: p("/a") }, "file_manager");
  expect([to("layout.editor"), to("layout.fileManager"), to("layout.left.toggle")]).toEqual([
    true,
    false,
    false,
  ]);
  useLayout.getState().setLayout("editor");
  expect([to("layout.editor"), to("layout.fileManager"), to("layout.left.toggle")]).toEqual([
    false,
    true,
    true,
  ]);
  useLayout.getState().reset();
});

test("the_tree_action_is_aimed_at_the_entry_the_menu_was_opened_on", () => {
  const a = getAction("tree.openAsEditor");
  expect(isEnabled(a, currentContext())).toBe(false);
  useTreeMenu.getState().setCurrent(dir("sub"));
  expect(isEnabled(a, currentContext())).toBe(true);
  useTreeMenu.getState().setCurrent(entry("a.txt"));
  expect(isEnabled(a, currentContext())).toBe(false);
  useTreeMenu.getState().setCurrent(null);
  // It is not part of any tab's main menu.
  expect(menuSections(null).some((s) => s.actions.includes(a))).toBe(false);
});

test("move_to_new_window_is_in_the_menu_of_a_document_tab_and_not_in_a_folder_tabs", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const detach = getAction("tab.detach");
  const tabs = useTabs.getState().tabs;
  const folder = tabs.find((t) => t.kind === "folder") ?? null;
  const doc = tabs.find((t) => t.kind === "doc")!;
  // Hidden, not greyed: a folder tab cannot be moved, so the entry is not there to be greyed.
  expect(menuSections(doc).some((s) => s.actions.includes(detach))).toBe(true);
  if (folder) expect(menuSections(folder).some((s) => s.actions.includes(detach))).toBe(false);
  expect(menuSections(null).some((s) => s.actions.includes(detach))).toBe(false);
});

test("move_to_new_window_is_offered_for_a_document_tab_of_an_editor_window_too", () => {
  useTabs.getState().openDoc(p("/a/n.md"));
  const detach = getAction("tab.detach");
  const labelled = (label: string | null) => {
    if (label === null) delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    else
      (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label } },
      };
    return isEnabled(detach, currentContext());
  };
  try {
    expect(labelled("main")).toBe(true);
    expect(labelled("editor-3")).toBe(true);
    // A document window is the document: there is nothing to move it out of.
    expect(labelled("doc-1")).toBe(false);
  } finally {
    labelled(null);
  }
});
