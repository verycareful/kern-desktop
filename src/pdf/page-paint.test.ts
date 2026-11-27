// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test, vi } from "vitest";
import { forgetPaint, markPainted, whenPainted } from "./page-paint";

const settled = async (promise: Promise<void>): Promise<boolean> => {
  const flag = vi.fn();
  void promise.then(flag);
  await Promise.resolve();
  await Promise.resolve();
  return flag.mock.calls.length > 0;
};

test("a_page_painted_at_the_revision_asked_for_is_there_at_once", async () => {
  markPainted(11, 0, 4);
  expect(await settled(whenPainted(11, 0, 4))).toBe(true);
  expect(await settled(whenPainted(11, 0, 3))).toBe(true);
});

test("a_wait_is_over_when_the_page_is_painted_at_that_revision_or_a_later_one_and_not_before", async () => {
  markPainted(12, 2, 1);
  const wait = whenPainted(12, 2, 5);
  expect(await settled(wait)).toBe(false);
  markPainted(12, 2, 4);
  expect(await settled(wait)).toBe(false);
  markPainted(12, 2, 6);
  expect(await settled(wait)).toBe(true);
});

test("an_older_paint_never_lowers_what_is_known", async () => {
  markPainted(13, 0, 8);
  markPainted(13, 0, 2);
  expect(await settled(whenPainted(13, 0, 8))).toBe(true);
});

test("waits_on_other_pages_and_documents_are_not_ended_by_a_paint", async () => {
  const wait = whenPainted(14, 1, 2);
  markPainted(14, 0, 9);
  markPainted(15, 1, 9);
  expect(await settled(wait)).toBe(false);
});

test("closing_the_document_ends_its_waits_and_forgets_its_pages", async () => {
  const wait = whenPainted(16, 0, 3);
  markPainted(16, 1, 2);
  forgetPaint(16);
  expect(await settled(wait)).toBe(true);
  expect(await settled(whenPainted(16, 1, 2))).toBe(false);
});
