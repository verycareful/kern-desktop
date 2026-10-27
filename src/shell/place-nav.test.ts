// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WirePath } from "../ipc";
import { currentPlace } from "./place-nav";

const p = (v: string): WirePath => ({ k: "Utf8", v });

test("only_the_most_specific_matching_place_is_current", () => {
  const places = [
    { key: "home", path: p("/home/t"), inside: false },
    { key: "docs", path: p("/home/t/Documents"), inside: false },
    { key: "vol-home", path: p("/home"), inside: true },
    { key: "vol-docs", path: p("/home/t/Documents"), inside: true },
  ];
  expect(currentPlace(p("/home/t/Documents"), places)).toBe("docs");
  expect(currentPlace(p("/home/t/Documents/x"), places)).toBe("vol-docs");
  expect(currentPlace(p("/home/t"), places)).toBe("home");
  expect(currentPlace(p("/home/u"), places)).toBe("vol-home");
  expect(currentPlace(p("/srv"), places)).toBeNull();
  expect(currentPlace(null, places)).toBeNull();
});
