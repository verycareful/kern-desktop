// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import { expect, test, vi } from "vitest";
import { nextJobId } from "./jobs";

test("job_numbers_are_not_reused", () => {
  const seen = new Set(Array.from({ length: 1000 }, () => nextJobId()));
  expect(seen.size).toBe(1000);
});

test("job_numbers_stay_exact_in_a_javascript_number", () => {
  expect(Number.isSafeInteger(nextJobId())).toBe(true);
  expect(nextJobId()).toBeGreaterThan(0);
});

test("two_windows_with_different_draws_never_share_a_number", async () => {
  const draw = (value: number) => {
    vi.resetModules();
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((bytes: Uint32Array) => {
      bytes[0] = value;
      return bytes;
    }) as typeof globalThis.crypto.getRandomValues);
    return import("./jobs");
  };
  const a = await draw(1);
  const b = await draw(2);
  vi.restoreAllMocks();
  const first = new Set(Array.from({ length: 50 }, () => a.nextJobId()));
  const second = Array.from({ length: 50 }, () => b.nextJobId());
  expect(second.some((id) => first.has(id))).toBe(false);
});
