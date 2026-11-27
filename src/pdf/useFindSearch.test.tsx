// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PdfSearchMatch } from "../ipc";

const ipc = vi.hoisted(() => ({ pdfSearch: vi.fn(), pdfCancelJob: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { registerPdf } from "./pdf-controller";
import { usePdfFind } from "./pdf-find";
import { usePdfSelection } from "./pdf-selection";
import { testController, testDoc } from "./test-doc";
import { useFindSearch } from "./useFindSearch";

const TAB = "tab-1";
const hit = (y: number): PdfSearchMatch => ({ rects: [[0.1, y, 0.2, y + 0.02]] });
const find = () => usePdfFind.getState();
const mine = () => usePdfFind.getState().byTab[TAB];

beforeEach(() => {
  vi.clearAllMocks();
  usePdfFind.setState({ byTab: {} });
  usePdfSelection.setState({ byTab: {}, searches: {} });
  ipc.pdfCancelJob.mockResolvedValue(undefined);
  ipc.pdfSearch.mockResolvedValue([]);
});
afterEach(cleanup);

test("nothing_is_searched_while_the_bar_is_closed_or_the_question_is_empty", async () => {
  renderHook(() => useFindSearch(TAB, testDoc({ pages: 2 })));
  act(() => find().setQuery(TAB, "word"));
  expect(ipc.pdfSearch).not.toHaveBeenCalled();
  act(() => find().open(TAB));
  await waitFor(() => expect(mine()?.searching).toBe(false));
  expect(ipc.pdfSearch).toHaveBeenCalledTimes(2);
});

test("a_new_query_cancels_the_old_job", async () => {
  const doc = testDoc({ pages: 3 });
  const releases: ((m: PdfSearchMatch[]) => void)[] = [];
  ipc.pdfSearch.mockImplementation(
    () => new Promise<PdfSearchMatch[]>((resolve) => releases.push(resolve))
  );
  renderHook(() => useFindSearch(TAB, doc));
  act(() => find().open(TAB, "old"));
  await waitFor(() => expect(releases).toHaveLength(1));
  const oldJob = ipc.pdfSearch.mock.calls[0]?.[5] as number;
  act(() => find().setQuery(TAB, "new"));
  await waitFor(() => expect(ipc.pdfCancelJob).toHaveBeenCalledWith(oldJob));
  await waitFor(() => expect(releases).toHaveLength(2));
  expect(ipc.pdfSearch.mock.calls[1]?.[5]).not.toBe(oldJob);
  // The page of the old question answers late: its matches are not shown.
  await act(async () => releases[0]?.([hit(0.3)]));
  expect(mine()?.hits).toEqual({});
});

test("an_empty_query_clears_the_hits", async () => {
  ipc.pdfSearch.mockResolvedValue([hit(0.3)]);
  renderHook(() => useFindSearch(TAB, testDoc({ pages: 2 })));
  act(() => find().open(TAB, "word"));
  await waitFor(() => expect(Object.keys(mine()?.hits ?? {})).toHaveLength(2));
  act(() => find().setQuery(TAB, ""));
  expect(mine()?.hits).toEqual({});
  expect(mine()?.current).toBeNull();
});

test("the_search_begins_at_the_page_in_view_and_the_first_match_is_the_current_one", async () => {
  const { usePdfView } = await import("./pdf-view");
  usePdfView.getState().patch(TAB, { page: 2 });
  ipc.pdfSearch.mockImplementation(async (_h, page: number) =>
    page === 1 || page === 2 ? [hit(0.4)] : []
  );
  renderHook(() => useFindSearch(TAB, testDoc({ pages: 3 })));
  act(() => find().open(TAB, "word"));
  await waitFor(() => expect(mine()?.searching).toBe(false));
  expect(ipc.pdfSearch.mock.calls.map((c) => c[1])).toEqual([2, 0, 1]);
  expect(mine()?.current).toEqual({ page: 2, index: 0 });
  usePdfView.getState().clear(TAB);
});

test("the_current_match_is_brought_into_view_and_stepping_moves_it", async () => {
  const goToPage = vi.fn();
  const off = registerPdf(TAB, testController({ goToPage }));
  ipc.pdfSearch.mockImplementation(async (_h, page: number) =>
    page === 0 ? [hit(0.1)] : page === 2 ? [hit(0.6)] : []
  );
  renderHook(() => useFindSearch(TAB, testDoc({ pages: 3 })));
  act(() => find().open(TAB, "word"));
  await waitFor(() => expect(mine()?.searching).toBe(false));
  expect(goToPage).toHaveBeenLastCalledWith(0, 0.1);
  act(() => find().step(TAB, 1));
  expect(goToPage).toHaveBeenLastCalledWith(2, 0.6);
  act(() => find().step(TAB, 1));
  expect(goToPage).toHaveBeenLastCalledWith(0, 0.1);
  off();
});

test("an_edit_searches_the_document_again", async () => {
  ipc.pdfSearch.mockResolvedValue([]);
  const { rerender } = renderHook(
    ({ revision }) => useFindSearch(TAB, testDoc({ pages: 1, revision })),
    {
      initialProps: { revision: 0 },
    }
  );
  act(() => find().open(TAB, "word"));
  await waitFor(() => expect(ipc.pdfSearch).toHaveBeenCalledTimes(1));
  rerender({ revision: 1 });
  await waitFor(() => expect(ipc.pdfSearch).toHaveBeenCalledTimes(2));
});

test("a_failed_search_says_why_and_keeps_what_it_found", async () => {
  ipc.pdfSearch.mockResolvedValueOnce([hit(0.2)]).mockRejectedValueOnce({
    kind: "Panic",
    message: "the engine stopped",
    path: null,
    details: null,
  });
  renderHook(() => useFindSearch(TAB, testDoc({ pages: 3 })));
  act(() => find().open(TAB, "word"));
  await waitFor(() => expect(mine()?.error).toContain("the engine stopped"));
  expect(mine()?.searching).toBe(false);
  expect(Object.keys(mine()?.hits ?? {})).toEqual(["0"]);
});

test("search_for_the_selected_text_opens_the_bar_with_it", async () => {
  renderHook(() => useFindSearch(TAB, testDoc({ pages: 1 })));
  act(() => usePdfSelection.getState().requestSearch(TAB, "two  lines\nof text"));
  await waitFor(() => expect(mine()?.open).toBe(true));
  expect(mine()?.query).toBe("two lines of text");
  // Asking again for the same text is another request.
  act(() => find().close(TAB));
  act(() => usePdfSelection.getState().requestSearch(TAB, "two  lines\nof text"));
  await waitFor(() => expect(mine()?.open).toBe(true));
});

test("closing_the_bar_forgets_the_matches_and_a_closed_tab_forgets_the_bar", async () => {
  ipc.pdfSearch.mockResolvedValue([hit(0.2)]);
  const { unmount } = renderHook(() => useFindSearch(TAB, testDoc({ pages: 1 })));
  act(() => find().open(TAB, "word"));
  await waitFor(() => expect(mine()?.current).not.toBeNull());
  act(() => find().close(TAB));
  expect(mine()).toMatchObject({ open: false, hits: {}, current: null, query: "word" });
  unmount();
  expect(mine()).toBeUndefined();
});
