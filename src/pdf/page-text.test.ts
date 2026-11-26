// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test, vi } from "vitest";
import type { PdfPageText } from "../ipc/pdf";

const ipc = vi.hoisted(() => ({ pdfText: vi.fn() }));
vi.mock("../ipc", async (orig) => ({ ...(await orig<typeof import("../ipc")>()), ...ipc }));

import { dropPageText, loadPageText, PAGE_TEXT_CAP } from "./page-text";
import { testDoc } from "./test-doc";

const wire = (revision = 1): PdfPageText => ({
  revision,
  lines: [
    { block: 0, text: "a", wrapped: false, rect: [0, 0, 0.1, 0.1], glyphs: [[0, 0, 0.1, 0.1]] },
  ],
  blocks: [],
  tagged: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  dropPageText(7);
  ipc.pdfText.mockResolvedValue(wire());
});

test("a_page_is_read_once_and_the_asks_share_the_answer", async () => {
  const doc = testDoc({ handle: 7, pages: 3 });
  const [a, b] = await Promise.all([loadPageText(doc, 1), loadPageText(doc, 1)]);
  expect(a).toBe(b);
  await loadPageText(doc, 1);
  expect(ipc.pdfText).toHaveBeenCalledTimes(1);
});

test("an_edit_to_the_page_reads_it_again_and_an_edit_elsewhere_does_not", async () => {
  await loadPageText(testDoc({ handle: 7, pages: 3, pageRevisions: [0, 0, 0] }), 1);
  await loadPageText(testDoc({ handle: 7, pages: 3, pageRevisions: [4, 0, 0] }), 1);
  expect(ipc.pdfText).toHaveBeenCalledTimes(1);
  await loadPageText(testDoc({ handle: 7, pages: 3, pageRevisions: [0, 5, 0] }), 1);
  expect(ipc.pdfText).toHaveBeenCalledTimes(2);
});

test("a_failed_read_is_asked_again_next_time", async () => {
  const doc = testDoc({ handle: 7, pages: 3 });
  ipc.pdfText.mockRejectedValueOnce({ kind: "Panic", message: "stopped" });
  await expect(loadPageText(doc, 0)).rejects.toBeDefined();
  await expect(loadPageText(doc, 0)).resolves.toBeDefined();
  expect(ipc.pdfText).toHaveBeenCalledTimes(2);
});

test("a_document_that_is_not_open_has_no_text", async () => {
  await expect(loadPageText(testDoc({ handle: undefined }), 0)).rejects.toThrow("not open");
});

test("the_least_recently_used_page_leaves_when_the_cache_is_full", async () => {
  const doc = testDoc({ handle: 7, pages: PAGE_TEXT_CAP + 2 });
  for (let page = 0; page < PAGE_TEXT_CAP; page++) await loadPageText(doc, page);
  await loadPageText(doc, 0);
  await loadPageText(doc, PAGE_TEXT_CAP);
  expect(ipc.pdfText).toHaveBeenCalledTimes(PAGE_TEXT_CAP + 1);
  await loadPageText(doc, 0);
  expect(ipc.pdfText).toHaveBeenCalledTimes(PAGE_TEXT_CAP + 1);
  await loadPageText(doc, 1);
  expect(ipc.pdfText).toHaveBeenCalledTimes(PAGE_TEXT_CAP + 2);
  dropPageText(7);
});
