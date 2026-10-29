// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { usePanelsStore } from "../store/panels";
import { useTabs } from "../store/tabs";
import { useVolumes } from "../shell/volumes-store";
import { useOps } from "../ops/useOps";
import { VOLUME_MENU } from "../shell/volume-menu";
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
  // The main menu of the tab kind the action applies to, or the volume's own menu.
  useTabs.getState().openFolder(p("/a"), false);
  useTabs.getState().openDoc(p("/a/n.md"));
  useTabs.getState().openTrash();
  const tabs = useTabs.getState().tabs;
  const tabOf = (kind: string) => tabs.find((t) => t.kind === kind) ?? null;
  const missing: string[] = [];
  for (const a of actions) {
    const inMenu =
      a.when === "volume"
        ? VOLUME_MENU.some((s) => s.actions.includes(a))
        : menuSections(a.when === "any" ? null : tabOf(a.when)).some((s) => s.actions.includes(a));
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
