// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WireError } from "../ipc";
import { volumeErrorText } from "./volume-text";

const err = (kind: string, message: string): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

test("problems_beyond_the_ones_kept_are_explained_in_plain_words", () => {
  const text = volumeErrorText(
    err(
      "ProblemsNotShown",
      "3 more not shown: only the first 64 volume problems are kept until taken"
    )
  );
  expect(text).toMatch(/not shown/i);
  expect(text).toContain("3 more not shown");
  expect(text).not.toMatch(/^ProblemsNotShown/);
});
