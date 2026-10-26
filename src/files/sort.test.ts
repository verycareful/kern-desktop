// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { dir, entry } from "./test-entries";
import { sortEntries } from "./sort";

const names = (l: { name: string }[]) => l.map((e) => e.name);

test("folders_first_natural_order", () => {
  const list = [
    entry("file10.txt"),
    dir("zeta"),
    entry("file2.txt"),
    dir("Alpha"),
    entry("file1.txt"),
  ];
  expect(names(sortEntries(list, "name", "asc"))).toEqual([
    "Alpha",
    "zeta",
    "file1.txt",
    "file2.txt",
    "file10.txt",
  ]);
  // Descending flips the order inside each group; folders stay first.
  expect(names(sortEntries(list, "name", "desc"))).toEqual([
    "zeta",
    "Alpha",
    "file10.txt",
    "file2.txt",
    "file1.txt",
  ]);
});

test("a_symlink_to_a_folder_sorts_with_the_folders", () => {
  const link = entry("link", { kind: "symlink", target_is_dir: true });
  expect(names(sortEntries([entry("a.txt"), link], "name", "asc"))).toEqual(["link", "a.txt"]);
});

test("locale_aware_name_order", () => {
  // A collator puts "é" with "e", where a code-unit comparison puts it after "z".
  const list = [entry("zebra"), entry("éclair"), entry("eagle")];
  expect(names(sortEntries(list, "name", "asc"))).toEqual(["eagle", "éclair", "zebra"]);
});

test("size_and_modified_break_ties_by_name", () => {
  const list = [
    entry("b", { len: 5, modified_ms: 10 }),
    entry("a", { len: 5, modified_ms: 10 }),
    entry("c", { len: 1, modified_ms: 30 }),
    entry("d", { len: 9, modified_ms: null }),
  ];
  expect(names(sortEntries(list, "size", "asc"))).toEqual(["c", "a", "b", "d"]);
  expect(names(sortEntries(list, "size", "desc"))).toEqual(["d", "a", "b", "c"]);
  // An unknown modification time sorts as the oldest.
  expect(names(sortEntries(list, "modified", "asc"))).toEqual(["d", "a", "b", "c"]);
  expect(names(sortEntries(list, "modified", "desc"))).toEqual(["c", "a", "b", "d"]);
});

test("type_groups_by_type_then_name", () => {
  const list = [entry("b.txt"), entry("a.pdf"), entry("a.txt"), entry("z.csv")];
  expect(names(sortEntries(list, "type", "asc"))).toEqual(["z.csv", "a.pdf", "a.txt", "b.txt"]);
});

test("input_is_not_mutated", () => {
  const list = [entry("b"), entry("a")];
  sortEntries(list, "name", "asc");
  expect(names(list)).toEqual(["b", "a"]);
});

test("sort_100k_under_budget", () => {
  // Budget 1000 ms. A 100 000-entry folder is re-sorted on every refresh the
  // watcher triggers (one per burst of changes) and on each sort change; one
  // second is the limit Nielsen gives for a delay the user notices without
  // losing their flow (Usability Engineering, 1993, ch. 5), so a sort that
  // fits is never experienced as the app stalling. The input is shuffled
  // names with digits, the collator's slowest realistic case (numeric).
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const list = Array.from({ length: 100_000 }, (_, i) =>
    next() % 11 === 0 ? dir(`dir${next() % 5000}`) : entry(`file${next() % 100000}-${i}.txt`)
  );
  const start = performance.now();
  const sorted = sortEntries(list, "name", "asc");
  const elapsed = performance.now() - start;
  expect(sorted).toHaveLength(100_000);
  expect(elapsed).toBeLessThan(1000);
});
