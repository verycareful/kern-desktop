// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { actions, getAction } from "../keys/actions";
import { areasOf, holdersOf, matchesQuery } from "./keys-model";

const ids = (list: { id: string }[]) => list.map((a) => a.id);

test("a_bind_is_held_by_the_other_actions_that_are_in_force_where_the_action_is", () => {
  const next = getAction("tab.next");
  // Ctrl+W is Close tab's, and Close tab applies anywhere, so it applies where Next tab does.
  expect(ids(holdersOf("Ctrl+W", next, {}))).toEqual(["tab.close"]);
  // The action's own bind is not a conflict with itself.
  expect(holdersOf("Ctrl+W", getAction("tab.close"), {})).toEqual([]);
  // A key nothing holds.
  expect(holdersOf("Ctrl+Alt+Shift+F11", next, {})).toEqual([]);
});

test("the_users_binds_decide_who_holds_a_bind_not_the_defaults", () => {
  const next = getAction("tab.next");
  // Close tab was given another key: Ctrl+W is free, and the new key is Close tab's.
  const overrides = { "tab.close": ["F9"] };
  expect(holdersOf("Ctrl+W", next, overrides)).toEqual([]);
  expect(ids(holdersOf("F9", next, overrides))).toEqual(["tab.close"]);
  // An action left unbound holds nothing.
  expect(holdersOf("Ctrl+W", next, { "tab.close": [] })).toEqual([]);
});

test("actions_of_tab_kinds_that_never_meet_do_not_hold_each_others_binds", () => {
  const save = getAction("doc.save");
  const refresh = getAction("folder.refresh");
  const overrides = { "doc.save": ["F8"], "folder.refresh": ["F8"] };
  expect(holdersOf("F8", save, overrides)).toEqual([]);
  expect(holdersOf("F8", refresh, overrides)).toEqual([]);
  // But an action that applies anywhere meets both.
  expect(ids(holdersOf("F8", getAction("tab.next"), overrides)).sort()).toEqual([
    "doc.save",
    "folder.refresh",
  ]);
});

test("a_mouse_bind_over_a_tab_and_one_over_the_window_do_not_hold_each_other", () => {
  // Close tab's middle click answers over a tab only; a window-wide middle click is another thing.
  expect(holdersOf("MiddleClick", getAction("tab.next"), {})).toEqual([]);
  expect(holdersOf("MiddleClick", getAction("tab.close"), { "tab.next": ["MiddleClick"] })).toEqual(
    []
  );
  // Two window-wide actions do.
  expect(ids(holdersOf("MouseBack", getAction("tab.next"), { "tab.prev": ["MouseBack"] }))).toEqual(
    ["tab.prev"]
  );
});

test("actions_are_grouped_by_area_in_table_order_and_none_is_lost", () => {
  const groups = areasOf(actions);
  expect(groups.flatMap((g) => g.actions)).toHaveLength(actions.length);
  expect(groups[0]!.area).toBe(actions[0]!.area);
  expect(new Set(groups.map((g) => g.area)).size).toBe(groups.length);
});

test("a_filter_finds_an_action_by_its_name_area_place_or_current_bind", () => {
  const close = getAction("tab.close");
  expect(matchesQuery(close, {}, "")).toBe(true);
  expect(matchesQuery(close, {}, "CLOSE tab")).toBe(true);
  expect(matchesQuery(close, {}, "ctrl+w")).toBe(true);
  expect(matchesQuery(close, {}, "middleclick")).toBe(true);
  expect(matchesQuery(close, {}, "tabs")).toBe(true);
  expect(matchesQuery(close, {}, "anywhere")).toBe(true);
  expect(matchesQuery(close, {}, "refresh")).toBe(false);
  // After the user moved it, the new bind finds it and the old one does not.
  expect(matchesQuery(close, { "tab.close": ["F9"] }, "f9")).toBe(true);
  expect(matchesQuery(close, { "tab.close": ["F9"] }, "ctrl+w")).toBe(false);
});
