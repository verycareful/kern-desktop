// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, it } from "vitest";
import {
  formatRanges,
  pagesOf,
  parseRanges,
  rangeFileKeys,
  refuseRepeatedPages,
  refuseRepeatedRanges,
} from "./page-range";

function ok(text: string, pages: number) {
  const r = parseRanges(text, pages);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("parseRanges", () => {
  it("accepts_a_single_page_a_range_and_a_list", () => {
    expect(ok("5", 9).spec).toBe("5");
    expect(ok("2-4", 9).spec).toBe("2-4");
    const list = ok("1-3, 5 ,7-9", 9);
    expect(list.spec).toBe("1-3,5,7-9");
    expect(list.ranges).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 5 },
      { start: 7, end: 9 },
    ]);
  });

  it("refuses_zero_reversed_and_past_the_end", () => {
    expect(parseRanges("0", 9)).toEqual({
      ok: false,
      error: "Page 0 does not exist. Pages run from 1 to 9.",
    });
    expect(parseRanges("3-1", 9)).toEqual({
      ok: false,
      error: "3-1 runs backwards. Write it as 1-3.",
    });
    expect(parseRanges("10", 9)).toEqual({
      ok: false,
      error: "Page 10 does not exist. Pages run from 1 to 9.",
    });
    expect(parseRanges("8-12", 9)).toEqual({
      ok: false,
      error: "Page 12 does not exist. Pages run from 1 to 9.",
    });
  });

  it("refuses_an_empty_string", () => {
    for (const text of ["", "   ", ",", " , ,"]) {
      expect(parseRanges(text, 9)).toEqual({
        ok: false,
        error: "Write the pages, for example 1-3,5.",
      });
    }
  });

  it("skips_empty_items_and_ignores_blanks_as_the_engine_does", () => {
    expect(ok("1,,3", 5).spec).toBe("1,3");
    expect(ok(" 2 - 4 ", 5).spec).toBe("2-4");
  });

  it("takes_ascii_digits_only", () => {
    for (const text of ["a", "1-b", "+3", "-3", "1.5", "٣", "1-2-3", "0x3"]) {
      const r = parseRanges(text, 9);
      expect(r.ok, text).toBe(false);
    }
    expect(parseRanges("a", 9)).toEqual({
      ok: false,
      error: "a is not a page or a range of pages.",
    });
  });

  it("refuses_every_page_of_a_document_with_none", () => {
    expect(parseRanges("1", 0)).toEqual({ ok: false, error: "This PDF has no pages." });
  });

  it("a_number_too_large_to_be_a_page_is_past_the_end", () => {
    expect(parseRanges("99999999999999999999", 9)).toEqual({
      ok: false,
      error: "99999999999999999999 is not a page or a range of pages.",
    });
  });
});

describe("pagesOf", () => {
  it("lists_the_pages_from_0_in_the_order_written", () => {
    expect(pagesOf(ok("5,1-3", 9).ranges)).toEqual([4, 0, 1, 2]);
  });
});

describe("repeats", () => {
  it("a_page_listed_twice_is_refused_for_extract", () => {
    expect(refuseRepeatedPages(ok("1-3,3", 9).ranges)).toBe("Page 3 is listed twice.");
    expect(refuseRepeatedPages(ok("1-3,2-4", 9).ranges)).toBe("Page 2 is listed twice.");
    expect(refuseRepeatedPages(ok("1-3,5", 9).ranges)).toBeNull();
  });

  it("two_ranges_that_name_the_same_file_are_refused_for_split", () => {
    expect(refuseRepeatedRanges(ok("5,5-5", 9).ranges)).toBe(
      "Page 5 is listed twice, so two files would have the same name."
    );
    expect(refuseRepeatedRanges(ok("1-3,1-3", 9).ranges)).toBe(
      "1-3 is listed twice, so two files would have the same name."
    );
    // Overlapping ranges make different files.
    expect(refuseRepeatedRanges(ok("1-3,2-4", 9).ranges)).toBeNull();
  });

  it("names_each_file_as_the_engine_does", () => {
    expect(rangeFileKeys(ok("5,1-3", 9).ranges)).toEqual(["5", "1-3"]);
  });
});

describe("formatRanges", () => {
  it("writes_runs_as_ranges_and_numbers_from_1", () => {
    expect(formatRanges([0, 1, 2, 4, 6, 7])).toBe("1-3,5,7-8");
    expect(formatRanges([3])).toBe("4");
    expect(formatRanges([])).toBe("");
  });

  it("sorts_and_joins_each_page_once", () => {
    expect(formatRanges([5, 3, 4, 3])).toBe("4-6");
  });

  it("what_it_writes_parses_back_to_the_same_pages", () => {
    const pages = [0, 2, 3, 4, 9];
    const r = parseRanges(formatRanges(pages), 10);
    expect(r.ok && pagesOf(r.ranges)).toEqual(pages);
  });
});
