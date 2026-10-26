// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireEntry } from "../ipc";
import { fileType, isFolder } from "./file-type";

export type SortBy = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

// Natural, locale-aware order: "file2" before "file10", "e" and its accented form together.
const collator = new Intl.Collator(undefined, { numeric: true });

function collatorOrder(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

// ---- The fast path for plain names ----
//
// Intl.Collator is exact but slow: about 1.7 million comparisons for 100 000
// names, at a few hundred nanoseconds each. A name made only of ASCII letters,
// digits and . - _ space can instead be turned once into two strings whose
// plain code-unit order is the collator's order (UCA / CLDR root, numeric):
//   primary:   the name in lower case, with "_" moved so that the order is
//              space < _ < - < . < digits < letters, and each run of digits as
//              one unit (a marker, the run's length, its digits), so 9 < 10;
//   tertiary:  lower case before upper case at the first letter that differs,
//              looked at only when the primary strings are equal.
// A name with anything else, or a digit run with a leading zero (which the
// collator treats as equal to the run without it), has no key and is compared
// by the collator. The path is switched on only if it agrees with the
// collator on a probe set at start-up, so a locale that tailors these letters
// (Czech "ch", Danish "aa") quietly falls back to the exact way.

// Code-unit order already puts space (0x20), "-" (0x2D) and "." (0x2E) before
// the digits (0x30) and the digits before the lower-case letters (0x61), as
// the collator does; only "_", which the collator puts right after space,
// needs moving, to "!" (0x21).
const PLAIN_NAME = /^[A-Za-z0-9._ -]+$/;
// A zero followed by a digit starts a run with a leading zero.
const LEADING_ZERO = /(?:^|\D)0\d/;
const LONG_RUN = /\d{101}/;
const DIGIT_RUN = /\d+/g;
const MARK = "0";

/** The primary key of a plain name, or null when the name is not plain. */
function primaryKey(name: string): string | null {
  if (
    !PLAIN_NAME.test(name) ||
    LEADING_ZERO.test(name) ||
    (name.length > 100 && LONG_RUN.test(name))
  )
    return null;
  let primary = name.toLowerCase();
  if (primary.includes("_")) primary = primary.replace(/_/g, "!");
  // A digit run is one unit: marker, length, digits, so that 9 < 10.
  return primary.replace(DIGIT_RUN, (run) => MARK + String.fromCharCode(0x100 + run.length) + run);
}

/**
 * Order of two plain names with equal primary keys: equal keys mean the same
 * units in the same places, so the names are as long as each other, and the
 * first letter whose case differs decides (lower case first).
 */
function caseOrder(x: string, y: string): number {
  for (let i = 0; i < x.length; i++) {
    const ux = x.charCodeAt(i) >= 0x41 && x.charCodeAt(i) <= 0x5a;
    const uy = y.charCodeAt(i) >= 0x41 && y.charCodeAt(i) <= 0x5a;
    if (ux !== uy) return ux ? 1 : -1;
  }
  return 0;
}

function plainOrder(pa: string, na: string, pb: string, nb: string): number {
  return pa !== pb ? (pa < pb ? -1 : 1) : caseOrder(na, nb);
}

function fastPathAgrees(): boolean {
  const alphabet = "abcABC019.-_ hlcHL";
  let seed = 99;
  const rnd = (n: number) => (seed = (seed * 1664525 + 1013904223) % 4294967296) % n;
  const word = () =>
    Array.from({ length: 1 + rnd(6) }, () => alphabet[rnd(alphabet.length)]).join("");
  for (let i = 0; i < 4000; i++) {
    const a = word();
    const b = word();
    const ka = primaryKey(a);
    const kb = primaryKey(b);
    if (ka === null || kb === null) continue;
    if (Math.sign(plainOrder(ka, a, kb, b)) !== Math.sign(collatorOrder(a, b))) return false;
  }
  return true;
}

const FAST = fastPathAgrees();

interface Row {
  e: WireEntry;
  /** The primary key of a plain name; null when the collator must compare it. */
  p: string | null;
  /** Type-column key, computed once per entry rather than once per comparison. */
  type: string;
}

const nameOrder = (a: Row, b: Row): number =>
  a.p !== null && b.p !== null
    ? plainOrder(a.p, a.e.name, b.p, b.e.name)
    : collatorOrder(a.e.name, b.e.name);

/**
 * The entries in display order: folders first, then the rest, each group
 * ordered by `by` (`dir` flips that order, not the folders-first rule). Ties
 * fall back to the natural name order, ascending. Folders have no size of
 * their own, so by size they stay in name order. An unknown modification
 * time counts as the oldest. Does not change `entries`.
 */
export function sortEntries(entries: readonly WireEntry[], by: SortBy, dir: SortDir): WireEntry[] {
  const sign = dir === "asc" ? 1 : -1;
  const folders: Row[] = [];
  const files: Row[] = [];
  for (const e of entries) {
    const row: Row = {
      e,
      p: FAST ? primaryKey(e.name) : null,
      type: by === "type" ? fileType(e).mono.toLowerCase() : "",
    };
    (isFolder(e) ? folders : files).push(row);
  }
  const compare = (group: "folders" | "files"): ((a: Row, b: Row) => number) => {
    switch (by) {
      case "name":
        return (a, b) => sign * nameOrder(a, b);
      case "size":
        return group === "folders"
          ? nameOrder
          : (a, b) => sign * (a.e.len - b.e.len) || nameOrder(a, b);
      case "modified":
        return (a, b) =>
          sign * ((a.e.modified_ms ?? -Infinity) - (b.e.modified_ms ?? -Infinity) || 0) ||
          nameOrder(a, b);
      case "type":
        return (a, b) => (a.type < b.type ? -sign : a.type > b.type ? sign : 0) || nameOrder(a, b);
    }
  };
  folders.sort(compare("folders"));
  files.sort(compare("files"));
  return [...folders, ...files].map((r) => r.e);
}
