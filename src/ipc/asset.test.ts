// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

import { assetUrl } from "./asset";

test("a_utf8_path_gets_the_asset_url", () => {
  expect(assetUrl({ k: "Utf8", v: "/c/x.png" })).toBe("asset://localhost/%2Fc%2Fx.png");
});

test("a_bytes_path_is_refused", () => {
  expect(() => assetUrl({ k: "Bytes", v: "YQ==" })).toThrow(RangeError);
});
