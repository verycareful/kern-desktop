// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { repeatsAfter, useRaisedText } from "./raised-text";

test("the_same_words_set_again_count_and_anything_else_starts_over", () => {
  expect(repeatsAfter(null, 0, "no")).toBe(0);
  expect(repeatsAfter("no", 0, "no")).toBe(1);
  expect(repeatsAfter("no", 4, "no")).toBe(5);
  expect(repeatsAfter("no", 4, "other")).toBe(0);
});

test("a_message_raised_again_while_shown_is_counted_but_not_after_it_was_cleared", () => {
  const { result } = renderHook(() => useRaisedText());
  expect(result.current).toMatchObject({ text: null, repeats: 0 });
  act(() => result.current.raise("disk full"));
  expect(result.current).toMatchObject({ text: "disk full", repeats: 0 });
  act(() => result.current.raise("disk full"));
  expect(result.current).toMatchObject({ text: "disk full", repeats: 1 });
  act(() => result.current.raise("disk full"));
  expect(result.current.repeats).toBe(2);
  act(() => result.current.raise("read only"));
  expect(result.current).toMatchObject({ text: "read only", repeats: 0 });
  act(() => result.current.raise("read only"));
  act(() => result.current.clear());
  expect(result.current).toMatchObject({ text: null, repeats: 0 });
  act(() => result.current.raise("read only"));
  expect(result.current).toMatchObject({ text: "read only", repeats: 0 });
});
