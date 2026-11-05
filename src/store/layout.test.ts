// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test } from "vitest";
import type { WindowLayout, WirePath } from "../ipc";
import {
  LEFT_WIDTH_DEFAULT,
  LEFT_WIDTH_MAX,
  LEFT_WIDTH_MIN,
  RIGHT_WIDTH_DEFAULT,
  RIGHT_WIDTH_MAX,
  RIGHT_WIDTH_MIN,
  clampRightWidth,
  clampWidth,
  useLayout,
} from "./layout";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const stored = (over: Partial<WindowLayout> = {}): WindowLayout => ({
  left_width: 300,
  left_open: true,
  right_width: 300,
  tree_root: null,
  ...over,
});

beforeEach(() => useLayout.getState().reset());

test("a_window_starts_in_the_file_manager_layout_with_the_default_column", () => {
  const s = useLayout.getState();
  expect([s.layout, s.leftWidth, s.leftOpen, s.treeRoot, s.loaded]).toEqual([
    "file_manager",
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

test("pinned_and_recent_starts_at_its_default_and_stays_between_the_limits", () => {
  expect(useLayout.getState().rightWidth).toBe(RIGHT_WIDTH_DEFAULT);
  expect(clampRightWidth(0)).toBe(RIGHT_WIDTH_MIN);
  expect(clampRightWidth(10_000)).toBe(RIGHT_WIDTH_MAX);
  useLayout.getState().setRightWidth(5);
  expect(useLayout.getState().rightWidth).toBe(RIGHT_WIDTH_MIN);
});

test("the_stored_panel_width_is_read_by_the_main_window_and_by_an_editor_window", () => {
  useLayout.getState().apply(stored({ right_width: 420 }), "file_manager");
  expect(useLayout.getState().rightWidth).toBe(420);
  useLayout.getState().reset();
  useLayout.getState().applyToEditorWindow(stored({ right_width: 9999 }));
  expect(useLayout.getState().rightWidth).toBe(RIGHT_WIDTH_MAX);
});

test("the_layout_is_the_one_given_and_the_columns_and_tree_are_the_stored_ones", () => {
  useLayout.getState().apply(stored({ left_open: false, tree_root: p("/r") }), "editor");
  const s = useLayout.getState();
  expect([s.layout, s.leftWidth, s.leftOpen, s.loaded]).toEqual(["editor", 300, false, true]);
  expect(s.treeRoot).toEqual(p("/r"));
});

test("a_stored_width_out_of_range_is_clamped", () => {
  useLayout.getState().apply(stored({ left_width: 9999 }), "file_manager");
  expect(useLayout.getState().leftWidth).toBe(640);
});

test("an_editor_window_is_the_editor_layout_and_takes_only_the_width", () => {
  useLayout.getState().applyToEditorWindow(stored({ left_width: 400, left_open: false }));
  const s = useLayout.getState();
  expect([s.layout, s.leftWidth, s.leftOpen]).toEqual(["editor", 400, true]);
  useLayout.getState().reset();
  useLayout.getState().applyToEditorWindow(null);
  expect(useLayout.getState().layout).toBe("editor");
  expect(useLayout.getState().leftWidth).toBe(LEFT_WIDTH_DEFAULT);
});
