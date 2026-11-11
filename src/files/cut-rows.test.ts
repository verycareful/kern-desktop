// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WirePath } from "../ipc";
import { folderIsCut } from "./cut-rows";

const u = (v: string): WirePath => ({ k: "Utf8", v });

test("a_folder_is_cut_when_it_is_the_cut_path_or_lies_inside_it", () => {
  expect(folderIsCut(u("/a/b"), [u("/a/b")])).toBe(true);
  expect(folderIsCut(u("/a/b/c/d"), [u("/a/b")])).toBe(true);
});

test("a_folder_is_not_cut_for_a_sibling_a_child_a_name_prefix_or_nothing_cut", () => {
  expect(folderIsCut(u("/a/b"), [u("/a/c")])).toBe(false);
  expect(folderIsCut(u("/a"), [u("/a/b")])).toBe(false);
  expect(folderIsCut(u("/a/bc"), [u("/a/b")])).toBe(false);
  expect(folderIsCut(u("/a/b"), [])).toBe(false);
});

test("a_bytes_path_is_cut_only_when_it_is_the_same_path", () => {
  const bytes = (v: string): WirePath => ({ k: "Bytes", v });
  expect(folderIsCut(bytes("YWI="), [bytes("YWI=")])).toBe(true);
  expect(folderIsCut(bytes("YWIvYw=="), [bytes("YWI=")])).toBe(false);
});
