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
  // Budget 200 ms (the plan's Review Focus 2). A 100 000-entry folder is
  // re-sorted on every refresh the watcher triggers (one per burst of changes)
  // and on each sort change; 0.1 s is the limit for a response to feel
  // instantaneous and 1 s the limit for keeping the user's flow (Nielsen,
  // Usability Engineering, 1993, ch. 5), so 200 ms keeps a refresh inside
  // "no noticeable pause" with the rest of the frame's work around it. The
  // input is shuffled names with digits, the collator's slowest realistic case.
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const list = Array.from({ length: 100_000 }, (_, i) =>
    next() % 11 === 0 ? dir(`dir${next() % 5000}`) : entry(`file${next() % 100000}-${i}.txt`)
  );
  sortEntries(list.slice(0, 2000), "name", "asc"); // warm-up: JIT and collator set-up
  // The best of three runs: the budget is about what the sort costs, not about
  // a test runner that has other files running beside it.
  let best = Infinity;
  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const sorted = sortEntries(list, "name", "asc");
    best = Math.min(best, performance.now() - start);
    expect(sorted).toHaveLength(100_000);
  }
  expect(best).toBeLessThan(200);
});

// The reference: what the sort must equal, written as plainly as possible.
const collator = new Intl.Collator(undefined, { numeric: true });
const reference = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

test("name_order_equals_the_collator_on_mixed_input", () => {
  // Names from an alphabet that mixes what the fast path handles (ASCII
  // letters of both cases, digits, . - _ and space), leading zeros, and what
  // it must leave to the collator (accents, ligatures, CJK, emoji, other punctuation).
  const alphabet = [
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789....--__  ",
    ..."0001",
    ..."\u00e9\u00c9\u00fc\u00df\u00e5\u0131\u65e5\u672c\ud83d\ude00(),;!#@~+",
  ];
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1664525 + 1013904223) % 4294967296) % n;
  const names = Array.from({ length: 4000 }, () =>
    Array.from({ length: 1 + rnd(8) }, () => alphabet[rnd(alphabet.length)]).join("")
  );
  const unique = [...new Set(names)];
  const got = sortEntries(
    unique.map((n) => entry(n)),
    "name",
    "asc"
  ).map((e) => e.name);
  const want = [...unique].sort(reference);
  expect(got).toEqual(want);
  const desc = sortEntries(
    unique.map((n) => entry(n)),
    "name",
    "desc"
  ).map((e) => e.name);
  expect(desc).toEqual([...want].reverse());
});

test("ascii_names_that_differ_only_by_case_or_digits_follow_the_collator", () => {
  const names = [
    "a",
    "A",
    "b",
    "B",
    "a1",
    "a01",
    "a2",
    "a10",
    "A1",
    "ab",
    "aB",
    "a-b",
    "a_b",
    "a b",
    "a.b",
    "1",
    "01",
    "10",
    "9",
    "file",
    "File",
    "FILE",
  ];
  const got = sortEntries(
    names.map((n) => entry(n)),
    "name",
    "asc"
  ).map((e) => e.name);
  expect(got).toEqual([...names].sort(reference));
});
