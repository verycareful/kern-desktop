// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("./invoke", () => ({ invoke }));

import { textSave } from "./kernkraft";
import type { WirePath } from "./wire-path";

const PATH: WirePath = { k: "Utf8", v: "/home/a/notes.md" };

describe("textSave", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue("s1:next");
  });

  test("passes_the_stamp_to_invoke_as_given", async () => {
    await textSave(PATH, "body", "lf", false, "s1:opened");
    expect(invoke).toHaveBeenCalledWith("plugin:kernkraft|text_save", {
      path: PATH,
      text: "body",
      ending: "lf",
      bom: false,
      stamp: "s1:opened",
    });
  });

  test("passes_a_deliberate_null_stamp_as_null", async () => {
    await textSave(PATH, "body", "crlf", true, null);
    expect(invoke).toHaveBeenCalledWith(
      "plugin:kernkraft|text_save",
      expect.objectContaining({ stamp: null })
    );
  });
});
