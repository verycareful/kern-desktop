// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, expect, test } from "vitest";
import { columnOf, encodingText, endingText, useDocStatus } from "./doc-status";

beforeEach(() => useDocStatus.setState({ byTab: {} }));

test("columns_count_characters_from_one", () => {
  expect(columnOf("hello", 10, 10)).toBe(1);
  expect(columnOf("hello", 13, 10)).toBe(4);
  // "a😀b": the emoji is two UTF-16 units and one character.
  expect(columnOf("a\u{1F600}b", 3, 0)).toBe(3);
  expect(columnOf("a\u{1F600}b", 4, 0)).toBe(4);
  expect(columnOf("\u{1F600}\u{1F600}", 4, 0)).toBe(3);
  // A lone low surrogate is one unit, not half of a pair.
  expect(columnOf("\udc00x", 1, 0)).toBe(2);
});

test("encoding_and_ending_words", () => {
  expect(encodingText(false)).toBe("UTF-8");
  expect(encodingText(true)).toBe("UTF-8 with BOM");
  expect(endingText("lf")).toBe("LF");
  expect(endingText("crlf")).toBe("CRLF");
});

test("patch_merges_and_an_unchanged_patch_keeps_the_state_object", () => {
  useDocStatus.getState().patch("t", { bom: true });
  expect(useDocStatus.getState().byTab.t).toEqual({
    line: 1,
    col: 1,
    bom: true,
    ending: "lf",
    busy: false,
  });
  useDocStatus.getState().patch("t", { line: 4, col: 2 });
  const before = useDocStatus.getState();
  useDocStatus.getState().patch("t", { line: 4, col: 2 });
  expect(useDocStatus.getState()).toBe(before);
  // Busy is part of the state: changing it is a change, repeating it is not.
  useDocStatus.getState().patch("t", { busy: true });
  expect(useDocStatus.getState()).not.toBe(before);
  const busy = useDocStatus.getState();
  useDocStatus.getState().patch("t", { busy: true });
  expect(useDocStatus.getState()).toBe(busy);
  useDocStatus.getState().clear("t");
  expect(useDocStatus.getState().byTab.t).toBeUndefined();
  const empty = useDocStatus.getState();
  useDocStatus.getState().clear("t");
  expect(useDocStatus.getState()).toBe(empty);
});
