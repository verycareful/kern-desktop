// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { parseHanded, type HandedDoc } from "./handed-doc";

const GOOD: HandedDoc = {
  text: "mine",
  saved: "hello",
  stamp: "s1:5:0:1:1:0",
  ending: "crlf",
  bom: true,
  read_only: { kind: "MixedLineEndings", detail: "lines 2 and 3" },
};

test("a_well_formed_state_is_taken_field_for_field", () => {
  // A JSON round trip is what the backend's pass-through amounts to.
  expect(parseHanded(JSON.parse(JSON.stringify(GOOD)))).toEqual(GOOD);
  expect(parseHanded({ ...GOOD, read_only: null })).toEqual({ ...GOOD, read_only: null });
  // Extra fields are not carried over.
  expect(parseHanded({ ...GOOD, extra: 1 })).toEqual(GOOD);
});

test("every_wrong_field_is_refused", () => {
  for (const bad of [
    null,
    "text",
    { ...GOOD, text: 5 },
    { ...GOOD, saved: undefined },
    { ...GOOD, stamp: null },
    { ...GOOD, ending: "cr" },
    { ...GOOD, bom: "yes" },
    { ...GOOD, read_only: { kind: "TooLarge" } },
    { ...GOOD, read_only: undefined },
  ]) {
    expect(parseHanded(bad)).toBeNull();
  }
});
