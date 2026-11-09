// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { NO_NOTES, raiseNote } from "./note-list";

test("a_note_is_listed_once_and_the_same_words_again_are_counted", () => {
  const one = raiseNote(NO_NOTES, "a");
  expect(one).toEqual({ texts: ["a"], repeats: 0 });
  const two = raiseNote(one, "b");
  expect(two).toEqual({ texts: ["a", "b"], repeats: 0 });
  const again = raiseNote(two, "a");
  expect(again).toEqual({ texts: ["a", "b"], repeats: 1 });
  expect(raiseNote(again, "b").repeats).toBe(2);
  // The list the notes were raised on is not changed.
  expect(two.repeats).toBe(0);
});
