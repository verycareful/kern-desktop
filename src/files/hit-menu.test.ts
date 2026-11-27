// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test, vi } from "vitest";

const win = vi.hoisted(() => ({ main: true }));
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  isMainWindow: () => win.main,
}));

import { usePinnedRecent } from "../shell/pinned-recent-store";
import { useLayout } from "../store/layout";
import { everyHitAction, hitMenu } from "./hit-menu";
import { dir, entry } from "./test-entries";

const ids = (e: Parameters<typeof hitMenu>[0]) =>
  hitMenu(e).flatMap((s) => s.actions.map((a) => a.id));
const file = entry("notes.md");
const folder = dir("work");

afterEach(() => {
  win.main = true;
  useLayout.getState().reset();
  usePinnedRecent.getState().reset();
});

test("a_file_hit_offers_opening_it_where_it_is_its_path_properties_and_a_pin", () => {
  useLayout.getState().setLayout("file_manager");
  expect(ids(file)).toEqual([
    "hit.open",
    "hit.openNewWindow",
    "hit.openWith",
    "hit.location",
    "hit.copyPath",
    "hit.properties",
    "hit.pin",
  ]);
});

test("a_folder_hit_offers_a_folder_tab_and_an_editor_window_in_place_of_new_window_and_open_with", () => {
  useLayout.getState().setLayout("file_manager");
  expect(ids(folder)).toEqual([
    "hit.open",
    "hit.openInFileManager",
    "hit.openAsEditor",
    "hit.location",
    "hit.copyPath",
    "hit.properties",
    "hit.pin",
  ]);
});

test("a_pinned_hit_offers_unpin", () => {
  usePinnedRecent.setState({ pins: [file.path] });
  expect(ids(file)).toContain("hit.unpin");
  expect(ids(file)).not.toContain("hit.pin");
});

test("the_main_window_in_the_editor_layout_leaves_out_what_needs_a_folder_tab", () => {
  useLayout.getState().setLayout("editor");
  expect(ids(folder)).not.toContain("hit.openInFileManager");
  expect(ids(folder)).not.toContain("hit.location");
  expect(ids(file)).not.toContain("hit.location");
});

test("an_editor_window_leaves_out_properties_and_keeps_the_folder_tab_actions", () => {
  win.main = false;
  expect(ids(file)).not.toContain("hit.properties");
  expect(ids(folder)).toContain("hit.openInFileManager");
  expect(ids(folder)).toContain("hit.location");
});

test("every_hit_action_is_in_some_form_of_the_menu", () => {
  const every = everyHitAction();
  expect(every.every((a) => a.when === "hit")).toBe(true);
  expect(new Set(every.map((a) => a.id)).size).toBe(every.length);
  const listed = new Set(
    [file, folder].flatMap((e) => {
      usePinnedRecent.setState({ pins: [] });
      const a = ids(e);
      usePinnedRecent.setState({ pins: [e.path] });
      return [...a, ...ids(e)];
    })
  );
  expect(every.map((a) => a.id).filter((id) => !listed.has(id))).toEqual([]);
});
