// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { homeRelative } from "./home-relative";

const p = (v: string) => ({ k: "Utf8" as const, v });

test("the_home_folder_is_shown_as_a_tilde", () => {
  expect(homeRelative(p("/home/t"), p("/home/t"))).toBe("~");
  expect(homeRelative(p("/home/t/Uni"), p("/home/t/"))).toBe("~/Uni");
  // A sibling whose name starts with the home folder's is not inside it.
  expect(homeRelative(p("/home/tom/Uni"), p("/home/t"))).toBe("/home/tom/Uni");
  expect(homeRelative(p("/srv"), null)).toBe("/srv");
});
