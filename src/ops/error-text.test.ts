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

test("a_mount_point_that_cannot_be_moved_says_to_copy_it_instead", () => {
  const text = errorText({ ...err("MountPoint"), path: { k: "Utf8", v: "/mnt/usb" } });
  expect(text).toBe("usb is a mount point and cannot be moved, copy it instead.");
  // Without a path the words still say it.
  expect(errorText(err("MountPoint"))).toMatch(/cannot be moved, copy it instead/);
});

test("a_mount_point_after_its_path_in_a_list_names_the_item_once", () => {
  const e: WireError = { ...err("MountPoint"), path: { k: "Utf8", v: "/mnt/usb" } };
  expect(errorText(e, true)).toBe("is a mount point and cannot be moved, copy it instead.");
  // Other errors read the same wherever they stand.
  expect(errorText(err("NotFound", "no such file: /a"), true)).toBe("NotFound: no such file: /a");
});

test("any_other_error_is_its_kind_and_the_backends_message", () => {
  expect(errorText(err("NotFound", "no such file: /a"))).toBe("NotFound: no such file: /a");
});
