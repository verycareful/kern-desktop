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

  test("passes_what_the_save_expects_to_invoke_as_given", async () => {
    for (const expect_ of [
      { kind: "unchanged", stamp: "s1:opened" },
      { kind: "nothing" },
      { kind: "anything" },
    ] as const) {
      invoke.mockClear();
      await textSave(PATH, "body", "lf", false, expect_);
      expect(invoke).toHaveBeenCalledWith("plugin:kernkraft-tauri|text_save", {
        path: PATH,
        text: "body",
        ending: "lf",
        bom: false,
        expect: expect_,
      });
    }
  });
});
