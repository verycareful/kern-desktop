// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, test } from "vitest";
import { displayPath, join, pathKey, type WirePath } from "./wire-path";

// The bytes of "a<0xF6>b": not UTF-8, so the backend sends them as Bytes.
const NON_UTF8_BYTES = [0x61, 0xf6, 0x62];
const NON_UTF8_B64 = btoa(String.fromCharCode(...NON_UTF8_BYTES));

describe("wire path", () => {
  test("path_key_distinguishes_bytes_from_utf8", () => {
    const utf8: WirePath = { k: "Utf8", v: "same" };
    const bytes: WirePath = { k: "Bytes", v: "same" };
    expect(pathKey(utf8)).not.toBe(pathKey(bytes));
    expect(pathKey(utf8)).toBe(pathKey({ k: "Utf8", v: "same" }));
  });

  test("join_rejects_bytes_parent", () => {
    expect(() => join({ k: "Bytes", v: NON_UTF8_B64 }, "x")).toThrow(/Bytes/);
  });

  test("join_appends_one_separator", () => {
    expect(join({ k: "Utf8", v: "/home/a" }, "b")).toEqual({ k: "Utf8", v: "/home/a/b" });
    expect(join({ k: "Utf8", v: "/" }, "b")).toEqual({ k: "Utf8", v: "/b" });
    expect(join({ k: "Utf8", v: "/home/a/" }, "b")).toEqual({ k: "Utf8", v: "/home/a/b" });
  });

  test("join_rejects_names_that_are_not_one_component", () => {
    const parent: WirePath = { k: "Utf8", v: "/home/a" };
    for (const name of ["", ".", "..", "x/y", "a\0b"]) {
      expect(() => join(parent, name)).toThrow();
    }
  });

  test("display_path_decodes_bytes_lossily", () => {
    expect(displayPath({ k: "Utf8", v: "/home/a" })).toBe("/home/a");
    expect(displayPath({ k: "Bytes", v: NON_UTF8_B64 })).toBe("a�b");
  });

  test("display_path_shows_undecodable_bytes_as_their_text", () => {
    expect(displayPath({ k: "Bytes", v: "!!not base64!!" })).toBe("!!not base64!!");
  });
});
