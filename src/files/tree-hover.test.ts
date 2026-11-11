// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { afterEach, expect, test } from "vitest";
import type { WirePath } from "../ipc";
import { useLayout } from "../store/layout";
import { dir, entry } from "./test-entries";
import { terminalFolder, useTreeHover } from "./tree-hover";

const p = (v: string): WirePath => ({ k: "Utf8", v });

afterEach(() => {
  useTreeHover.getState().set(null);
  useLayout.getState().reset();
});

test("with_nothing_under_the_pointer_the_terminal_folder_is_the_tree_root", () => {
  useLayout.getState().setTreeRoot(p("/home/a"));
  expect(terminalFolder()).toEqual(p("/home/a"));
});

test("a_folder_under_the_pointer_is_the_terminal_folder", () => {
  useLayout.getState().setTreeRoot(p("/home/a"));
  useTreeHover.getState().set("k", dir("work", { path: p("/home/a/work") }));
  expect(terminalFolder()).toEqual(p("/home/a/work"));
});

test("a_file_under_the_pointer_gives_the_folder_it_is_in", () => {
  useLayout.getState().setTreeRoot(p("/home/a"));
  useTreeHover.getState().set("k", entry("todo.md", { path: p("/home/a/work/todo.md") }));
  expect(terminalFolder()).toEqual(p("/home/a/work"));
});

test("no_root_and_nothing_under_the_pointer_gives_no_folder", () => {
  expect(terminalFolder()).toBeNull();
});

test("the_pointer_leaving_a_row_clears_it_only_when_that_row_is_the_one_held", () => {
  useTreeHover.getState().set("a", dir("a"));
  useTreeHover.getState().leave("b");
  expect(useTreeHover.getState().entry).not.toBeNull();
  useTreeHover.getState().leave("a");
  expect(useTreeHover.getState().entry).toBeNull();
});
