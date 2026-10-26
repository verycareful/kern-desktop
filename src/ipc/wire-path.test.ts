// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { describe, expect, test } from "vitest";
import { displayPath, join, parent, pathKey, type WirePath } from "./wire-path";

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

// Bytes paths are built from raw byte values so the expectations come from the
// input, not from running the code.
const bytesPath = (...b: number[]): WirePath => ({
  k: "Bytes",
  v: btoa(String.fromCharCode(...b)),
});
const SLASH = 0x2f;
const A = 0x61;
const B = 0x62;
const BAD = 0xff; // never valid in UTF-8

describe("parent", () => {
  test("utf8_paths", () => {
    expect(parent({ k: "Utf8", v: "/a/b" })).toEqual({ k: "Utf8", v: "/a" });
    expect(parent({ k: "Utf8", v: "/a/b/" })).toEqual({ k: "Utf8", v: "/a" });
    expect(parent({ k: "Utf8", v: "/a" })).toEqual({ k: "Utf8", v: "/" });
    expect(parent({ k: "Utf8", v: "/" })).toBeNull();
  });
  test("bytes_parent_that_is_utf8_is_retagged", () => {
    expect(parent(bytesPath(SLASH, A, SLASH, BAD))).toEqual({ k: "Utf8", v: "/a" });
    expect(parent(bytesPath(SLASH, BAD))).toEqual({ k: "Utf8", v: "/" });
  });
  test("bytes_parent_that_is_not_utf8_stays_bytes", () => {
    expect(parent(bytesPath(SLASH, BAD, SLASH, B))).toEqual(bytesPath(SLASH, BAD));
    expect(parent(bytesPath(SLASH, BAD, SLASH, B, SLASH))).toEqual(bytesPath(SLASH, BAD));
  });
  test("bytes_root_and_garbage", () => {
    expect(parent(bytesPath(SLASH))).toBeNull();
    expect(parent({ k: "Bytes", v: "!!not base64!!" })).toBeNull();
  });
});
