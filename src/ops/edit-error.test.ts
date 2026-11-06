// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import type { WireError } from "../ipc";
import { editErrorText } from "./edit-error";

const err = (kind: string, message: string): WireError => ({
  kind,
  message,
  path: null,
  details: null,
});

test("a_busy_refusal_names_the_operations_running_in_this_window", () => {
  const text = editErrorText(err("Busy", "busy: a file operation is running"), [
    "Copying 3 items to b",
    "Moving a to c",
  ]);
  expect(text).toContain("Copying 3 items to b; Moving a to c");
  expect(text).toMatch(/listed above the status bar/);
});

test("a_busy_refusal_with_nothing_running_here_points_to_another_window", () => {
  const text = editErrorText(err("Busy", "busy: an undo is running"), []);
  expect(text).toMatch(/running in another window/);
  expect(text).toMatch(/above the status bar/);
});

test("a_busy_refusal_names_a_properties_measurement_as_a_cause_that_is_not_listed", () => {
  // A folder-size measurement of the Properties dialog also holds these back and is no entry of
  // the operations list, in this window or another.
  for (const running of [[], ["Copying a to b"]]) {
    const text = editErrorText(err("Busy", "busy: a file operation is running"), running);
    expect(text).toMatch(/Properties measurement/);
  }
});

test("any_other_error_is_its_kind_and_message", () => {
  expect(editErrorText(err("Exists", "b already exists"), [])).toBe("Exists: b already exists");
});
