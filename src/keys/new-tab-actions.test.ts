// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { waitFor } from "@testing-library/react";
import type { WirePath } from "../ipc";

const home = vi.hoisted(() => ({ fail: null as unknown }));

vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  userDirs: () =>
    home.fail
      ? Promise.reject(home.fail)
      : Promise.resolve({ home: { k: "Utf8", v: "/home/a" }, dirs: [] }),
}));

import { useViewSettings } from "../files/view-settings";
import { useOps } from "../ops/useOps";
import { useUserDirs } from "../shell/user-dirs-store";
import { useTabs, type FolderTab } from "../store/tabs";
import { actions, currentContext, getAction, isEnabled, runAction } from "./actions";

// New tab opens the folder Settings names, Home when it names none; New tab here opens the folder
// of the tab in front. Ctrl+T is the one Settings picks, Ctrl+Shift+T the other.

const p = (v: string): WirePath => ({ k: "Utf8", v });
const folders = () =>
  useTabs
    .getState()
    .tabs.filter((t): t is FolderTab => t.kind === "folder")
    .map((t) => t.path.v);

beforeEach(() => {
  home.fail = null;
  useTabs.setState({ tabs: [], activeId: null });
  useUserDirs.getState().reset();
  useOps.setState({ notice: null, earlier: [] });
  useViewSettings.setState({
    loaded: true,
    error: null,
    newTabFolder: null,
    newTabDefault: "folder",
  });
});

test("ctrl_t_is_new_tab_and_ctrl_shift_t_new_tab_here_by_default", () => {
  expect(getAction("newTab.folder").keys).toEqual(["Ctrl+T"]);
  expect(getAction("newTab.here").keys).toEqual(["Ctrl+Shift+T"]);
});

test("the_setting_swaps_the_two_keys", () => {
  useViewSettings.setState({ newTabDefault: "current" });
  expect(getAction("newTab.folder").keys).toEqual(["Ctrl+Shift+T"]);
  expect(getAction("newTab.here").keys).toEqual(["Ctrl+T"]);
  // Each key is still bound once.
  for (const key of ["Ctrl+T", "Ctrl+Shift+T"]) {
    expect(actions.filter((a) => a.keys.includes(key))).toHaveLength(1);
  }
});

test("new_tab_opens_home_when_settings_name_no_folder", async () => {
  useTabs.getState().openFolder(p("/work"), false);
  expect(runAction(getAction("newTab.folder"), currentContext())).toBe(true);
  await waitFor(() => expect(folders()).toEqual(["/work", "/home/a"]));
  // The new tab is in front.
  expect(useTabs.getState().tabs[1]!.id).toBe(useTabs.getState().activeId);
});

test("new_tab_opens_the_folder_settings_name", async () => {
  useViewSettings.setState({ newTabFolder: p("/srv/projects") });
  runAction(getAction("newTab.folder"), currentContext());
  await waitFor(() => expect(folders()).toEqual(["/srv/projects"]));
});

test("new_tab_without_a_home_folder_says_why_and_opens_nothing", async () => {
  home.fail = { kind: "Io", message: "no passwd entry", path: null, details: null };
  runAction(getAction("newTab.folder"), currentContext());
  await waitFor(() =>
    expect(useOps.getState().notice?.text).toMatch(/Home folder was not found: .*no passwd entry/)
  );
  expect(useTabs.getState().tabs).toEqual([]);
});

test("new_tab_waits_for_the_settings_and_says_so", () => {
  useViewSettings.setState({ loaded: false, error: null });
  const ctx = currentContext();
  const a = getAction("newTab.folder");
  expect(isEnabled(a, ctx)).toBe(false);
  expect(a.refusal?.(ctx)).toMatch(/still being read/);
  useViewSettings.setState({
    error: { kind: "Io", message: "unreadable", path: null, details: null },
  });
  expect(a.refusal?.(ctx)).toMatch(/could not be read: .*unreadable/);
  expect(getAction("newTab.here").refusal?.(ctx)).toMatch(/could not be read/);
});

test("new_tab_here_opens_the_folder_in_front_or_the_folder_of_a_document", () => {
  useTabs.getState().openFolder(p("/work"), false);
  runAction(getAction("newTab.here"), currentContext());
  expect(folders()).toEqual(["/work", "/work"]);
  useTabs.getState().openDoc(p("/notes/n.md"));
  runAction(getAction("newTab.here"), currentContext());
  expect(folders()).toEqual(["/work", "/work", "/notes"]);
});

test("new_tab_here_has_nothing_to_open_from_trash_and_says_so", () => {
  useTabs.getState().openTrash();
  const ctx = currentContext();
  const a = getAction("newTab.here");
  expect(isEnabled(a, ctx)).toBe(false);
  expect(a.refusal?.(ctx)).toBe("Trash has no folder to open in a new tab");
  useTabs.setState({ tabs: [], activeId: null });
  expect(a.refusal?.(currentContext())).toBe("This window has no folder to open in a new tab");
});
