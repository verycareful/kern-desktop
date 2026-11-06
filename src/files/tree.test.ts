// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { pathKey, type WireEntry, type WireError, type WirePath } from "../ipc";
import { entry } from "./test-entries";
import {
  branchPaths,
  closeFolder,
  flatten,
  indexByKey,
  isInside,
  newModel,
  openFolder,
  setLink,
  treeKey,
  updateFolder,
  type EntryRow,
  type Row,
  type TreeModel,
} from "./tree";

const p = (v: string): WirePath => ({ k: "Utf8", v });
const file = (dir: string, name: string): WireEntry => entry(name, {}, dir);
const folder = (dir: string, name: string): WireEntry =>
  entry(name, { kind: "dir", target_is_dir: true }, dir);
const link = (dir: string, name: string): WireEntry =>
  entry(name, { kind: "symlink", target_is_dir: true }, dir);
const err = (kind: string): WireError => ({
  kind,
  message: kind.toLowerCase(),
  path: null,
  details: null,
});

/** /r holds folder a (holding b.txt and folder c), file z.txt; a and c are open. */
function sample(): TreeModel {
  let m = newModel(p("/r"));
  m = updateFolder(m, pathKey(p("/r")), (n) => ({
    ...n,
    listing: { state: "ready", entries: [folder("/r", "a"), file("/r", "z.txt")] },
  }));
  m = openFolder(m, pathKey(p("/r/a")), {
    path: p("/r/a"),
    parent: pathKey(p("/r")),
    listing: { state: "ready", entries: [folder("/r/a", "c"), file("/r/a", "b.txt")] },
    watchError: null,
  });
  return m;
}
const entries = (rows: Row[]): EntryRow[] => rows.filter((r): r is EntryRow => r.kind === "entry");

test("flatten_lists_the_entries_of_an_open_folder_right_after_it", () => {
  const rows = flatten(sample());
  expect(entries(rows).map((r) => [r.entry.name, r.depth, r.expanded])).toEqual([
    ["a", 0, true],
    ["c", 1, false],
    ["b.txt", 1, false],
    ["z.txt", 0, false],
  ]);
  // Sibling counts are per folder: a is 1 of 2 in /r, c is 1 of 2 in /r/a.
  const [a, c, b, z] = entries(rows);
  expect([a!.posInSet, a!.setSize, c!.posInSet, c!.setSize]).toEqual([1, 2, 1, 2]);
  expect([b!.posInSet, z!.posInSet]).toEqual([2, 2]);
  expect(c!.parentKey).toBe(pathKey(p("/r/a")));
});

test("a_folder_not_yet_listed_or_failed_or_empty_or_unwatched_says_so_in_a_row_of_its_own", () => {
  const key = pathKey(p("/r"));
  let m = newModel(p("/r"));
  expect(flatten(m)).toMatchObject([{ kind: "note", tone: "info", text: "Listing…", depth: 0 }]);
  m = updateFolder(m, key, (n) => ({ ...n, listing: { state: "error", error: err("Io") } }));
  expect(flatten(m)).toMatchObject([{ kind: "note", tone: "error", text: "Io: io" }]);
  m = updateFolder(m, key, (n) => ({ ...n, listing: { state: "ready", entries: [] } }));
  expect(flatten(m)).toMatchObject([{ kind: "note", text: "Empty folder" }]);
  m = updateFolder(m, key, (n) => ({
    ...n,
    watchError: err("Watch"),
    listing: { state: "ready", entries: [file("/r", "a")] },
  }));
  const rows = flatten(m);
  expect(rows[0]).toMatchObject({ kind: "note", tone: "error" });
  expect((rows[0] as { text: string }).text).toMatch(/Changes in this folder will not show/);
  expect(rows[1]).toMatchObject({ kind: "entry" });
});

test("a_link_back_to_a_folder_above_is_a_loop_row_and_is_not_listed", () => {
  let m = sample();
  m = updateFolder(m, pathKey(p("/r/a")), (n) => ({
    ...n,
    listing: { state: "ready", entries: [link("/r/a", "up")] },
  }));
  m = setLink(m, pathKey(p("/r/a/up")), { kind: "loop" });
  const up = entries(flatten(m)).find((r) => r.entry.name === "up")!;
  expect(up).toMatchObject({ loop: true, folder: true, expanded: false });
});

test("a_link_that_cannot_be_judged_is_followed_by_the_reason", () => {
  let m = sample();
  m = updateFolder(m, pathKey(p("/r/a")), (n) => ({
    ...n,
    listing: { state: "ready", entries: [link("/r/a", "l")] },
  }));
  m = setLink(m, pathKey(p("/r/a/l")), { kind: "unknown", error: err("Io") });
  const rows = flatten(m);
  const i = rows.findIndex((r) => r.kind === "entry" && r.entry.name === "l");
  expect(rows[i + 1]).toMatchObject({ kind: "note", tone: "error", depth: 2 });
  expect((rows[i + 1] as { text: string }).text).toMatch(/could not tell whether this link/);
});

test("closing_a_folder_closes_the_folders_below_it_and_names_them", () => {
  const m = sample();
  const closed = closeFolder(m, pathKey(p("/r/a")));
  expect(closed.removed).toEqual([pathKey(p("/r/a"))]);
  expect(entries(flatten(closed.model)).map((r) => r.entry.name)).toEqual(["a", "z.txt"]);
  // The root never closes.
  expect(closeFolder(m, m.rootKey).removed).toEqual([]);
  // Opening c under a, then closing a, closes both.
  const deeper = openFolder(m, pathKey(p("/r/a/c")), {
    path: p("/r/a/c"),
    parent: pathKey(p("/r/a")),
    listing: { state: "ready", entries: [] },
    watchError: null,
  });
  expect(closeFolder(deeper, pathKey(p("/r/a"))).removed.sort()).toEqual(
    [pathKey(p("/r/a")), pathKey(p("/r/a/c"))].sort()
  );
});

test("inside_and_branch_follow_the_parents_of_the_open_folders", () => {
  const m = sample();
  expect(isInside(m, pathKey(p("/r/a")), pathKey(p("/r")))).toBe(true);
  expect(isInside(m, pathKey(p("/r")), pathKey(p("/r/a")))).toBe(false);
  expect(branchPaths(m, pathKey(p("/r/a")))).toEqual([p("/r"), p("/r/a")]);
});

test("a_name_that_is_not_utf8_keeps_its_own_key", () => {
  const bytes: WirePath = { k: "Bytes", v: btoa("/r/caf\xe9") };
  const e = entry("caf�", { path: bytes });
  const m = updateFolder(newModel(p("/r")), pathKey(p("/r")), (n) => ({
    ...n,
    listing: { state: "ready", entries: [e, entry("caf�", { path: p("/r/caf�") })] },
  }));
  const keys = entries(flatten(m)).map((r) => r.key);
  expect(new Set(keys).size).toBe(2);
});

// ---- the keys ----

function rowsOf(): Row[] {
  return flatten(sample());
}
const at = (rows: Row[], name: string) =>
  rows.findIndex((r) => r.kind === "entry" && r.entry.name === name);

test("arrows_move_between_visible_entries_and_stop_at_the_ends", () => {
  const rows = rowsOf();
  expect(treeKey(rows, at(rows, "a"), "ArrowDown")).toEqual({ move: at(rows, "c") });
  expect(treeKey(rows, at(rows, "b.txt"), "ArrowDown")).toEqual({ move: at(rows, "z.txt") });
  expect(treeKey(rows, at(rows, "z.txt"), "ArrowDown")).toEqual({ move: at(rows, "z.txt") });
  expect(treeKey(rows, at(rows, "c"), "ArrowUp")).toEqual({ move: at(rows, "a") });
  expect(treeKey(rows, at(rows, "a"), "ArrowUp")).toEqual({ move: at(rows, "a") });
  // With nothing current the first entry is where the keyboard starts.
  expect(treeKey(rows, -1, "ArrowDown")).toEqual({ move: 0 });
  expect(treeKey(rows, at(rows, "c"), "Home")).toEqual({ move: 0 });
  expect(treeKey(rows, 0, "End")).toEqual({ move: at(rows, "z.txt") });
});

test("notes_are_not_stops_for_the_keyboard", () => {
  const key = pathKey(p("/r"));
  let m = updateFolder(newModel(p("/r")), key, (n) => ({
    ...n,
    listing: { state: "ready", entries: [folder("/r", "a"), file("/r", "z")] },
  }));
  m = openFolder(m, pathKey(p("/r/a")), {
    path: p("/r/a"),
    parent: key,
    listing: { state: "error", error: err("Io") },
    watchError: null,
  });
  const rows = flatten(m);
  expect(rows.map((r) => r.kind)).toEqual(["entry", "note", "entry"]);
  expect(treeKey(rows, 0, "ArrowDown")).toEqual({ move: 2 });
  expect(treeKey(rows, 2, "ArrowUp")).toEqual({ move: 0 });
  // An open folder with no entry to go into: Right stays where it is.
  expect(treeKey(rows, 0, "ArrowRight")).toEqual({ move: 0 });
});

test("right_opens_a_closed_folder_then_enters_it_and_left_closes_then_goes_to_the_parent", () => {
  const rows = rowsOf();
  expect(treeKey(rows, at(rows, "a"), "ArrowRight")).toEqual({ move: at(rows, "c") });
  expect(treeKey(rows, at(rows, "c"), "ArrowRight")).toEqual({ expand: pathKey(p("/r/a/c")) });
  expect(treeKey(rows, at(rows, "b.txt"), "ArrowRight")).toBeNull();
  expect(treeKey(rows, at(rows, "a"), "ArrowLeft")).toEqual({ collapse: pathKey(p("/r/a")) });
  expect(treeKey(rows, at(rows, "b.txt"), "ArrowLeft")).toEqual({ move: at(rows, "a") });
  // A top-level file has no parent entry (the root is not a row).
  expect(treeKey(rows, at(rows, "z.txt"), "ArrowLeft")).toBeNull();
});

test("enter_and_space_activate_the_current_entry", () => {
  const rows = rowsOf();
  expect(treeKey(rows, at(rows, "b.txt"), "Enter")).toEqual({ activate: pathKey(p("/r/a/b.txt")) });
  expect(treeKey(rows, at(rows, "a"), " ")).toEqual({ activate: pathKey(p("/r/a")) });
  expect(treeKey(rows, -1, "Enter")).toBeNull();
});

test("typing_moves_to_the_next_entry_whose_name_starts_with_it", () => {
  const rows = rowsOf();
  expect(treeKey(rows, at(rows, "a"), "z", "z")).toEqual({ move: at(rows, "z.txt") });
  // The same letter again goes on to the next match, wrapping.
  expect(treeKey(rows, at(rows, "z.txt"), "z", "z")).toEqual({ move: at(rows, "z.txt") });
  expect(treeKey(rows, at(rows, "a"), "b", "b")).toEqual({ move: at(rows, "b.txt") });
  // Case does not matter, and a longer word narrows from the current entry.
  expect(treeKey(rows, at(rows, "a"), "B", "B")).toEqual({ move: at(rows, "b.txt") });
  expect(treeKey(rows, at(rows, "b.txt"), "b.", "b.")).toEqual({ move: at(rows, "b.txt") });
  expect(treeKey(rows, at(rows, "a"), "q", "q")).toBeNull();
  expect(treeKey(rows, 0, "Tab")).toBeNull();
});

test("indexByKey_names_entries_only", () => {
  const rows = rowsOf();
  expect(indexByKey(rows).size).toBe(4);
});
