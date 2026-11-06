// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { Settings, SettingsPatch } from "../ipc";
import { SETTINGS } from "./test-settings";

const ipc = vi.hoisted(() => ({
  settingsSet: vi.fn(),
  settingsGet: vi.fn(),
  themeSetPrefs: vi.fn(),
  on: vi.fn(),
}));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { isDirty, shown, useSettingsDraft } from "./settings-draft";

const draft = () => useSettingsDraft.getState().draft;

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsDraft.getState().reset();
  useSettingsDraft.setState({ stored: { ...SETTINGS, follow: { ...SETTINGS.follow } } });
  ipc.themeSetPrefs.mockResolvedValue(undefined);
});

test("a_follow_switch_changed_back_leaves_the_draft_and_the_others_stay", () => {
  const { edit } = useSettingsDraft.getState();
  edit({ follow: { fonts: false } });
  edit({ follow: { radius: false } });
  expect(draft()).toEqual({ follow: { fonts: false, radius: false } });
  edit({ follow: { fonts: true } });
  expect(draft()).toEqual({ follow: { radius: false } });
  expect(shown(useSettingsDraft.getState())!.follow).toEqual({ ...SETTINGS.follow, radius: false });
  edit({ follow: { radius: true } });
  expect(isDirty(useSettingsDraft.getState())).toBe(false);
});

test("a_change_made_while_a_save_is_out_stays_to_be_saved", async () => {
  let finish: (s: Settings) => void = () => undefined;
  ipc.settingsSet.mockImplementation(() => new Promise<Settings>((resolve) => (finish = resolve)));
  const { edit, save } = useSettingsDraft.getState();
  edit({ word_wrap: true });
  const saving = save();
  // A second save while the first is out does nothing.
  expect(await useSettingsDraft.getState().save()).toBe(false);
  edit({ show_hidden: true });
  edit({ word_wrap: false });
  finish({ ...SETTINGS, word_wrap: true });
  expect(await saving).toBe(true);
  // word_wrap was saved as true and then changed back here: false is still to be saved.
  expect(draft()).toEqual({ show_hidden: true, word_wrap: false });
  expect(ipc.settingsSet).toHaveBeenCalledTimes(1);
});

test("a_stored_value_that_comes_to_equal_the_draft_takes_it_out", async () => {
  const handlers: ((s: Settings) => void)[] = [];
  ipc.on.mockImplementation((_name: string, h: (s: Settings) => void) => {
    handlers.push(h);
    return Promise.resolve(() => undefined);
  });
  ipc.settingsGet.mockResolvedValue(SETTINGS);
  await useSettingsDraft.getState().follow();
  useSettingsDraft.getState().edit({ view_mode: "grid", show_hidden: true });
  handlers[0]!({ ...SETTINGS, view_mode: "grid" });
  expect(draft()).toEqual({ show_hidden: true });
});

test("a_theme_that_cannot_be_applied_after_a_save_is_said_and_the_save_stands", async () => {
  ipc.settingsSet.mockImplementation((patch: SettingsPatch) =>
    Promise.resolve({ ...SETTINGS, ...patch })
  );
  ipc.themeSetPrefs.mockRejectedValue({ kind: "Io", message: "no portal", path: null });
  useSettingsDraft.getState().edit({ accent: "rose" });
  expect(await useSettingsDraft.getState().save()).toBe(false);
  const s = useSettingsDraft.getState();
  expect(s.stored!.accent).toBe("rose");
  expect(isDirty(s)).toBe(false);
  expect(s.problem).toMatch(/were saved, but the theme could not be changed to them: .*no portal/);
});

test("nothing_to_save_is_a_save_that_sends_nothing", async () => {
  expect(await useSettingsDraft.getState().save()).toBe(true);
  expect(ipc.settingsSet).not.toHaveBeenCalled();
});

test("a_save_that_fails_puts_what_it_sent_back_under_what_was_changed_since", async () => {
  let fail: (e: unknown) => void = () => undefined;
  ipc.settingsSet.mockImplementation(() => new Promise<Settings>((_, reject) => (fail = reject)));
  const { edit, save } = useSettingsDraft.getState();
  edit({ word_wrap: true, view_mode: "grid" });
  const saving = save();
  // Shown as sent while the save is out.
  expect(shown(useSettingsDraft.getState())!.word_wrap).toBe(true);
  edit({ view_mode: "list", show_hidden: true });
  fail({ kind: "Io", message: "disk full", path: null });
  expect(await saving).toBe(false);
  // view_mode was changed back to what is stored: only the other two are left to save.
  expect(draft()).toEqual({ word_wrap: true, show_hidden: true });
});

test("settled_waits_for_the_save_that_is_out", async () => {
  let finish: (s: Settings) => void = () => undefined;
  ipc.settingsSet.mockImplementation(() => new Promise<Settings>((resolve) => (finish = resolve)));
  useSettingsDraft.getState().edit({ word_wrap: true });
  void useSettingsDraft.getState().save();
  let done = false;
  const waiting = useSettingsDraft
    .getState()
    .settled()
    .then(() => (done = true));
  await Promise.resolve();
  expect(done).toBe(false);
  finish({ ...SETTINGS, word_wrap: true });
  await waiting;
  expect(done).toBe(true);
});
