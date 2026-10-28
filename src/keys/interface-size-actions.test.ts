// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Settings } from "../ipc";

const ipc = vi.hoisted(() => ({ settingsSet: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { useViewSettings } from "../files/view-settings";
import { useTabs } from "../store/tabs";
import { actions, currentContext, getAction, isEnabled, menuSections, runAction } from "./actions";

const IDS = ["view.size.larger", "view.size.smaller", "view.size.reset"];

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useViewSettings.setState({ loaded: true, interfaceSize: 90, error: null });
  ipc.settingsSet.mockImplementation((patch: Partial<Settings>) =>
    Promise.resolve({ show_hidden: false, view_mode: "list", density: "cozy", ...patch })
  );
});
afterEach(() => vi.clearAllMocks());

test("the_three_actions_have_the_ruled_labels_and_no_keys", () => {
  expect(IDS.map((id) => getAction(id).label)).toEqual([
    "Larger interface",
    "Smaller interface",
    "Reset interface size",
  ]);
  for (const id of IDS) expect(getAction(id).keys, id).toEqual([]);
  // The editor's Ctrl+= and Ctrl+- stay free for text zoom.
  expect(actions.flatMap((a) => a.keys)).not.toContain("Ctrl+=");
  expect(actions.flatMap((a) => a.keys)).not.toContain("Ctrl+-");
});

test("they_are_in_the_main_menu_whatever_tab_is_active", () => {
  for (const tab of [null, { id: "t", kind: "trash" as const }]) {
    const listed = menuSections(tab).flatMap((s) => s.actions.map((a) => a.id));
    for (const id of IDS) expect(listed, id).toContain(id);
  }
});

test("larger_and_smaller_write_the_next_size", async () => {
  expect(runAction(getAction("view.size.larger"), currentContext())).toBe(true);
  await vi.waitFor(() => expect(ipc.settingsSet).toHaveBeenLastCalledWith({ interface_size: 100 }));
  expect(useViewSettings.getState().interfaceSize).toBe(100);
  runAction(getAction("view.size.smaller"), currentContext());
  await vi.waitFor(() => expect(ipc.settingsSet).toHaveBeenLastCalledWith({ interface_size: 90 }));
});

test("the_ends_and_the_default_disable_the_matching_action", () => {
  useViewSettings.setState({ interfaceSize: 125 });
  expect(isEnabled(getAction("view.size.larger"), currentContext())).toBe(false);
  expect(isEnabled(getAction("view.size.smaller"), currentContext())).toBe(true);
  expect(isEnabled(getAction("view.size.reset"), currentContext())).toBe(true);
  useViewSettings.setState({ interfaceSize: 80 });
  expect(isEnabled(getAction("view.size.smaller"), currentContext())).toBe(false);
  useViewSettings.setState({ interfaceSize: 90 });
  expect(isEnabled(getAction("view.size.reset"), currentContext())).toBe(false);
});

test("reset_writes_the_default", async () => {
  useViewSettings.setState({ interfaceSize: 125 });
  runAction(getAction("view.size.reset"), currentContext());
  await vi.waitFor(() => expect(ipc.settingsSet).toHaveBeenLastCalledWith({ interface_size: 90 }));
});

test("until_the_settings_are_loaded_all_three_are_greyed_and_do_nothing", () => {
  // The size shown before the settings are read is the default, not the user's: stepping from
  // it would write a size from a value that is not theirs.
  useViewSettings.setState({ loaded: false, interfaceSize: 125 });
  for (const id of IDS) expect(isEnabled(getAction(id), currentContext()), id).toBe(false);
  expect(runAction(getAction("view.size.smaller"), currentContext())).toBe(false);
  expect(ipc.settingsSet).not.toHaveBeenCalled();
  useViewSettings.setState({ loaded: true });
  expect(isEnabled(getAction("view.size.smaller"), currentContext())).toBe(true);
});
