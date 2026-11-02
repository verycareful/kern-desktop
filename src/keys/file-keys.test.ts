// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test } from "vitest";
import { FILE_KEYS_ATTR, NO_FILE_KEYS_ATTR, inFileKeysArea } from "./file-keys";

test("the_nearer_attribute_decides", () => {
  const view = document.createElement("div");
  view.setAttribute(FILE_KEYS_ATTR, "");
  const search = document.createElement("div");
  search.setAttribute(NO_FILE_KEYS_ATTR, "");
  const inSearch = document.createElement("button");
  const inView = document.createElement("button");
  search.append(inSearch);
  view.append(search, inView);
  const elsewhere = document.createElement("button");
  document.body.append(view, elsewhere);
  try {
    expect(inFileKeysArea(inView)).toBe(true);
    expect(inFileKeysArea(inSearch)).toBe(false);
    expect(inFileKeysArea(elsewhere)).toBe(false);
    expect(inFileKeysArea(document.body)).toBe(true);
  } finally {
    view.remove();
    elsewhere.remove();
  }
});
