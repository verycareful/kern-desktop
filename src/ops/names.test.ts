// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { nameProblem, nameIsText } from "./names";

test("an_empty_name_is_refused", () => {
  expect(nameProblem("")).toMatch(/empty|enter a name/i);
});

test("a_slash_is_refused_anywhere_in_the_name", () => {
  for (const n of ["a/b", "/a", "a/"]) expect(nameProblem(n), n).toMatch(/\//);
});

test("a_nul_character_is_refused", () => {
  expect(nameProblem("a\0b")).toMatch(/NUL/);
});

test("dot_and_dot_dot_are_refused_but_names_that_only_start_with_dots_are_fine", () => {
  expect(nameProblem(".")).toMatch(/"\."/);
  expect(nameProblem("..")).toMatch(/"\.\."/);
  for (const n of ["...", ".hidden", "a.", "..a", "a b", " a", "a ", "ünï.txt"]) {
    expect(nameProblem(n), n).toBeNull();
  }
});

test("a_path_whose_last_component_is_not_utf8_is_told_from_one_that_is", () => {
  // "/d/<0xFF>.txt" is not UTF-8 in its name; "/\xf6/a.txt" has a bad parent only.
  expect(nameIsText({ k: "Bytes", v: btoa("/d/\xff.txt") })).toBe(false);
  expect(nameIsText({ k: "Bytes", v: btoa("/\xf6/a.txt") })).toBe(true);
  expect(nameIsText({ k: "Utf8", v: "/d/a.txt" })).toBe(true);
});
