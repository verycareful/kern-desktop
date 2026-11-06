// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { modeOctal, modeText } from "./permissions";

test("properties_shows_octal", () => {
  expect(modeOctal(0o750)).toBe("0750");
  expect(modeOctal(0o644)).toBe("0644");
  expect(modeOctal(0o1777)).toBe("1777");
  expect(modeOctal(0)).toBe("0000");
});

test("the_letters_follow_ls", () => {
  expect(modeText(0o750)).toBe("rwxr-x---");
  expect(modeText(0o644)).toBe("rw-r--r--");
  expect(modeText(0o777)).toBe("rwxrwxrwx");
  expect(modeText(0)).toBe("---------");
  // setuid, setgid and sticky, with and without the execute bit under them.
  expect(modeText(0o4755)).toBe("rwsr-xr-x");
  expect(modeText(0o4644)).toBe("rwSr--r--");
  expect(modeText(0o2755)).toBe("rwxr-sr-x");
  expect(modeText(0o2745)).toBe("rwxr-Sr-x");
  expect(modeText(0o1777)).toBe("rwxrwxrwt");
  expect(modeText(0o1776)).toBe("rwxrwxrwT");
});
