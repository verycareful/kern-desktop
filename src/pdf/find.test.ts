// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { PdfSearchMatch } from "../ipc";

const ipc = vi.hoisted(() => ({ pdfSearch: vi.fn(), pdfCancelJob: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { cancelFind, countHits, findAll, positionOf, stepHit, type PageHits } from "./find";
import { testDoc } from "./test-doc";

const match = (n: number): PdfSearchMatch => ({ rects: [[0.1, 0.1 * n, 0.2, 0.1 * n + 0.02]] });

beforeEach(() => {
  vi.clearAllMocks();
  ipc.pdfCancelJob.mockResolvedValue(undefined);
});

test("reports_hits_page_by_page", async () => {
  ipc.pdfSearch.mockImplementation(async (_h, page: number) =>
    page === 1 ? [] : [match(page + 1)]
  );
  const seen: [number, number][] = [];
  await findAll(
    testDoc({ pages: 3 }),
    "word",
    { caseSensitive: true, wholeWord: false },
    (page, matches) => seen.push([page, matches.length]),
    7
  );
  expect(seen).toEqual([
    [0, 1],
    [1, 0],
    [2, 1],
  ]);
  expect(ipc.pdfSearch).toHaveBeenNthCalledWith(1, 3, 0, "word", true, false, 7);
  expect(ipc.pdfSearch).toHaveBeenCalledTimes(3);
});

test("the_search_begins_at_the_page_in_view_and_goes_round_to_the_pages_before_it", async () => {
  ipc.pdfSearch.mockResolvedValue([]);
  const pages: number[] = [];
  await findAll(
    testDoc({ pages: 4 }),
    "x",
    { caseSensitive: false, wholeWord: true, from: 2 },
    (page) => pages.push(page),
    1
  );
  expect(pages).toEqual([2, 3, 0, 1]);
});

test("an_empty_query_reads_nothing", async () => {
  const onPage = vi.fn();
  await findAll(testDoc({ pages: 3 }), "  ", { caseSensitive: false, wholeWord: false }, onPage, 1);
  expect(ipc.pdfSearch).not.toHaveBeenCalled();
  expect(onPage).not.toHaveBeenCalled();
});

test("a_cancelled_search_stops_before_its_next_page_and_resolves", async () => {
  let release: (m: PdfSearchMatch[]) => void = () => undefined;
  ipc.pdfSearch.mockImplementationOnce(() => new Promise((r) => (release = r)));
  const onPage = vi.fn();
  const done = findAll(
    testDoc({ pages: 5 }),
    "x",
    { caseSensitive: false, wholeWord: false },
    onPage,
    9
  );
  await vi.waitFor(() => expect(ipc.pdfSearch).toHaveBeenCalledTimes(1));
  await cancelFind(9);
  expect(ipc.pdfCancelJob).toHaveBeenCalledWith(9);
  // The page in flight answers after the cancel; it is not reported and no page follows.
  release([match(1)]);
  await done;
  expect(onPage).not.toHaveBeenCalled();
  expect(ipc.pdfSearch).toHaveBeenCalledTimes(1);
});

test("an_answer_of_cancelled_ends_the_search_and_any_other_error_is_raised", async () => {
  ipc.pdfSearch.mockRejectedValueOnce({ kind: "Cancelled", message: "cancelled" });
  await expect(
    findAll(testDoc({ pages: 2 }), "x", { caseSensitive: false, wholeWord: false }, vi.fn(), 2)
  ).resolves.toBeUndefined();
  ipc.pdfSearch.mockRejectedValueOnce({ kind: "Panic", message: "stopped" });
  await expect(
    findAll(testDoc({ pages: 2 }), "x", { caseSensitive: false, wholeWord: false }, vi.fn(), 3)
  ).rejects.toMatchObject({ kind: "Panic" });
});

test("cancelling_a_search_that_is_over_asks_the_engine_for_nothing", async () => {
  await cancelFind(404);
  expect(ipc.pdfCancelJob).not.toHaveBeenCalled();
});

test("a_document_that_is_not_open_cannot_be_searched", async () => {
  await expect(
    findAll(
      testDoc({ handle: undefined }),
      "x",
      { caseSensitive: false, wholeWord: false },
      vi.fn(),
      1
    )
  ).rejects.toThrow("not open");
});

const hits: PageHits = { 1: [match(1), match(2)], 4: [match(3)] };

test("next_and_previous_wrap_around_the_document", () => {
  expect(stepHit(hits, null, 1)).toEqual({ page: 1, index: 0 });
  expect(stepHit(hits, null, -1)).toEqual({ page: 4, index: 0 });
  expect(stepHit(hits, { page: 1, index: 0 }, 1)).toEqual({ page: 1, index: 1 });
  expect(stepHit(hits, { page: 1, index: 1 }, 1)).toEqual({ page: 4, index: 0 });
  expect(stepHit(hits, { page: 4, index: 0 }, 1)).toEqual({ page: 1, index: 0 });
  expect(stepHit(hits, { page: 1, index: 0 }, -1)).toEqual({ page: 4, index: 0 });
  expect(stepHit(hits, { page: 4, index: 0 }, -1)).toEqual({ page: 1, index: 1 });
  expect(stepHit({}, null, 1)).toBeNull();
});

test("the_matches_are_counted_and_the_current_one_has_a_position_from_one", () => {
  expect(countHits(hits)).toBe(3);
  expect(positionOf(hits, { page: 4, index: 0 })).toBe(3);
  expect(positionOf(hits, null)).toBe(0);
  expect(positionOf(hits, { page: 9, index: 0 })).toBe(0);
});
