// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test } from "vitest";
import type { WindowLayout, WirePath } from "../ipc";
import {
  LEFT_WIDTH_DEFAULT,
  LEFT_WIDTH_MAX,
  LEFT_WIDTH_MIN,
  clampWidth,
  useLayout,
} from "./layout";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const stored = (over: Partial<WindowLayout> = {}): WindowLayout => ({
  layout: null,
  left_width: 300,
  left_open: true,
  tree_root: null,
  ...over,
});

beforeEach(() => useLayout.getState().reset());

test("a_window_starts_in_the_file_manager_layout_with_the_default_column", () => {
  const s = useLayout.getState();
  expect([s.layout, s.chosen, s.leftWidth, s.leftOpen, s.treeRoot, s.loaded]).toEqual([
    "file_manager",
    false,
    LEFT_WIDTH_DEFAULT,
    true,
    null,
    false,
  ]);
});

test("the_width_stays_between_the_limits_the_backend_also_enforces", () => {
  expect(LEFT_WIDTH_MIN).toBe(180);
  expect(LEFT_WIDTH_MAX).toBe(640);
  expect(clampWidth(0)).toBe(180);
  expect(clampWidth(10_000)).toBe(640);
  expect(clampWidth(300.6)).toBe(301);
  useLayout.getState().setLeftWidth(5);
  expect(useLayout.getState().leftWidth).toBe(180);
});

test("a_stored_layout_wins_over_the_default_and_none_chosen_follows_the_default", () => {
  useLayout
    .getState()
    .apply(stored({ layout: "editor", left_open: false, tree_root: p("/r") }), "file_manager");
  let s = useLayout.getState();
  expect([s.layout, s.chosen, s.leftWidth, s.leftOpen, s.loaded]).toEqual([
    "editor",
    true,
    300,
    false,
    true,
  ]);
  expect(s.treeRoot).toEqual(p("/r"));
  useLayout.getState().reset();
  useLayout.getState().apply(stored(), "editor");
  s = useLayout.getState();
  // The default is used, but it is not a choice: it is not written back.
  expect([s.layout, s.chosen]).toEqual(["editor", false]);
});

test("a_stored_width_out_of_range_is_clamped", () => {
  useLayout.getState().apply(stored({ left_width: 9999 }), "file_manager");
  expect(useLayout.getState().leftWidth).toBe(640);
});

test("an_editor_window_is_the_editor_layout_and_takes_only_the_width", () => {
  useLayout
    .getState()
    .applyToEditorWindow(stored({ layout: "file_manager", left_width: 400, left_open: false }));
  const s = useLayout.getState();
  expect([s.layout, s.leftWidth, s.leftOpen, s.chosen]).toEqual(["editor", 400, true, false]);
  useLayout.getState().reset();
  useLayout.getState().applyToEditorWindow(null);
  expect(useLayout.getState().layout).toBe("editor");
  expect(useLayout.getState().leftWidth).toBe(LEFT_WIDTH_DEFAULT);
});

test("switching_the_layout_is_a_choice", () => {
  useLayout.getState().setLayout("editor");
  expect([useLayout.getState().layout, useLayout.getState().chosen]).toEqual(["editor", true]);
});
