// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { parseLocation } from "./path-input";

const home = { k: "Utf8", v: "/home/u" } as const;
const ok = (v: string) => ({ ok: true, path: { k: "Utf8", v } });

test("absolute_paths_are_normalised", () => {
  expect(parseLocation("/usr/share", home)).toEqual(ok("/usr/share"));
  expect(parseLocation("/usr//share/", home)).toEqual(ok("/usr/share"));
  expect(parseLocation("/", home)).toEqual(ok("/"));
  expect(parseLocation("/a/./b/../c", home)).toEqual(ok("/a/c"));
  expect(parseLocation("/..", home)).toEqual(ok("/"));
});

test("names_keep_their_leading_and_trailing_spaces", () => {
  expect(parseLocation("/a/ b /c ", home)).toEqual(ok("/a/ b /c "));
  // A space before the first slash makes the path relative: it is not trimmed away.
  expect(parseLocation(" /a", home)).toMatchObject({ ok: false });
});

test("tilde_expands_to_home", () => {
  expect(parseLocation("~", home)).toEqual(ok("/home/u"));
  expect(parseLocation("~/Documents", home)).toEqual(ok("/home/u/Documents"));
  expect(parseLocation("~/", home)).toEqual(ok("/home/u"));
});

test("errors_are_reported_not_guessed", () => {
  expect(parseLocation("", home)).toMatchObject({ ok: false });
  expect(parseLocation("   ", home)).toMatchObject({ ok: false });
  // Not valid UTF-8 as shown: U+FFFD stands for bytes that cannot be typed back.
  const bad = parseLocation("/home/\ufffdx", home);
  expect(bad).toMatchObject({ ok: false });
  expect(bad.ok === false && bad.message).toMatch(/not valid UTF-8/);
  const rel = parseLocation("docs/x", home);
  expect(rel).toMatchObject({ ok: false });
  expect(rel.ok === false && rel.message).toMatch(/absolute/);
  // ~user is not expanded: the user database is not read here.
  expect(parseLocation("~root/x", home)).toMatchObject({ ok: false });
  expect(parseLocation("/a\0b", home)).toMatchObject({ ok: false });
  expect(parseLocation("~/x", { k: "Bytes", v: "L2hvbWU=" })).toMatchObject({ ok: false });
  expect(parseLocation("~/x", null)).toMatchObject({ ok: false });
});
