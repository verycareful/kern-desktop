// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WireError } from "../ipc";
import { errorText } from "./error-text";

const err = (kind: string, message = "the backend's own words"): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

test("a_kernel_without_mount_ids_is_explained_in_plain_words", () => {
  const text = errorText(err("MountIdUnavailable"));
  expect(text).toMatch(/Linux 5\.8/);
  expect(text).toMatch(/move or a copy/);
  expect(text).not.toContain("MountIdUnavailable");
});

test("a_path_without_a_name_is_explained_in_plain_words", () => {
  const text = errorText(err("InvalidName"));
  expect(text).toMatch(/no name/);
  expect(text).not.toContain("InvalidName");
});

test("any_other_error_is_its_kind_and_the_backends_message", () => {
  expect(errorText(err("NotFound", "no such file: /a"))).toBe("NotFound: no such file: /a");
});
