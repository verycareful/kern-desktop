// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test } from "vitest";
import { useTabs } from "../store/tabs";
import { DEFAULT_SORT, useFolderUi } from "./folder-ui";

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
  useFolderUi.setState({ sort: {} });
});

test("a_new_tab_sorts_by_name_ascending", () => {
  expect(useFolderUi.getState().sortOf("t")).toEqual(DEFAULT_SORT);
  expect(DEFAULT_SORT).toEqual({ by: "name", dir: "asc" });
});

test("choosing_a_field_uses_its_default_direction_and_choosing_it_again_flips", () => {
  const ui = () => useFolderUi.getState();
  // Handoff README, Sort: Date and Size start descending, Name and Type ascending.
  ui().chooseSort("t", "size");
  expect(ui().sortOf("t")).toEqual({ by: "size", dir: "desc" });
  ui().chooseSort("t", "size");
  expect(ui().sortOf("t")).toEqual({ by: "size", dir: "asc" });
  ui().chooseSort("t", "modified");
  expect(ui().sortOf("t")).toEqual({ by: "modified", dir: "desc" });
  ui().chooseSort("t", "type");
  expect(ui().sortOf("t")).toEqual({ by: "type", dir: "asc" });
  ui().chooseSort("t", "name");
  expect(ui().sortOf("t")).toEqual({ by: "name", dir: "asc" });
  // Tabs sort independently.
  expect(ui().sortOf("other")).toEqual(DEFAULT_SORT);
});

test("a_closed_tab_is_forgotten", () => {
  useTabs.getState().openFolder({ k: "Utf8", v: "/a" }, false);
  const id = useTabs.getState().activeId!;
  useFolderUi.getState().chooseSort(id, "size");
  useTabs.getState().close(id);
  expect(useFolderUi.getState().sort[id]).toBeUndefined();
});
