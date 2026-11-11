// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test } from "vitest";
import { DEFAULT_TREE_SORT, orderWords, useTreeSort } from "./tree-sort";

afterEach(() => useTreeSort.setState({ sort: DEFAULT_TREE_SORT }));

test("the_tree_starts_in_name_order_a_to_z", () => {
  expect(useTreeSort.getState().sort).toEqual({ by: "name", dir: "asc" });
});

test("choosing_another_field_applies_its_own_first_direction", () => {
  const { chooseBy } = useTreeSort.getState();
  chooseBy("size");
  expect(useTreeSort.getState().sort).toEqual({ by: "size", dir: "desc" });
  chooseBy("modified");
  expect(useTreeSort.getState().sort).toEqual({ by: "modified", dir: "desc" });
  chooseBy("type");
  expect(useTreeSort.getState().sort).toEqual({ by: "type", dir: "asc" });
  chooseBy("name");
  expect(useTreeSort.getState().sort).toEqual({ by: "name", dir: "asc" });
});

test("choosing_the_field_already_chosen_keeps_the_direction_the_user_set", () => {
  const { chooseBy, chooseDir } = useTreeSort.getState();
  chooseBy("size");
  chooseDir("asc");
  chooseBy("size");
  expect(useTreeSort.getState().sort).toEqual({ by: "size", dir: "asc" });
});

test("choosing_a_direction_keeps_the_field", () => {
  useTreeSort.getState().chooseBy("modified");
  useTreeSort.getState().chooseDir("asc");
  expect(useTreeSort.getState().sort).toEqual({ by: "modified", dir: "asc" });
});

test("the_order_is_named_in_the_words_of_the_field", () => {
  expect(orderWords("name", "asc")).toBe("A to Z");
  expect(orderWords("name", "desc")).toBe("Z to A");
  expect(orderWords("type", "asc")).toBe("A to Z");
  expect(orderWords("size", "asc")).toBe("Smallest first");
  expect(orderWords("size", "desc")).toBe("Largest first");
  expect(orderWords("modified", "asc")).toBe("Oldest first");
  expect(orderWords("modified", "desc")).toBe("Newest first");
});
