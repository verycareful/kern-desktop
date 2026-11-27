// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { homeRelative, rootRelative } from "./home-relative";

const p = (v: string) => ({ k: "Utf8" as const, v });

test("the_home_folder_is_shown_as_a_tilde", () => {
  expect(homeRelative(p("/home/t"), p("/home/t"))).toBe("~");
  expect(homeRelative(p("/home/t/Uni"), p("/home/t/"))).toBe("~/Uni");
  // A sibling whose name starts with the home folder's is not inside it.
  expect(homeRelative(p("/home/tom/Uni"), p("/home/t"))).toBe("/home/tom/Uni");
  expect(homeRelative(p("/srv"), null)).toBe("/srv");
});

test("a_folder_is_shown_as_it_lies_below_the_folder_that_was_searched", () => {
  expect(rootRelative(p("/work/kern/src/pdf"), p("/work/kern"))).toBe("src/pdf");
  expect(rootRelative(p("/work/kern/src"), p("/work/kern/"))).toBe("src");
  // The root itself is shown by its own name.
  expect(rootRelative(p("/work/kern"), p("/work/kern"))).toBe("kern");
  expect(rootRelative(p("/work/kern/"), p("/work/kern"))).toBe("kern");
  // A sibling whose name starts with the root's is not inside it, and neither is anything else.
  expect(rootRelative(p("/work/kernel/src"), p("/work/kern"))).toBeNull();
  expect(rootRelative(p("/srv"), p("/work/kern"))).toBeNull();
  // The whole file system as the root.
  expect(rootRelative(p("/etc/ssh"), p("/"))).toBe("etc/ssh");
  expect(rootRelative(p("/"), p("/"))).toBe("/");
});
