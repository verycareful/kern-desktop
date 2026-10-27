// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Sricharan Suresh (github.com/verycareful)
import type { WireReport } from "../ipc";
import { needsAttention } from "./outcome";

const report = (over: Partial<WireReport>): WireReport => ({
  done: [],
  skipped: [],
  failed: [],
  warnings: [],
  cancelled: false,
  not_reached: [],
  ...over,
});
const outcome = (r: WireReport | null, error = null) => ({ title: "t", report: r, error });
const err = { kind: "Io", message: "x", path: null, details: null };
const p = { k: "Utf8", v: "/a" } as const;

test("a_clean_report_needs_no_attention", () => {
  expect(needsAttention(outcome(report({ done: [{ source: p, dest: null }] })))).toBe(false);
});

test("every_way_an_operation_can_fall_short_needs_attention", () => {
  expect(needsAttention(outcome(null, err as never))).toBe(true);
  expect(needsAttention(outcome(report({ failed: [{ path: p, error: err }] })))).toBe(true);
  expect(needsAttention(outcome(report({ warnings: [{ path: p, error: err }] })))).toBe(true);
  expect(needsAttention(outcome(report({ cancelled: true })))).toBe(true);
  expect(needsAttention(outcome(report({ not_reached: [p] })))).toBe(true);
});
