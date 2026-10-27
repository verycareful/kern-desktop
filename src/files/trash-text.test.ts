// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { deletedText } from "./trash-text";

test("a_deletion_date_shows_as_date_and_minutes", () => {
  // FreeDesktop Trash 1.0: DeletionDate is YYYY-MM-DDThh:mm:ss in local time.
  expect(deletedText("2026-10-20T14:05:09")).toBe("2026-10-20 14:05");
});

test("a_value_of_another_shape_is_shown_as_it_is", () => {
  expect(deletedText("yesterday")).toBe("yesterday");
  expect(deletedText("")).toBe("");
});
