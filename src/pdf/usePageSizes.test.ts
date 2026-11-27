// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const ipc = vi.hoisted(() => ({ pdfPageInfo: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { pagesChangedSince, usePageSizes } from "./usePageSizes";

/** Page n is `100 + 10 n` points wide, so a size says which page it is of. */
const info = (width: number) => ({ width_pt: width, height_pt: 200, rotate: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  ipc.pdfPageInfo.mockImplementation(async (_h: number, page: number) => info(100 + 10 * page));
});

const widths = (sizes: { widthPt: number }[] | null) => sizes?.map((s) => s.widthPt);

test("every_page_is_read_the_first_time", async () => {
  const { result } = renderHook(() => usePageSizes(1, 4, 1, [1, 1, 1, 1]));
  await waitFor(() => expect(result.current.readAt).toBe(1));
  expect(ipc.pdfPageInfo).toHaveBeenCalledTimes(4);
  expect(widths(result.current.sizes)).toEqual([100, 110, 120, 130]);
});

test("an_edit_reads_only_the_pages_it_changed_and_keeps_the_rest", async () => {
  const { result, rerender } = renderHook(
    (p: { revision: number; revisions: number[] }) => usePageSizes(1, 4, p.revision, p.revisions),
    { initialProps: { revision: 1, revisions: [1, 1, 1, 1] } }
  );
  await waitFor(() => expect(result.current.readAt).toBe(1));
  ipc.pdfPageInfo.mockClear();
  // Page 2 was turned: it is now 200 wide in the engine's answer.
  ipc.pdfPageInfo.mockImplementation(async () => info(200));
  rerender({ revision: 2, revisions: [1, 1, 2, 1] });
  await waitFor(() => expect(result.current.readAt).toBe(2));
  expect(ipc.pdfPageInfo).toHaveBeenCalledTimes(1);
  expect(ipc.pdfPageInfo).toHaveBeenCalledWith(1, 2);
  expect(widths(result.current.sizes)).toEqual([100, 110, 200, 130]);
});

test("an_edit_that_changes_no_size_asks_the_engine_for_nothing_and_the_sizes_are_current_at_once", async () => {
  const { result, rerender } = renderHook(
    (p: { revision: number; revisions: number[] }) => usePageSizes(1, 3, p.revision, p.revisions),
    { initialProps: { revision: 1, revisions: [1, 1, 1] } }
  );
  await waitFor(() => expect(result.current.readAt).toBe(1));
  const before = result.current.sizes;
  ipc.pdfPageInfo.mockClear();
  // An undo that goes back to a revision no page has changed since.
  rerender({ revision: 2, revisions: [1, 1, 1] });
  await waitFor(() => expect(result.current.readAt).toBe(2));
  expect(ipc.pdfPageInfo).not.toHaveBeenCalled();
  expect(result.current.sizes).toEqual(before);
});

test("a_different_number_of_pages_is_read_whole_since_every_page_may_have_moved", async () => {
  const { result, rerender } = renderHook(
    (p: { pages: number; revision: number; revisions: number[] }) =>
      usePageSizes(1, p.pages, p.revision, p.revisions),
    { initialProps: { pages: 4, revision: 1, revisions: [1, 1, 1, 1] } }
  );
  await waitFor(() => expect(result.current.readAt).toBe(1));
  ipc.pdfPageInfo.mockClear();
  rerender({ pages: 3, revision: 2, revisions: [1, 1, 1] });
  await waitFor(() => expect(result.current.readAt).toBe(2));
  expect(ipc.pdfPageInfo).toHaveBeenCalledTimes(3);
  expect(result.current.sizes).toHaveLength(3);
});

test("a_document_is_never_built_on_the_sizes_of_another", async () => {
  const { result, rerender } = renderHook(
    (p: { handle: number; revision: number }) => usePageSizes(p.handle, 3, p.revision, [1, 1, 1]),
    { initialProps: { handle: 1, revision: 1 } }
  );
  await waitFor(() => expect(result.current.readAt).toBe(1));
  ipc.pdfPageInfo.mockClear();
  rerender({ handle: 2, revision: 1 });
  expect(result.current.sizes).toBeNull();
  await waitFor(() => expect(result.current.sizes).not.toBeNull());
  expect(ipc.pdfPageInfo).toHaveBeenCalledTimes(3);
});

test("pages_changed_since_a_read_are_those_whose_revision_is_later_than_it", () => {
  const read = {
    handle: 5,
    sizes: [1, 2, 3].map(() => ({ widthPt: 1, heightPt: 1, rotate: 0 as const })),
    at: 4,
  };
  expect(pagesChangedSince(read, 5, 3, [4, 6, 5])).toEqual([1, 2]);
  expect(pagesChangedSince(read, 5, 3, [1, 4, 4])).toEqual([]);
  expect(pagesChangedSince(read, 6, 3, [9, 9, 9])).toBeNull();
  expect(pagesChangedSince(read, 5, 2, [9, 9])).toBeNull();
  expect(pagesChangedSince(null, 5, 3, [9, 9, 9])).toBeNull();
});
