// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { CATEGORIES, ROWS, rowMatches, rowsShown, searching } from "./settings-search";

test("every_word_typed_must_be_found_and_case_does_not_matter", () => {
  expect(rowMatches("theme", "DARK")).toBe(true);
  expect(rowMatches("theme", "dark grid")).toBe(false);
  expect(rowMatches("show_hidden", "  hidden   dotfiles ")).toBe(true);
  // The category's name finds its rows too.
  expect(rowsShown("library", "library")).toEqual([
    "scan_documents",
    "scan_downloads",
    "scan_roots",
  ]);
});

test("an_empty_search_shows_every_row_and_is_no_search", () => {
  expect(searching("   ")).toBe(false);
  expect(searching(" a ")).toBe(true);
  for (const c of CATEGORIES) expect(rowsShown(c.id, "").length, c.id).toBeGreaterThan(0);
  expect(CATEGORIES.flatMap((c) => rowsShown(c.id, ""))).toHaveLength(Object.keys(ROWS).length);
});
